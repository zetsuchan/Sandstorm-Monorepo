import { z } from 'zod';

export const ModalConfig = z.object({
  apiKey: z.string(),
  workspace: z.string(),
  defaultTimeout: z.number().min(1000).max(3600000).default(120000),
  defaultImage: z.string().default('python:3.11-slim'),
  region: z.string().optional(),
  enableTelemetry: z.boolean().default(true),
});
export type ModalConfig = z.infer<typeof ModalConfig>;

export const ModalGPUType = z.enum(['T4', 'A10G', 'A100', 'H100', 'L4', 'any']);
export type ModalGPUType = z.infer<typeof ModalGPUType>;

export interface ModalStreamHandlers {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  onExit?: (code: number) => void;
}

export interface ModalExecutionOptions {
  streaming?: boolean;
  containerImage?: string;
  gpu?: boolean;
  gpuType?: ModalGPUType;
  volumes?: Record<string, string>; // mount path -> volume name
  networkAccess?: boolean;
  secrets?: string[]; // Modal secret names
}

export interface ModalFunctionSpec {
  name: string;
  code: string;
  language: string;
  image?: string;
  gpu?: boolean;
  gpuType?: ModalGPUType;
  cpu?: number;
  memory?: number;
  timeout?: number;
}

export interface ModalResourceMetrics {
  cpuCycles: number;
  memoryPeak: number;
  gpuUtilization?: number;
  networkIn: number;
  networkOut: number;
  executionTime: number;
  queueTime: number;
}