import axios, { AxiosInstance } from 'axios';
import { SandboxSpec, SandboxResult, SandboxConstraints, SandboxSnapshot } from '@sandstorm/core';

export interface SandstormConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface RunOptions {
  code: string;
  language?: 'python' | 'javascript' | 'typescript' | 'go' | 'rust' | 'java' | 'cpp' | 'shell';
  requirements?: string[];
  environment?: Record<string, string>;
  files?: Record<string, string>;
  constraints?: SandboxConstraints & {
    cpu?: number;
    memory?: number;
    timeout?: number;
    gpu?: boolean;
  };
}

export class Sandstorm {
  private client: AxiosInstance;

  constructor(config: SandstormConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl || 'https://api.sandstorm.dev',
      timeout: config.timeout || 60000,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async run(options: RunOptions | SandboxSpec & { constraints?: SandboxConstraints }): Promise<SandboxResult> {
    const spec: SandboxSpec = 'code' in options ? {
      code: options.code,
      language: options.language || 'python',
      requirements: options.requirements,
      environment: options.environment,
      files: options.files,
    } : options;

    const response = await this.client.post<SandboxResult>('/v1/sandboxes/run', {
      spec,
      constraints: options.constraints,
    });

    return response.data;
  }

  async snapshot(sandboxId: string): Promise<SandboxSnapshot> {
    const response = await this.client.post<SandboxSnapshot>(`/v1/sandboxes/${sandboxId}/snapshot`);
    return response.data;
  }

  async restore(snapshotId: string): Promise<string> {
    const response = await this.client.post<{ sandboxId: string }>(`/v1/snapshots/${snapshotId}/restore`);
    return response.data.sandboxId;
  }

  async listSnapshots(filters?: { sandboxId?: string; provider?: string }): Promise<SandboxSnapshot[]> {
    const response = await this.client.get<SandboxSnapshot[]>('/v1/snapshots', { params: filters });
    return response.data;
  }

  async getUsage(timeRange?: { start: Date; end: Date }): Promise<{
    totalRuns: number;
    totalCost: number;
    avgLatency: number;
    providerBreakdown: Record<string, number>;
  }> {
    const params = timeRange ? {
      start: timeRange.start.toISOString(),
      end: timeRange.end.toISOString(),
    } : undefined;

    const response = await this.client.get('/v1/usage', { params });
    return response.data;
  }
}