import { z } from 'zod';
import { SandboxSpec, SandboxResult, SandboxProvider } from '@sandstorm/core';

export const EdgeAgentConfig = z.object({
  // Agent identification
  agentId: z.string().uuid().optional(),
  agentName: z.string().min(1),
  
  // Connection settings
  cloudApiUrl: z.string().url().default('https://api.sandstorm.dev'),
  apiKey: z.string().min(1),
  
  // Runtime configuration
  runtime: z.enum(['podman', 'docker']).default('podman'),
  rootless: z.boolean().default(true),
  
  // Networking
  listenPort: z.number().min(1024).max(65535).default(8080),
  listenHost: z.string().default('0.0.0.0'),
  publicUrl: z.string().url().optional(),
  
  // Resource limits
  maxConcurrentSandboxes: z.number().min(1).default(10),
  maxMemoryMB: z.number().min(512).default(8192),
  maxCpuCores: z.number().min(1).default(4),
  
  // Storage
  workDir: z.string().default('/var/lib/sandstorm-edge'),
  tempDir: z.string().default('/tmp/sandstorm-edge'),
  
  // Telemetry
  telemetryInterval: z.number().min(5000).default(30000),
  metricsRetention: z.number().min(3600).default(86400),
  
  // Security
  allowedImages: z.array(z.string()).optional(),
  blockedImages: z.array(z.string()).optional(),
  enableNetworkIsolation: z.boolean().default(true),
  
  // VPC Configuration
  vpcMode: z.boolean().default(false),
  vpcCidr: z.string().optional(),
  dnsServers: z.array(z.string()).optional(),
});
export type EdgeAgentConfig = z.infer<typeof EdgeAgentConfig>;

export const EdgeAgentStatus = z.object({
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
export type EdgeAgentStatus = z.infer<typeof EdgeAgentStatus>;

export const EdgeAgentMetrics = z.object({
  timestamp: z.string().datetime(),
  agentId: z.string(),
  
  sandboxMetrics: z.object({
    totalRuns: z.number(),
    successRate: z.number(),
    avgDuration: z.number(),
    avgMemoryMB: z.number(),
    avgCpuPercent: z.number(),
  }),
  
  systemMetrics: z.object({
    cpuUsage: z.array(z.number()),
    memoryUsage: z.array(z.number()),
    diskIO: z.object({
      readBytesPerSec: z.number(),
      writeBytesPerSec: z.number(),
    }),
    networkIO: z.object({
      rxBytesPerSec: z.number(),
      txBytesPerSec: z.number(),
    }),
  }),
  
  errorCounts: z.record(z.string(), z.number()),
});
export type EdgeAgentMetrics = z.infer<typeof EdgeAgentMetrics>;

export interface ContainerRuntime {
  name: string;
  isAvailable(): Promise<boolean>;
  runSandbox(spec: SandboxSpec, config: EdgeAgentConfig): Promise<SandboxResult>;
  cleanup(containerId: string): Promise<void>;
  getContainerStats(containerId: string): Promise<{
    cpuPercent: number;
    memoryMB: number;
    networkRxBytes: number;
    networkTxBytes: number;
  }>;
}

export interface TelemetryRelay {
  sendStatus(status: EdgeAgentStatus): Promise<void>;
  sendMetrics(metrics: EdgeAgentMetrics): Promise<void>;
  sendLogs(logs: LogEntry[]): Promise<void>;
}

export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, any>;
}