import { z } from 'zod';
import { SandboxProvider, SandboxResult } from '@sandstorm/core';

// Security Event Types
export const SecurityEventType = z.enum([
  'file_access',
  'network_activity',
  'process_spawn',
  'privilege_escalation',
  'resource_limit',
  'suspicious_behavior',
  'policy_violation',
  'quarantine',
  'compliance_check'
]);
export type SecurityEventType = z.infer<typeof SecurityEventType>;

export const SecuritySeverity = z.enum(['low', 'medium', 'high', 'critical']);
export type SecuritySeverity = z.infer<typeof SecuritySeverity>;

export const SecurityEvent = z.object({
  id: z.string(),
  type: SecurityEventType,
  severity: SecuritySeverity,
  timestamp: z.string(),
  sandboxId: z.string(),
  provider: SandboxProvider,
  message: z.string(),
  details: z.record(z.any()),
  metadata: z.object({
    pid: z.number().optional(),
    uid: z.number().optional(),
    gid: z.number().optional(),
    executable: z.string().optional(),
    sourceIp: z.string().optional(),
    destinationIp: z.string().optional(),
    port: z.number().optional(),
    filePath: z.string().optional(),
    syscall: z.string().optional(),
  }).optional(),
  falcoRule: z.string().optional(),
  ebpfTrace: z.string().optional(),
});
export type SecurityEvent = z.infer<typeof SecurityEvent>;

// Security Policies
export const PolicyAction = z.enum(['allow', 'deny', 'alert', 'quarantine']);
export type PolicyAction = z.infer<typeof PolicyAction>;

export const SecurityRule = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  condition: z.object({
    type: SecurityEventType.optional(),
    severity: SecuritySeverity.optional(),
    pattern: z.string().optional(),
    threshold: z.number().optional(),
    timeWindow: z.number().optional(), // ms
  }),
  action: PolicyAction,
  notifications: z.array(z.string()).optional(),
});
export type SecurityRule = z.infer<typeof SecurityRule>;

export const SecurityPolicy = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  rules: z.array(SecurityRule),
  tier: z.enum(['basic', 'shield']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SecurityPolicy = z.infer<typeof SecurityPolicy>;

// Monitoring Configuration
export const MonitoringConfig = z.object({
  falco: z.object({
    enabled: z.boolean(),
    rulesFile: z.string().optional(),
    outputFormat: z.enum(['json', 'yaml']).optional(),
  }).optional(),
  ebpf: z.object({
    enabled: z.boolean(),
    programs: z.array(z.string()).optional(),
    maps: z.record(z.any()).optional(),
  }).optional(),
  siem: z.object({
    enabled: z.boolean(),
    webhook: z.string().optional(),
    apiKey: z.string().optional(),
    batchSize: z.number().optional(),
    flushInterval: z.number().optional(), // ms
  }).optional(),
});
export type MonitoringConfig = z.infer<typeof MonitoringConfig>;

// Compliance and Reporting
export const ComplianceStandard = z.enum(['pci-dss', 'hipaa', 'soc2', 'iso27001', 'gdpr']);
export type ComplianceStandard = z.infer<typeof ComplianceStandard>;

export const ComplianceReport = z.object({
  id: z.string(),
  standard: ComplianceStandard,
  sandboxId: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  status: z.enum(['compliant', 'non-compliant', 'partial']),
  findings: z.array(z.object({
    requirement: z.string(),
    status: z.enum(['pass', 'fail', 'not-applicable']),
    evidence: z.array(SecurityEvent),
    notes: z.string().optional(),
  })),
  generatedAt: z.string(),
  signature: z.string().optional(),
});
export type ComplianceReport = z.infer<typeof ComplianceReport>;

// Provenance and Attestation
export const SignedProvenance = z.object({
  sandboxId: z.string(),
  resultHash: z.string(),
  timestamp: z.string(),
  provider: SandboxProvider,
  securityEvents: z.array(z.string()), // Event IDs
  signature: z.string(),
  publicKey: z.string(),
  chainAnchor: z.object({
    txHash: z.string(),
    blockNumber: z.number(),
    chain: z.string(),
  }).optional(),
});
export type SignedProvenance = z.infer<typeof SignedProvenance>;

// Quarantine
export const QuarantineRecord = z.object({
  id: z.string(),
  sandboxId: z.string(),
  reason: z.string(),
  triggeredBy: SecurityEvent,
  startTime: z.string(),
  endTime: z.string().optional(),
  autoRelease: z.boolean(),
  releaseConditions: z.array(z.string()).optional(),
});
export type QuarantineRecord = z.infer<typeof QuarantineRecord>;

// Security Metrics
export const SecurityMetrics = z.object({
  totalEvents: z.number(),
  eventsByType: z.record(z.number()),
  eventsBySeverity: z.record(z.number()),
  quarantinedSandboxes: z.number(),
  policyViolations: z.number(),
  complianceScore: z.number().min(0).max(100),
  avgResponseTime: z.number(), // ms
});