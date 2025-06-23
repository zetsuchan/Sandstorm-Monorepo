import { z } from 'zod';
import { SandboxProvider, SandboxSpec, SandboxConstraints } from '@sandstorm/core';

export const FeatureVector = z.object({
  // Sandbox specification features
  codeLength: z.number(),
  language: z.string(),
  cpuRequested: z.number(),
  memoryRequested: z.number(),
  hasGpu: z.number(), // 0 or 1
  hasRequirements: z.number(), // 0 or 1
  requirementsCount: z.number(),
  hasEnvironment: z.number(), // 0 or 1
  environmentCount: z.number(),
  hasFiles: z.number(), // 0 or 1
  filesCount: z.number(),
  isStateful: z.number(), // 0 or 1
  timeoutMs: z.number(),
  
  // Time-based features
  hourOfDay: z.number(),
  dayOfWeek: z.number(),
  isWeekend: z.number(), // 0 or 1
  
  // Provider features (one-hot encoded)
  providerE2b: z.number(),
  providerModal: z.number(),
  providerDaytona: z.number(),
  providerMorph: z.number(),
  providerKubernetes: z.number(),
  providerCustom: z.number(),
  
  // Historical features (will be populated from telemetry)
  avgProviderLatency: z.number(),
  avgProviderCost: z.number(),
  providerFailureRate: z.number(),
  providerAvailability: z.number(),
});
export type FeatureVector = z.infer<typeof FeatureVector>;

export const PredictionResult = z.object({
  provider: SandboxProvider,
  predictedCost: z.number(),
  predictedLatency: z.number(),
  confidence: z.number(),
  features: FeatureVector,
  modelVersion: z.string(),
});
export type PredictionResult = z.infer<typeof PredictionResult>;

export const TrainingDataPoint = z.object({
  features: FeatureVector,
  actualCost: z.number(),
  actualLatency: z.number(),
  success: z.boolean(),
  timestamp: z.string(),
});
export type TrainingDataPoint = z.infer<typeof TrainingDataPoint>;

export const ModelMetrics = z.object({
  version: z.string(),
  trainedAt: z.string(),
  accuracy: z.number(),
  costMSE: z.number(),
  latencyMSE: z.number(),
  providerAccuracy: z.record(z.number()),
  featureImportance: z.record(z.number()),
  trainingDataSize: z.number(),
  validationDataSize: z.number(),
});
export type ModelMetrics = z.infer<typeof ModelMetrics>;

export const ABTestConfig = z.object({
  enabled: z.boolean(),
  controlModelVersion: z.string(),
  treatmentModelVersion: z.string(),
  trafficSplit: z.number().min(0).max(1), // % going to treatment
  startTime: z.string(),
  endTime: z.string().optional(),
});
export type ABTestConfig = z.infer<typeof ABTestConfig>;

export interface IMLRouter {
  predict(spec: SandboxSpec, constraints: SandboxConstraints): Promise<PredictionResult>;
  predictBatch(specs: Array<{ spec: SandboxSpec; constraints: SandboxConstraints }>): Promise<PredictionResult[]>;
  getModelMetrics(version?: string): Promise<ModelMetrics>;
  setActiveModel(version: string): Promise<void>;
  configureABTest(config: ABTestConfig): Promise<void>;
}

export interface IFeatureExtractor {
  extractFeatures(spec: SandboxSpec, provider: SandboxProvider): Promise<FeatureVector>;
  extractFeaturesWithHistory(
    spec: SandboxSpec,
    provider: SandboxProvider,
    historicalData: TrainingDataPoint[]
  ): Promise<FeatureVector>;
}