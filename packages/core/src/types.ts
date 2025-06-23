import { z } from 'zod';

export const SandboxProvider = z.enum(['e2b', 'modal', 'daytona', 'morph', 'kubernetes', 'custom']);
export type SandboxProvider = z.infer<typeof SandboxProvider>;

export const Language = z.enum(['python', 'javascript', 'typescript', 'go', 'rust', 'java', 'cpp', 'shell']);
export type Language = z.infer<typeof Language>;

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