import { z } from 'zod';

export const DaytonaConfig = z.object({
  apiKey: z.string(),
  apiUrl: z.string().url().default('https://api.daytona.io'),
  defaultTimeout: z.number().min(1000).max(3600000).default(120000),
  defaultWorkspaceTemplate: z.string().optional(),
  region: z.string().optional(),
  enableTelemetry: z.boolean().default(true),
});
export type DaytonaConfig = z.infer<typeof DaytonaConfig>;

export const WorkspaceTemplate = z.enum([
  'default',
  'python',
  'python-ml',
  'javascript',
  'go',
  'rust',
  'java',
  'dotnet',
  'ruby',
  'custom',
]);
export type WorkspaceTemplate = z.infer<typeof WorkspaceTemplate>;

export interface DaytonaWorkspace {
  id: string;
  name: string;
  status: 'creating' | 'ready' | 'running' | 'stopped' | 'error';
  template: string;
  createdAt: Date;
  lastActivity: Date;
  resources: {
    cpu: number;
    memory: number;
    disk: number;
  };
}

export interface DaytonaExecutionOptions {
  workspaceId?: string;
  workspaceTemplate?: WorkspaceTemplate;
  gitRepo?: string;
  gitBranch?: string;
  persistent?: boolean;
  envVars?: Record<string, string>;
}

export interface DaytonaWorkspaceMetrics {
  cpu: number; // percentage
  memory: number; // MB
  diskIO: {
    read: number; // bytes/sec
    write: number; // bytes/sec
  };
  network: {
    in: number; // bytes/sec
    out: number; // bytes/sec
  };
  processCount: number;
}