import { SandboxResult } from '@sandstorm/core';
import {
  SecurityEvent,
  SecurityPolicy,
  MonitoringConfig,
  ComplianceReport,
  ComplianceStandard,
  SignedProvenance,
  QuarantineRecord,
  SecurityMetrics,
} from './types';

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
  evaluateEvent(event: SecurityEvent): Promise<{ action: string; matchedRules: string[] }>;
  
  // Quarantine
  quarantine(sandboxId: string, reason: string, event: SecurityEvent): Promise<QuarantineRecord>;
  release(quarantineId: string): Promise<void>;
  isQuarantined(sandboxId: string): Promise<boolean>;
  
  // Metrics
  getMetrics(timeRange?: { start: Date; end: Date }): Promise<SecurityMetrics>;
}

export interface IFalcoIntegration {
  initialize(config: MonitoringConfig['falco']): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(callback: (event: SecurityEvent) => void): void;
  loadRules(rulesPath: string): Promise<void>;
  getStats(): Promise<{ eventsProcessed: number; rulesLoaded: number }>;
}

export interface IEbpfMonitor {
  initialize(config: MonitoringConfig['ebpf']): Promise<void>;
  attachProgram(programPath: string, attachPoint: string): Promise<void>;
  detachProgram(programId: string): Promise<void>;
  readMap(mapName: string): Promise<any>;
  onTrace(callback: (trace: any) => void): void;
  getLoadedPrograms(): Promise<string[]>;
}

export interface ISiemIntegration {
  initialize(config: MonitoringConfig['siem']): Promise<void>;
  sendEvent(event: SecurityEvent): Promise<void>;
  sendBatch(events: SecurityEvent[]): Promise<void>;
  testConnection(): Promise<boolean>;
  getQueueSize(): number;
}

export interface IComplianceEngine {
  generateReport(
    standard: ComplianceStandard,
    sandboxId?: string,
    timeRange?: { start: Date; end: Date }
  ): Promise<ComplianceReport>;
  
  validateCompliance(
    standard: ComplianceStandard,
    events: SecurityEvent[]
  ): Promise<{ compliant: boolean; violations: string[] }>;
  
  getRequirements(standard: ComplianceStandard): Promise<string[]>;
  
  scheduleReport(
    standard: ComplianceStandard,
    schedule: string // cron expression
  ): Promise<string>;
}

export interface IProvenanceService {
  createProvenance(
    result: SandboxResult,
    events: SecurityEvent[]
  ): Promise<SignedProvenance>;
  
  verifyProvenance(provenance: SignedProvenance): Promise<boolean>;
  
  anchorOnChain(
    provenance: SignedProvenance,
    chainId: string
  ): Promise<{ txHash: string; blockNumber: number }>;
  
  getProvenance(sandboxId: string): Promise<SignedProvenance | null>;
}

export interface ISecurityAggregator {
  // Event Aggregation
  aggregate(events: SecurityEvent[], window: number): Promise<{
    patterns: Array<{
      type: string;
      count: number;
      severity: string;
      sandboxes: string[];
    }>;
    anomalies: SecurityEvent[];
  }>;
  
  // Filtering
  filter(events: SecurityEvent[], rules: Array<{
    field: string;
    operator: 'eq' | 'ne' | 'gt' | 'lt' | 'contains' | 'regex';
    value: any;
  }>): SecurityEvent[];
  
  // Correlation
  correlate(events: SecurityEvent[]): Promise<Array<{
    relatedEvents: SecurityEvent[];
    correlationType: string;
    confidence: number;
  }>>;
  
  // Deduplication
  deduplicate(events: SecurityEvent[], timeWindow: number): SecurityEvent[];
}

export interface ISecurityDashboard {
  // Real-time Metrics
  getRealtimeMetrics(): Promise<{
    eventsPerSecond: number;
    activeSandboxes: number;
    quarantinedSandboxes: number;
    criticalEvents: number;
  }>;
  
  // Historical Data
  getHistoricalData(
    metric: string,
    timeRange: { start: Date; end: Date },
    granularity: 'minute' | 'hour' | 'day'
  ): Promise<Array<{ timestamp: string; value: number }>>;
  
  // Alerts
  getActiveAlerts(): Promise<Array<{
    id: string;
    severity: string;
    message: string;
    timestamp: string;
    acknowledged: boolean;
  }>>;
  
  acknowledgeAlert(alertId: string): Promise<void>;
  
  // WebSocket Support
  subscribeToUpdates(callback: (update: any) => void): () => void;
}