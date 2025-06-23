import {
  IArbitrageEngine,
  ISandboxProvider,
  SandboxSpec,
  SandboxConstraints,
  SandboxProvider,
} from '@sandstorm/core';
import { MLRouter, IMLRouter } from '@sandstorm/ml-router';

export interface ArbitrageEngineOptions {
  mlRouterUrl?: string;
  telemetryUrl?: string;
  modelStorePath?: string;
  defaultStrategy?: 'ml' | 'rule-based' | 'hybrid';
  confidenceThreshold?: number;
}

export class ArbitrageEngine implements IArbitrageEngine {
  private mlRouter?: IMLRouter;
  private strategy: 'ml' | 'rule-based' | 'hybrid';
  private confidenceThreshold: number;
  private providers: Map<SandboxProvider, ISandboxProvider> = new Map();

  constructor(private options: ArbitrageEngineOptions = {}) {
    this.strategy = options.defaultStrategy || 'hybrid';
    this.confidenceThreshold = options.confidenceThreshold || 0.7;

    // Initialize ML router if ML or hybrid strategy is selected
    if (this.strategy === 'ml' || this.strategy === 'hybrid') {
      this.initializeMLRouter();
    }
  }

  private async initializeMLRouter(): Promise<void> {
    if (!this.options.modelStorePath || !this.options.telemetryUrl) {
      console.warn('ML Router configuration missing, falling back to rule-based');
      this.strategy = 'rule-based';
      return;
    }

    try {
      this.mlRouter = new MLRouter(
        this.options.modelStorePath,
        this.options.telemetryUrl,
        {
          fallbackToRuleBased: true,
          cacheTTL: 300000, // 5 minutes
          batchSize: 10,
        }
      );
      await this.mlRouter.initialize();
    } catch (error) {
      console.error('Failed to initialize ML Router:', error);
      this.strategy = 'rule-based';
    }
  }

  async selectProvider(
    spec: SandboxSpec,
    constraints: SandboxConstraints,
    providers: ISandboxProvider[]
  ): Promise<ISandboxProvider> {
    // Update provider registry
    for (const provider of providers) {
      this.providers.set(provider.name, provider);
    }

    // Get optimal provider estimation
    const estimation = await this.estimateOptimalProvider(spec, constraints);
    
    // Find the provider instance
    const selectedProvider = providers.find(p => p.name === estimation.provider);
    
    if (!selectedProvider) {
      throw new Error(`Provider ${estimation.provider} not found in available providers`);
    }

    // Check if provider is actually available
    const isAvailable = await selectedProvider.isAvailable();
    if (!isAvailable) {
      // Fallback to next best provider
      return this.selectFallbackProvider(spec, constraints, providers, estimation.provider);
    }

    return selectedProvider;
  }

  async estimateOptimalProvider(
    spec: SandboxSpec,
    constraints: SandboxConstraints
  ): Promise<{
    provider: SandboxProvider;
    estimatedCost: number;
    estimatedLatency: number;
    confidence: number;
    strategy: 'ml' | 'rule-based' | 'hybrid';
    modelVersion?: string;
  }> {
    // Check strategy and route accordingly
    if (this.strategy === 'ml' && this.mlRouter) {
      try {
        const prediction = await this.mlRouter.predict(spec, constraints);
        return {
          provider: prediction.provider,
          estimatedCost: prediction.predictedCost,
          estimatedLatency: prediction.predictedLatency,
          confidence: prediction.confidence,
          strategy: 'ml',
          modelVersion: prediction.modelVersion,
        };
      } catch (error) {
        console.error('ML prediction failed:', error);
        // Fall through to rule-based
      }
    }

    if (this.strategy === 'hybrid' && this.mlRouter) {
      try {
        const prediction = await this.mlRouter.predict(spec, constraints);
        
        // Use ML prediction if confidence is high enough
        if (prediction.confidence >= this.confidenceThreshold) {
          return {
            provider: prediction.provider,
            estimatedCost: prediction.predictedCost,
            estimatedLatency: prediction.predictedLatency,
            confidence: prediction.confidence,
            strategy: 'ml',
            modelVersion: prediction.modelVersion,
          };
        }
        
        // Otherwise, use rule-based but include ML prediction info
        const ruleBasedProvider = this.selectRuleBasedProvider(spec, constraints);
        const ruleBasedEstimates = this.estimateRuleBased(spec, ruleBasedProvider);
        
        return {
          ...ruleBasedEstimates,
          strategy: 'hybrid',
          modelVersion: prediction.modelVersion,
        };
      } catch (error) {
        console.error('ML prediction failed in hybrid mode:', error);
        // Fall through to rule-based
      }
    }

    // Pure rule-based selection
    const provider = this.selectRuleBasedProvider(spec, constraints);
    return {
      ...this.estimateRuleBased(spec, provider),
      strategy: 'rule-based',
    };
  }

  private selectRuleBasedProvider(
    spec: SandboxSpec,
    constraints: SandboxConstraints
  ): SandboxProvider {
    // Apply constraints first
    let candidates: SandboxProvider[] = ['e2b', 'modal', 'daytona', 'morph', 'kubernetes', 'custom'];
    
    if (constraints.excludeProviders) {
      candidates = candidates.filter(p => !constraints.excludeProviders!.includes(p));
    }
    
    if (constraints.preferredProviders && constraints.preferredProviders.length > 0) {
      const preferred = constraints.preferredProviders.filter(p => candidates.includes(p));
      if (preferred.length > 0) {
        candidates = preferred;
      }
    }

    // Rule-based selection logic
    if (spec.gpu) {
      // GPU workloads
      if (candidates.includes('modal')) return 'modal';
      if (candidates.includes('kubernetes')) return 'kubernetes';
    }
    
    if (spec.stateful) {
      // Stateful workloads
      if (candidates.includes('kubernetes')) return 'kubernetes';
      if (candidates.includes('daytona')) return 'daytona';
    }
    
    if (spec.timeout && spec.timeout > 300000) {
      // Long-running tasks (> 5 minutes)
      if (candidates.includes('daytona')) return 'daytona';
      if (candidates.includes('modal')) return 'modal';
    }
    
    if (spec.memory && spec.memory > 8192) {
      // High-memory workloads (> 8GB)
      if (candidates.includes('modal')) return 'modal';
      if (candidates.includes('kubernetes')) return 'kubernetes';
    }
    
    if (spec.requirements && spec.requirements.length > 5) {
      // Complex dependencies
      if (candidates.includes('e2b')) return 'e2b';
      if (candidates.includes('modal')) return 'modal';
    }
    
    // Default selection based on general characteristics
    if (candidates.includes('e2b')) return 'e2b';
    if (candidates.includes('modal')) return 'modal';
    
    // Return first available candidate
    return candidates[0] || 'e2b';
  }

  private estimateRuleBased(
    spec: SandboxSpec,
    provider: SandboxProvider
  ): {
    provider: SandboxProvider;
    estimatedCost: number;
    estimatedLatency: number;
    confidence: number;
  } {
    // Base estimates per provider
    const baseEstimates = {
      e2b: { cost: 0.001, latency: 2000 },
      modal: { cost: 0.0008, latency: 1500 },
      daytona: { cost: 0.0015, latency: 3000 },
      morph: { cost: 0.0012, latency: 2500 },
      kubernetes: { cost: 0.0005, latency: 1000 },
      custom: { cost: 0.002, latency: 5000 },
    };

    const base = baseEstimates[provider] || { cost: 0.001, latency: 3000 };
    
    // Adjust based on resources
    const cpuMultiplier = (spec.cpu || 1) / 2;
    const memoryMultiplier = (spec.memory || 512) / 1024;
    const timeMultiplier = (spec.timeout || 30000) / 30000;
    const gpuMultiplier = spec.gpu ? 10 : 1;
    
    const estimatedCost = base.cost * cpuMultiplier * memoryMultiplier * timeMultiplier * gpuMultiplier;
    const estimatedLatency = base.latency * (1 + (cpuMultiplier - 1) * 0.1) * (spec.gpu ? 1.5 : 1);
    
    return {
      provider,
      estimatedCost,
      estimatedLatency,
      confidence: 0.6, // Lower confidence for rule-based
    };
  }

  private async selectFallbackProvider(
    spec: SandboxSpec,
    constraints: SandboxConstraints,
    providers: ISandboxProvider[],
    excludeProvider: SandboxProvider
  ): Promise<ISandboxProvider> {
    // Get all available providers except the excluded one
    const availableProviders = await Promise.all(
      providers
        .filter(p => p.name !== excludeProvider)
        .map(async p => ({
          provider: p,
          available: await p.isAvailable(),
        }))
    );

    const candidates = availableProviders
      .filter(p => p.available)
      .map(p => p.provider);

    if (candidates.length === 0) {
      throw new Error('No available providers found');
    }

    // Use rule-based selection on remaining candidates
    const updatedConstraints = {
      ...constraints,
      excludeProviders: [...(constraints.excludeProviders || []), excludeProvider],
    };

    const fallbackEstimation = await this.estimateOptimalProvider(spec, updatedConstraints);
    const fallbackProvider = candidates.find(p => p.name === fallbackEstimation.provider);

    if (!fallbackProvider) {
      // Return first available as last resort
      return candidates[0];
    }

    return fallbackProvider;
  }

  setRoutingStrategy(strategy: 'ml' | 'rule-based' | 'hybrid'): void {
    this.strategy = strategy;
    
    // Initialize ML router if needed and not already initialized
    if ((strategy === 'ml' || strategy === 'hybrid') && !this.mlRouter) {
      this.initializeMLRouter();
    }
  }

  getRoutingStrategy(): 'ml' | 'rule-based' | 'hybrid' {
    return this.strategy;
  }

  async updateMLModel(version: string): Promise<void> {
    if (!this.mlRouter) {
      throw new Error('ML Router not initialized');
    }
    
    await this.mlRouter.setActiveModel(version);
  }

  async getMLModelMetrics(): Promise<{
    accuracy: number;
    costMSE: number;
    latencyMSE: number;
    lastUpdated: Date;
  }> {
    if (!this.mlRouter) {
      throw new Error('ML Router not initialized');
    }
    
    const metrics = await this.mlRouter.getModelMetrics();
    
    return {
      accuracy: metrics.accuracy,
      costMSE: metrics.costMSE,
      latencyMSE: metrics.latencyMSE,
      lastUpdated: new Date(metrics.trainedAt),
    };
  }

  setConfidenceThreshold(threshold: number): void {
    if (threshold < 0 || threshold > 1) {
      throw new Error('Confidence threshold must be between 0 and 1');
    }
    this.confidenceThreshold = threshold;
  }

  getConfidenceThreshold(): number {
    return this.confidenceThreshold;
  }
}