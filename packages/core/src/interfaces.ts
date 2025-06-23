import { SandboxSpec, SandboxResult, SandboxProvider, SandboxSnapshot, SandboxConstraints } from './types';

export interface ISandboxProvider {
  name: SandboxProvider;
  isAvailable(): Promise<boolean>;
  estimateCost(spec: SandboxSpec): Promise<number>;
  estimateLatency(spec: SandboxSpec): Promise<number>;
  run(spec: SandboxSpec): Promise<SandboxResult>;
  snapshot(sandboxId: string): Promise<SandboxSnapshot>;
  restore(snapshotId: string): Promise<string>;
  getQuota(): Promise<{ used: number; limit: number }>;
}

export interface IArbitrageEngine {
  selectProvider(
    spec: SandboxSpec,
    constraints: SandboxConstraints,
    providers: ISandboxProvider[]
  ): Promise<ISandboxProvider>;
  
  estimateOptimalProvider(
    spec: SandboxSpec,
    constraints: SandboxConstraints
  ): Promise<{
    provider: SandboxProvider;
    estimatedCost: number;
    estimatedLatency: number;
    confidence: number;
  }>;
}

export interface ITelemetryService {
  trackRun(result: SandboxResult): Promise<void>;
  trackError(error: Error, context: Record<string, any>): Promise<void>;
  getMetrics(timeRange: { start: Date; end: Date }): Promise<{
    totalRuns: number;
    totalCost: number;
    avgLatency: number;
    providerBreakdown: Record<SandboxProvider, number>;
  }>;
}

export interface ISnapshotVault {
  store(snapshot: SandboxSnapshot, data: Buffer): Promise<string>;
  retrieve(snapshotId: string): Promise<Buffer>;
  list(filters?: { sandboxId?: string; provider?: SandboxProvider }): Promise<SandboxSnapshot[]>;
  anchor(snapshotId: string): Promise<{ txHash: string; blockNumber: number }>;
}