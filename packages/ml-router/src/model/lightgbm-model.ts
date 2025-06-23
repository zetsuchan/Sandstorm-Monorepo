import { FeatureVector, TrainingDataPoint } from '../types';
import { SandboxProvider } from '@sandstorm/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';

export interface LightGBMPrediction {
  provider: SandboxProvider;
  cost: number;
  latency: number;
  confidence: number;
}

export class LightGBMModel {
  private modelPath: string;
  private version: string;
  private isLoaded: boolean = false;
  private costModel: any;
  private latencyModel: any;
  private providerModel: any;

  constructor(modelPath: string, version: string) {
    this.modelPath = modelPath;
    this.version = version;
  }

  async load(): Promise<void> {
    if (this.isLoaded) return;

    try {
      // Load the three models (cost, latency, provider selection)
      const costModelPath = path.join(this.modelPath, `cost_model_${this.version}.txt`);
      const latencyModelPath = path.join(this.modelPath, `latency_model_${this.version}.txt`);
      const providerModelPath = path.join(this.modelPath, `provider_model_${this.version}.txt`);

      // Check if model files exist
      await Promise.all([
        fs.access(costModelPath),
        fs.access(latencyModelPath),
        fs.access(providerModelPath),
      ]);

      // In production, we would use lightgbm Node.js bindings
      // For now, we'll use a Python script wrapper
      this.isLoaded = true;
    } catch (error) {
      throw new Error(`Failed to load model version ${this.version}: ${error}`);
    }
  }

  async predict(features: FeatureVector): Promise<LightGBMPrediction> {
    if (!this.isLoaded) {
      await this.load();
    }

    // Convert features to array format for LightGBM
    const featureArray = this.featuresToArray(features);
    
    // In production, this would call the LightGBM C++ library
    // For now, we'll use a Python script wrapper
    const pythonScript = path.join(__dirname, '..', 'training', 'predict.py');
    const result = execSync(
      `python3 ${pythonScript} --model-path ${this.modelPath} --version ${this.version} --features '${JSON.stringify(featureArray)}'`,
      { encoding: 'utf-8' }
    );

    const prediction = JSON.parse(result);
    
    return {
      provider: this.indexToProvider(prediction.provider),
      cost: prediction.cost,
      latency: prediction.latency,
      confidence: prediction.confidence,
    };
  }

  async train(trainingData: TrainingDataPoint[]): Promise<void> {
    // Prepare training data
    const features: number[][] = [];
    const costTargets: number[] = [];
    const latencyTargets: number[] = [];
    const providerTargets: number[] = [];

    for (const dataPoint of trainingData) {
      features.push(this.featuresToArray(dataPoint.features));
      costTargets.push(dataPoint.actualCost);
      latencyTargets.push(dataPoint.actualLatency);
      
      // Extract provider from one-hot encoding
      const providerIndex = this.getProviderIndex(dataPoint.features);
      providerTargets.push(providerIndex);
    }

    // Save training data to temporary files
    const tempDir = path.join(this.modelPath, 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    await fs.writeFile(
      path.join(tempDir, 'features.json'),
      JSON.stringify(features)
    );
    await fs.writeFile(
      path.join(tempDir, 'cost_targets.json'),
      JSON.stringify(costTargets)
    );
    await fs.writeFile(
      path.join(tempDir, 'latency_targets.json'),
      JSON.stringify(latencyTargets)
    );
    await fs.writeFile(
      path.join(tempDir, 'provider_targets.json'),
      JSON.stringify(providerTargets)
    );

    // Run training script
    const trainScript = path.join(__dirname, '..', 'training', 'train_lightgbm.py');
    execSync(
      `python3 ${trainScript} --data-dir ${tempDir} --output-dir ${this.modelPath} --version ${this.version}`,
      { encoding: 'utf-8', stdio: 'inherit' }
    );

    // Clean up temporary files
    await fs.rm(tempDir, { recursive: true });
  }

  private featuresToArray(features: FeatureVector): number[] {
    return [
      features.codeLength,
      features.language,
      features.cpuRequested,
      features.memoryRequested,
      features.hasGpu,
      features.hasRequirements,
      features.requirementsCount,
      features.hasEnvironment,
      features.environmentCount,
      features.hasFiles,
      features.filesCount,
      features.isStateful,
      features.timeoutMs,
      features.hourOfDay,
      features.dayOfWeek,
      features.isWeekend,
      features.avgProviderLatency,
      features.avgProviderCost,
      features.providerFailureRate,
      features.providerAvailability,
    ];
  }

  private getProviderIndex(features: FeatureVector): number {
    const providers = [
      'providerE2b',
      'providerModal',
      'providerDaytona',
      'providerMorph',
      'providerKubernetes',
      'providerCustom',
    ];
    
    for (let i = 0; i < providers.length; i++) {
      if (features[providers[i] as keyof FeatureVector] === 1) {
        return i;
      }
    }
    return 0; // Default to e2b
  }

  private indexToProvider(index: number): SandboxProvider {
    const providers: SandboxProvider[] = [
      'e2b',
      'modal',
      'daytona',
      'morph',
      'kubernetes',
      'custom',
    ];
    return providers[index] || 'e2b';
  }

  async getFeatureImportance(): Promise<Record<string, number>> {
    if (!this.isLoaded) {
      await this.load();
    }

    // Read feature importance from saved model metadata
    const metadataPath = path.join(this.modelPath, `metadata_${this.version}.json`);
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
    
    return metadata.featureImportance || {};
  }
}