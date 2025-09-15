import { z } from 'zod';
import { SandboxSpec, SandboxResult, SandboxProvider } from '@sandstorm/core';
import {
  EdgeAgentStatus,
  EdgeAgentMetrics,
  LogEntry,
} from '@sandstorm/telemetry';

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
  sendSandboxRun?(payload: {
    telemetry: {
      sandboxId: string;
      provider: SandboxProvider;
      language: string;
      exitCode: number;
      durationMs: number;
      cost: number;
      cpuRequested?: number | null;
      memoryRequested?: number | null;
      hasGpu: boolean;
      timeoutMs?: number | null;
      cpuPercent?: number | null;
      memoryMB?: number | null;
      networkRxBytes?: number | null;
      networkTxBytes?: number | null;
      agentId?: string;
      timestamp: string;
      spec?: Record<string, any>;
      result?: Record<string, any>;
    };
  }): Promise<void>;
}

export type { EdgeAgentStatus, EdgeAgentMetrics, LogEntry };
