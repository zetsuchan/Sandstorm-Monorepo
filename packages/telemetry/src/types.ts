import { z } from 'zod';
import { Language, SandboxProvider } from '@sandstorm/core';

export const LogEntrySchema = z.object({
  timestamp: z.string().datetime(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string(),
  context: z.record(z.any()).optional(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

export const EdgeAgentStatusSchema = z.object({
  agentId: z.string(),
  status: z.enum(['starting', 'running', 'degraded', 'stopping', 'stopped']),
  version: z.string(),
  uptime: z.number(),
  lastHealthCheck: z.string().datetime(),
  runtime: z.object({
    type: z.enum(['podman', 'docker']),
    version: z.string(),
    rootless: z.boolean(),
    socketPath: z.string().optional(),
  }),
  resources: z.object({
    totalMemoryMB: z.number(),
    usedMemoryMB: z.number(),
    totalCpuCores: z.number(),
    cpuUsagePercent: z.number(),
    diskUsageGB: z.number(),
  }),
  sandboxes: z.object({
    running: z.number(),
    completed: z.number(),
    failed: z.number(),
    queued: z.number(),
  }),
  connectivity: z.object({
    cloudApi: z.boolean(),
    lastSync: z.string().datetime().optional(),
    publicEndpoint: z.string().optional(),
  }),
});
export type EdgeAgentStatus = z.infer<typeof EdgeAgentStatusSchema>;

export const EdgeSystemMetricsSchema = z.object({
  cpuPercent: z.number(),
  loadAverage: z.tuple([z.number(), z.number(), z.number()]),
  memory: z.object({
    totalMB: z.number(),
    usedMB: z.number(),
  }),
  network: z.object({
    rxBytesPerSec: z.number(),
    txBytesPerSec: z.number(),
  }),
  disk: z.object({
    readBytesPerSec: z.number(),
    writeBytesPerSec: z.number(),
  }),
});
export type EdgeSystemMetrics = z.infer<typeof EdgeSystemMetricsSchema>;

export const EdgeSandboxRunMetricsSchema = z.object({
  sandboxId: z.string(),
  agentId: z.string(),
  provider: SandboxProvider,
  language: Language,
  durationMs: z.number(),
  exitCode: z.number(),
  cpuPercent: z.number().nullable(),
  memoryMB: z.number().nullable(),
  networkRxBytes: z.number().nullable(),
  networkTxBytes: z.number().nullable(),
  timestamp: z.string().datetime(),
});
export type EdgeSandboxRunMetrics = z.infer<typeof EdgeSandboxRunMetricsSchema>;

export const EdgeAgentMetricsSchema = z.object({
  timestamp: z.string().datetime(),
  agentId: z.string(),
  queueDepth: z.number(),
  running: z.number(),
  completed: z.number(),
  failed: z.number(),
  system: EdgeSystemMetricsSchema,
  sandboxRun: EdgeSandboxRunMetricsSchema.optional(),
  errorsLastWindow: z.record(z.string(), z.number()).optional(),
});
export type EdgeAgentMetrics = z.infer<typeof EdgeAgentMetricsSchema>;

export const EdgeStatusBatchSchema = z.object({
  items: z.array(EdgeAgentStatusSchema),
  timestamp: z.string().datetime(),
});
export type EdgeStatusBatch = z.infer<typeof EdgeStatusBatchSchema>;

export const EdgeMetricsBatchSchema = z.object({
  items: z.array(EdgeAgentMetricsSchema),
  timestamp: z.string().datetime(),
});
export type EdgeMetricsBatch = z.infer<typeof EdgeMetricsBatchSchema>;

export const EdgeLogBatchSchema = z.object({
  items: z.array(LogEntrySchema),
  timestamp: z.string().datetime(),
});
export type EdgeLogBatch = z.infer<typeof EdgeLogBatchSchema>;

export const SandboxRunTelemetrySchema = z.object({
  sandboxId: z.string(),
  provider: SandboxProvider,
  language: Language,
  exitCode: z.number(),
  durationMs: z.number(),
  cost: z.number().nonnegative().default(0),
  cpuRequested: z.number().nullable().optional(),
  memoryRequested: z.number().nullable().optional(),
  hasGpu: z.boolean().default(false),
  timeoutMs: z.number().nullable().optional(),
  cpuPercent: z.number().nullable().optional(),
  memoryMB: z.number().nullable().optional(),
  networkRxBytes: z.number().nullable().optional(),
  networkTxBytes: z.number().nullable().optional(),
  agentId: z.string().optional(),
  timestamp: z.string().datetime(),
  spec: z.any().optional(),
  result: z.any().optional(),
});
export type SandboxRunTelemetry = z.infer<typeof SandboxRunTelemetrySchema>;
