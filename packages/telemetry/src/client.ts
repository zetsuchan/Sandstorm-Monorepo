import axios, { AxiosInstance } from 'axios';
import {
  EdgeAgentMetrics,
  EdgeMetricsBatchSchema,
  EdgeAgentStatus,
  EdgeStatusBatchSchema,
  EdgeLogBatchSchema,
  LogEntry,
  SandboxRunTelemetry,
  SandboxRunTelemetrySchema,
} from './types';

export interface EdgeTelemetryClientOptions {
  baseUrl: string;
  apiKey?: string;
  agentId?: string;
  timeoutMs?: number;
}

export class EdgeTelemetryClient {
  private client: AxiosInstance;
  private agentId?: string;

  constructor(options: EdgeTelemetryClientOptions) {
    this.client = axios.create({
      baseURL: options.baseUrl,
      timeout: options.timeoutMs || 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        ...(options.agentId ? { 'X-Agent-ID': options.agentId } : {}),
      },
    });
    this.agentId = options.agentId;
  }

  async sendStatus(items: EdgeAgentStatus[]): Promise<void> {
    if (items.length === 0) return;
    const payload = EdgeStatusBatchSchema.parse({
      items,
      timestamp: new Date().toISOString(),
    });
    await this.client.post('/v1/edge/status', payload);
  }

  async sendMetrics(items: EdgeAgentMetrics[]): Promise<void> {
    if (items.length === 0) return;
    const payload = EdgeMetricsBatchSchema.parse({
      items,
      timestamp: new Date().toISOString(),
    });
    await this.client.post('/v1/edge/metrics', payload);
  }

  async sendLogs(items: LogEntry[]): Promise<void> {
    if (items.length === 0) return;
    const payload = EdgeLogBatchSchema.parse({
      items,
      timestamp: new Date().toISOString(),
    });
    await this.client.post('/v1/edge/logs', payload);
  }

  async sendSandboxRun(run: SandboxRunTelemetry): Promise<void> {
    const payload = SandboxRunTelemetrySchema.parse({
      ...run,
      agentId: run.agentId || this.agentId,
    });
    await this.client.post('/api/telemetry/sandbox-run', payload);
  }

  async health(): Promise<boolean> {
    try {
      const response = await this.client.get('/v1/edge/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
