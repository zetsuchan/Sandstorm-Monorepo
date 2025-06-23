import { 
  SandboxSpec, 
  SandboxResult, 
  SandboxProvider, 
  SandboxSnapshot, 
  SandboxConstraints,
  SecurityEvent,
  SecurityPolicy,
  QuarantineRecord,
  SecurityTier 
} from './types';

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
    strategy: 'ml' | 'rule-based' | 'hybrid';
    modelVersion?: string;
  }>;
  
  // New methods for ML integration
  setRoutingStrategy(strategy: 'ml' | 'rule-based' | 'hybrid'): void;
  getRoutingStrategy(): 'ml' | 'rule-based' | 'hybrid';
  
  // ML-specific methods
  updateMLModel(version: string): Promise<void>;
  getMLModelMetrics(): Promise<{
    accuracy: number;
    costMSE: number;
    latencyMSE: number;
    lastUpdated: Date;
  }>;
  
  // Confidence threshold for fallback
  setConfidenceThreshold(threshold: number): void;
  getConfidenceThreshold(): number;
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

export interface ISecurityMonitor {
  // Event Management
  captureEvent(event: SecurityEvent): Promise<void>;
  getEvents(filters?: {
    sandboxId?: string;
    type?: string;
    severity?: string;
    startTime?: Date;
    endTime?: Date;
  }): Promise<SecurityEvent[]>;
  
  // Policy Management
  applyPolicy(policy: SecurityPolicy): Promise<void>;
  removePolicy(policyId: string): Promise<void>;
  
  // Quarantine
  quarantine(sandboxId: string, reason: string, event: SecurityEvent): Promise<QuarantineRecord>;
  release(quarantineId: string): Promise<void>;
  isQuarantined(sandboxId: string): Promise<boolean>;
  
  // Monitoring
  startMonitoring(sandboxId: string, provider: SandboxProvider, tier: SecurityTier): Promise<void>;
  stopMonitoring(sandboxId: string): Promise<void>;
}

export interface ISecurityIntegration {
  // Runtime monitoring
  attachToSandbox(sandboxId: string): Promise<void>;
  detachFromSandbox(sandboxId: string): Promise<void>;
  
  // Event streaming
  onSecurityEvent(callback: (event: SecurityEvent) => void): void;
  
  // Configuration
  updateConfig(config: any): Promise<void>;
  getStats(): Promise<{ eventsProcessed: number; rulesLoaded: number }>;
}