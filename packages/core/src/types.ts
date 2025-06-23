import { z } from 'zod';

export const SandboxProvider = z.enum(['e2b', 'modal', 'daytona', 'morph', 'kubernetes', 'bare-metal', 'edge', 'custom']);
export type SandboxProvider = z.infer<typeof SandboxProvider>;

export const Language = z.enum(['python', 'javascript', 'typescript', 'go', 'rust', 'java', 'cpp', 'shell']);
export type Language = z.infer<typeof Language>;

export const IsolationLevel = z.enum(['standard', 'strong', 'maximum']);
export type IsolationLevel = z.infer<typeof IsolationLevel>;

export const RuntimeType = z.enum(['firecracker', 'gvisor', 'kata']);
export type RuntimeType = z.infer<typeof RuntimeType>;

export const SandboxSpec = z.object({
  code: z.string(),
  language: Language,
  cpu: z.number().min(0.1).max(64).optional(),
  memory: z.number().min(128).max(65536).optional(), // MB
  timeout: z.number().min(1000).max(3600000).optional(), // ms
  gpu: z.boolean().optional(),
  gpuType: z.string().optional(),
  requirements: z.array(z.string()).optional(),
  environment: z.record(z.string()).optional(),
  files: z.record(z.string()).optional(),
  stateful: z.boolean().optional(),
  region: z.string().optional(),
  bootcHash: z.string().optional(), // Hash of the bootc image
  dockerfile: z.string().optional(), // Dockerfile content for bootc building
  isolationLevel: IsolationLevel.default('standard'),
  runtimePreference: RuntimeType.optional(),
});
export type SandboxSpec = z.infer<typeof SandboxSpec>;

export const SandboxConstraints = z.object({
  maxCost: z.number().positive().optional(),
  maxLatency: z.number().positive().optional(),
  preferredProviders: z.array(SandboxProvider).optional(),
  excludeProviders: z.array(SandboxProvider).optional(),
  preferredRegion: z.string().optional(),
  requireGpu: z.boolean().optional(),
});
export type SandboxConstraints = z.infer<typeof SandboxConstraints>;

export const SandboxResult = z.object({
  id: z.string(),
  provider: SandboxProvider,
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  duration: z.number(),
  cost: z.number(),
  files: z.record(z.string()).optional(),
  logs: z.array(z.object({
    timestamp: z.string(),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string(),
  })).optional(),
  metrics: z.object({
    cpuUsage: z.number().optional(),
    memoryUsage: z.number().optional(),
    gpuUsage: z.number().optional(),
  }).optional(),
});
export type SandboxResult = z.infer<typeof SandboxResult>;

export const SandboxSnapshot = z.object({
  id: z.string(),
  sandboxId: z.string(),
  provider: SandboxProvider,
  timestamp: z.string(),
  filesystemHash: z.string(),
  memoryHash: z.string().optional(),
  size: z.number(),
  metadata: z.record(z.any()).optional(),
});
export type SandboxSnapshot = z.infer<typeof SandboxSnapshot>;

// Bootc-specific types
export const BootcImageSpec = z.object({
  baseImage: z.string(),
  dockerfile: z.string(),
  packages: z.array(z.string()).optional(),
  systemdUnits: z.array(z.object({
    name: z.string(),
    content: z.string(),
  })).optional(),
  kernelArgs: z.array(z.string()).optional(),
  bootType: z.enum(['efi', 'bios']).default('efi'),
});
export type BootcImageSpec = z.infer<typeof BootcImageSpec>;

export const BootcBuildResult = z.object({
  imageHash: z.string(),
  imageSize: z.number(),
  ociDigest: z.string(),
  buildTime: z.number(),
  layers: z.array(z.object({
    digest: z.string(),
    size: z.number(),
  })),
});
export type BootcBuildResult = z.infer<typeof BootcBuildResult>;

export const BareMetalNode = z.object({
  id: z.string(),
  ipAddress: z.string(),
  macAddress: z.string(),
  hostname: z.string(),
  status: z.enum(['available', 'provisioning', 'running', 'error']),
  bootcHash: z.string().optional(),
  specs: z.object({
    cpu: z.number(),
    memory: z.number(),
    disk: z.number(),
    gpu: z.boolean(),
    gpuType: z.string().optional(),
  }),
});
export type BareMetalNode = z.infer<typeof BareMetalNode>;

// Security-related types
export const SecurityTier = z.enum(['basic', 'shield']);
export type SecurityTier = z.infer<typeof SecurityTier>;

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

export const SecurityPolicy = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  tier: SecurityTier,
  rules: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    condition: z.object({
      type: SecurityEventType.optional(),
      severity: SecuritySeverity.optional(),
      pattern: z.string().optional(),
      threshold: z.number().optional(),
      timeWindow: z.number().optional(),
    }),
    action: z.enum(['allow', 'deny', 'alert', 'quarantine']),
    notifications: z.array(z.string()).optional(),
  })),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SecurityPolicy = z.infer<typeof SecurityPolicy>;

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