import { z } from 'zod';

export const E2BConfig = z.object({
  apiKey: z.string(),
  defaultTimeout: z.number().min(1000).max(3600000).default(120000),
  baseUrl: z.string().optional(),
  maxRetries: z.number().int().positive().default(3),
  enableTelemetry: z.boolean().default(true),
});
export type E2BConfig = z.infer<typeof E2BConfig>;

export const E2BLanguageMap = z.object({
  python: z.literal('python'),
  javascript: z.literal('js'),
  typescript: z.literal('js'),
  ruby: z.literal('ruby'),
  cpp: z.literal('cpp'),
  shell: z.literal('bash'),
});
export type E2BLanguageMap = z.infer<typeof E2BLanguageMap>;

export interface E2BStreamHandlers {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  onError?: (error: Error) => void;
}

export interface E2BExecutionOptions {
  streaming?: boolean;
  persistSession?: boolean;
  sessionId?: string;
  customTemplate?: string;
  envVars?: Record<string, string>;
}

export interface E2BSandboxMetrics {
  executionTime: number;
  cpuTime: number;
  memoryPeak: number;
  networkIn: number;
  networkOut: number;
  filesCreated: number;
  packagesInstalled: string[];
}