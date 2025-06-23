import { SandboxSpec, SandboxConstraints, SandboxProvider } from '@sandstorm/core';
import { 
  IMLRouter, 
  PredictionResult, 
  ModelMetrics, 
  ABTestConfig,
  TrainingDataPoint 
} from './types';
import { FeatureExtractor } from './feature-extractor';
import { LightGBMModel } from './model/lightgbm-model';
import { ModelStore } from './model-store';
import { TelemetryClient } from './telemetry-client';
import * as path from 'path';

export class MLRouter implements IMLRouter {
  private featureExtractor: FeatureExtractor;
  private modelStore: ModelStore;
  private telemetryClient: TelemetryClient;
  private activeModel?: LightGBMModel;
  private abTestConfig?: ABTestConfig;
  private modelCache: Map<string, LightGBMModel> = new Map();

  constructor(
    modelStorePath: string,
    telemetryServiceUrl: string,
    private readonly options: {
      cacheTTL?: number;
      batchSize?: number;
      fallbackToRuleBased?: boolean;
    } = {}
  ) {
    this.featureExtractor = new FeatureExtractor();
    this.modelStore = new ModelStore(modelStorePath);
    this.telemetryClient = new TelemetryClient(telemetryServiceUrl);
  }

  async initialize(): Promise<void> {
    // Load the latest model or a specific version
    const latestVersion = await this.modelStore.getLatestVersion();
    if (latestVersion) {
      await this.setActiveModel(latestVersion);
    }
  }

  async predict(
    spec: SandboxSpec,
    constraints: SandboxConstraints
  ): Promise<PredictionResult> {
    try {
      // Get candidate providers based on constraints
      const candidateProviders = this.getCandidateProviders(constraints);
      
      // Get historical data for feature enrichment
      const historicalData = await this.telemetryClient.getRecentData(
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        100 // Last 100 executions
      );

      // Make predictions for each candidate provider
      const predictions: PredictionResult[] = [];
      
      for (const provider of candidateProviders) {
        const features = await this.featureExtractor.extractFeaturesWithHistory(
          spec,
          provider,
          historicalData
        );

        // Normalize features
        const normalizedFeatures = this.featureExtractor.normalizeFeatures(features);

        // Get model based on A/B test configuration
        const model = await this.getModelForPrediction();
        
        if (!model) {
          // Fallback to rule-based if no model available
          if (this.options.fallbackToRuleBased) {
            return this.ruleBasedPrediction(spec, constraints, provider);
          }
          throw new Error('No ML model available and rule-based fallback disabled');
        }

        // Make prediction
        const prediction = await model.predict(normalizedFeatures);
        
        predictions.push({
          provider,
          predictedCost: prediction.cost,
          predictedLatency: prediction.latency,
          confidence: prediction.confidence,
          features: normalizedFeatures,
          modelVersion: model.version,
        });
      }

      // Select best provider based on constraints and predictions
      return this.selectBestPrediction(predictions, constraints);
    } catch (error) {
      console.error('ML prediction failed:', error);
      
      // Fallback to rule-based routing
      if (this.options.fallbackToRuleBased) {
        const provider = this.ruleBasedProviderSelection(spec, constraints);
        return this.ruleBasedPrediction(spec, constraints, provider);
      }
      
      throw error;
    }
  }

  async predictBatch(
    requests: Array<{ spec: SandboxSpec; constraints: SandboxConstraints }>
  ): Promise<PredictionResult[]> {
    // Process in batches for efficiency
    const batchSize = this.options.batchSize || 10;
    const results: PredictionResult[] = [];
    
    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(req => this.predict(req.spec, req.constraints))
      );
      results.push(...batchResults);
    }
    
    return results;
  }

  async getModelMetrics(version?: string): Promise<ModelMetrics> {
    const targetVersion = version || await this.modelStore.getLatestVersion();
    if (!targetVersion) {
      throw new Error('No model version available');
    }

    return await this.modelStore.getMetrics(targetVersion);
  }

  async setActiveModel(version: string): Promise<void> {
    // Check if model exists
    const exists = await this.modelStore.exists(version);
    if (!exists) {
      throw new Error(`Model version ${version} not found`);
    }

    // Load model
    const modelPath = await this.modelStore.getModelPath(version);
    const model = new LightGBMModel(modelPath, version);
    await model.load();

    // Cache the model
    this.modelCache.set(version, model);
    this.activeModel = model;

    // Update model store
    await this.modelStore.setActiveVersion(version);
  }

  async configureABTest(config: ABTestConfig): Promise<void> {
    // Validate model versions exist
    const controlExists = await this.modelStore.exists(config.controlModelVersion);
    const treatmentExists = await this.modelStore.exists(config.treatmentModelVersion);
    
    if (!controlExists || !treatmentExists) {
      throw new Error('One or both model versions for A/B test do not exist');
    }

    // Preload both models
    if (!this.modelCache.has(config.controlModelVersion)) {
      const controlPath = await this.modelStore.getModelPath(config.controlModelVersion);
      const controlModel = new LightGBMModel(controlPath, config.controlModelVersion);
      await controlModel.load();
      this.modelCache.set(config.controlModelVersion, controlModel);
    }

    if (!this.modelCache.has(config.treatmentModelVersion)) {
      const treatmentPath = await this.modelStore.getModelPath(config.treatmentModelVersion);
      const treatmentModel = new LightGBMModel(treatmentPath, config.treatmentModelVersion);
      await treatmentModel.load();
      this.modelCache.set(config.treatmentModelVersion, treatmentModel);
    }

    this.abTestConfig = config;
  }

  private getCandidateProviders(constraints: SandboxConstraints): SandboxProvider[] {
    const allProviders: SandboxProvider[] = ['e2b', 'modal', 'daytona', 'morph', 'kubernetes', 'custom'];
    
    let candidates = allProviders;
    
    // Apply exclusions
    if (constraints.excludeProviders && constraints.excludeProviders.length > 0) {
      candidates = candidates.filter(p => !constraints.excludeProviders!.includes(p));
    }
    
    // Apply preferences (move to front)
    if (constraints.preferredProviders && constraints.preferredProviders.length > 0) {
      const preferred = constraints.preferredProviders.filter(p => candidates.includes(p));
      const others = candidates.filter(p => !constraints.preferredProviders!.includes(p));
      candidates = [...preferred, ...others];
    }
    
    return candidates;
  }

  private async getModelForPrediction(): Promise<LightGBMModel | undefined> {
    if (!this.abTestConfig || !this.abTestConfig.enabled) {
      return this.activeModel;
    }

    // Check if A/B test is still active
    const now = new Date();
    if (this.abTestConfig.endTime && new Date(this.abTestConfig.endTime) < now) {
      return this.activeModel;
    }

    // Determine which model to use based on traffic split
    const useTraeatment = Math.random() < this.abTestConfig.trafficSplit;
    const version = useTraeatment 
      ? this.abTestConfig.treatmentModelVersion 
      : this.abTestConfig.controlModelVersion;

    return this.modelCache.get(version);
  }

  private selectBestPrediction(
    predictions: PredictionResult[],
    constraints: SandboxConstraints
  ): PredictionResult {
    // Filter by constraints
    let validPredictions = predictions.filter(p => {
      if (constraints.maxCost && p.predictedCost > constraints.maxCost) {
        return false;
      }
      if (constraints.maxLatency && p.predictedLatency > constraints.maxLatency) {
        return false;
      }
      return true;
    });

    // If no predictions meet constraints, relax and pick the best
    if (validPredictions.length === 0) {
      validPredictions = predictions;
    }

    // Score predictions based on normalized cost and latency
    const scored = validPredictions.map(p => {
      // Normalize scores (lower is better)
      const costScore = p.predictedCost;
      const latencyScore = p.predictedLatency / 1000; // Convert to seconds
      
      // Weight: 60% cost, 40% latency (can be configurable)
      const score = (0.6 * costScore + 0.4 * latencyScore) * (1 - p.confidence * 0.1);
      
      return { prediction: p, score };
    });

    // Sort by score (ascending)
    scored.sort((a, b) => a.score - b.score);

    return scored[0].prediction;
  }

  private ruleBasedProviderSelection(
    spec: SandboxSpec,
    constraints: SandboxConstraints
  ): SandboxProvider {
    // Simple rule-based logic
    if (spec.gpu) {
      return 'modal'; // Modal has good GPU support
    }
    
    if (spec.stateful) {
      return 'kubernetes'; // K8s for stateful workloads
    }
    
    if (spec.timeout && spec.timeout > 300000) { // > 5 minutes
      return 'daytona'; // Better for long-running tasks
    }
    
    if (spec.memory && spec.memory > 8192) { // > 8GB
      return 'modal'; // Good for high-memory workloads
    }
    
    // Default to e2b for general purposes
    return 'e2b';
  }

  private async ruleBasedPrediction(
    spec: SandboxSpec,
    constraints: SandboxConstraints,
    provider: SandboxProvider
  ): Promise<PredictionResult> {
    // Simple estimations based on provider characteristics
    const baseLatency = {
      e2b: 2000,
      modal: 1500,
      daytona: 3000,
      morph: 2500,
      kubernetes: 1000,
      custom: 5000,
    };

    const baseCost = {
      e2b: 0.001,
      modal: 0.0008,
      daytona: 0.0015,
      morph: 0.0012,
      kubernetes: 0.0005,
      custom: 0.002,
    };

    // Adjust based on resources
    const cpuMultiplier = (spec.cpu || 1) / 2;
    const memoryMultiplier = (spec.memory || 512) / 1024;
    const timeMultiplier = (spec.timeout || 30000) / 30000;

    const predictedLatency = baseLatency[provider] * (1 + cpuMultiplier * 0.1);
    const predictedCost = baseCost[provider] * cpuMultiplier * memoryMultiplier * timeMultiplier;

    const features = await this.featureExtractor.extractFeatures(spec, provider);

    return {
      provider,
      predictedCost,
      predictedLatency,
      confidence: 0.5, // Low confidence for rule-based
      features,
      modelVersion: 'rule-based',
    };
  }
}