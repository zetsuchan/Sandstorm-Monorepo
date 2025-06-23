import { SandboxSpec, SandboxProvider, Language } from '@sandstorm/core';
import { FeatureVector, TrainingDataPoint, IFeatureExtractor } from './types';
import { getHours, getDay, isWeekend } from 'date-fns';

export class FeatureExtractor implements IFeatureExtractor {
  private languageToIndex: Record<string, number> = {
    python: 0,
    javascript: 1,
    typescript: 2,
    go: 3,
    rust: 4,
    java: 5,
    cpp: 6,
    shell: 7,
  };

  private providerToIndex: Record<string, number> = {
    e2b: 0,
    modal: 1,
    daytona: 2,
    morph: 3,
    kubernetes: 4,
    custom: 5,
  };

  async extractFeatures(
    spec: SandboxSpec,
    provider: SandboxProvider
  ): Promise<FeatureVector> {
    const now = new Date();
    
    // Extract basic features
    const features: FeatureVector = {
      // Code features
      codeLength: spec.code.length,
      language: this.languageToIndex[spec.language] || 0,
      
      // Resource features
      cpuRequested: spec.cpu || 1,
      memoryRequested: spec.memory || 512,
      hasGpu: spec.gpu ? 1 : 0,
      timeoutMs: spec.timeout || 30000,
      
      // Dependencies and environment
      hasRequirements: spec.requirements && spec.requirements.length > 0 ? 1 : 0,
      requirementsCount: spec.requirements?.length || 0,
      hasEnvironment: spec.environment && Object.keys(spec.environment).length > 0 ? 1 : 0,
      environmentCount: spec.environment ? Object.keys(spec.environment).length : 0,
      hasFiles: spec.files && Object.keys(spec.files).length > 0 ? 1 : 0,
      filesCount: spec.files ? Object.keys(spec.files).length : 0,
      isStateful: spec.stateful ? 1 : 0,
      
      // Time features
      hourOfDay: getHours(now),
      dayOfWeek: getDay(now),
      isWeekend: isWeekend(now) ? 1 : 0,
      
      // Provider one-hot encoding
      providerE2b: provider === 'e2b' ? 1 : 0,
      providerModal: provider === 'modal' ? 1 : 0,
      providerDaytona: provider === 'daytona' ? 1 : 0,
      providerMorph: provider === 'morph' ? 1 : 0,
      providerKubernetes: provider === 'kubernetes' ? 1 : 0,
      providerCustom: provider === 'custom' ? 1 : 0,
      
      // Historical features (will be populated later)
      avgProviderLatency: 0,
      avgProviderCost: 0,
      providerFailureRate: 0,
      providerAvailability: 1,
    };

    return features;
  }

  async extractFeaturesWithHistory(
    spec: SandboxSpec,
    provider: SandboxProvider,
    historicalData: TrainingDataPoint[]
  ): Promise<FeatureVector> {
    const features = await this.extractFeatures(spec, provider);
    
    // Calculate historical statistics for this provider
    const providerData = historicalData.filter(dp => {
      const providerKey = Object.keys(dp.features).find(
        key => key.startsWith('provider') && dp.features[key as keyof FeatureVector] === 1
      );
      return providerKey === `provider${this.capitalizeFirst(provider)}`;
    });

    if (providerData.length > 0) {
      // Calculate average latency and cost
      const totalLatency = providerData.reduce((sum, dp) => sum + dp.actualLatency, 0);
      const totalCost = providerData.reduce((sum, dp) => sum + dp.actualCost, 0);
      const failures = providerData.filter(dp => !dp.success).length;
      
      features.avgProviderLatency = totalLatency / providerData.length;
      features.avgProviderCost = totalCost / providerData.length;
      features.providerFailureRate = failures / providerData.length;
      features.providerAvailability = 1 - features.providerFailureRate;
    } else {
      // Use default values for new providers
      features.avgProviderLatency = this.getDefaultLatency(provider);
      features.avgProviderCost = this.getDefaultCost(provider);
      features.providerFailureRate = 0.01; // Assume 1% failure rate
      features.providerAvailability = 0.99;
    }

    return features;
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private getDefaultLatency(provider: SandboxProvider): number {
    // Default latencies in ms based on provider characteristics
    const defaults: Record<SandboxProvider, number> = {
      e2b: 2000,
      modal: 1500,
      daytona: 3000,
      morph: 2500,
      kubernetes: 1000,
      custom: 5000,
    };
    return defaults[provider] || 3000;
  }

  private getDefaultCost(provider: SandboxProvider): number {
    // Default costs per execution based on provider pricing models
    const defaults: Record<SandboxProvider, number> = {
      e2b: 0.001,
      modal: 0.0008,
      daytona: 0.0015,
      morph: 0.0012,
      kubernetes: 0.0005,
      custom: 0.002,
    };
    return defaults[provider] || 0.001;
  }

  // Normalize features for better model performance
  normalizeFeatures(features: FeatureVector): FeatureVector {
    return {
      ...features,
      // Normalize code length (log scale)
      codeLength: Math.log1p(features.codeLength),
      // Normalize resource requests
      cpuRequested: features.cpuRequested / 64, // Max 64 CPUs
      memoryRequested: features.memoryRequested / 65536, // Max 64GB
      // Normalize time features
      hourOfDay: features.hourOfDay / 24,
      dayOfWeek: features.dayOfWeek / 7,
      // Normalize timeout
      timeoutMs: features.timeoutMs / 3600000, // Max 1 hour
      // Log scale for counts
      requirementsCount: Math.log1p(features.requirementsCount),
      environmentCount: Math.log1p(features.environmentCount),
      filesCount: Math.log1p(features.filesCount),
      // Log scale for historical metrics
      avgProviderLatency: Math.log1p(features.avgProviderLatency),
      avgProviderCost: Math.log1p(features.avgProviderCost),
    };
  }
}