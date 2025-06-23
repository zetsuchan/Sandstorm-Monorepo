import axios, { AxiosInstance } from 'axios';
import { EdgeAgentStatus, EdgeAgentMetrics, TelemetryRelay, LogEntry } from './types';

export class CloudTelemetryRelay implements TelemetryRelay {
  private client: AxiosInstance;
  private buffer: {
    status: EdgeAgentStatus[];
    metrics: EdgeAgentMetrics[];
    logs: LogEntry[];
  } = {
    status: [],
    metrics: [],
    logs: [],
  };
  
  constructor(
    private config: {
      apiUrl: string;
      apiKey: string;
      agentId: string;
      batchSize?: number;
      flushInterval?: number;
    }
  ) {
    this.client = axios.create({
      baseURL: config.apiUrl,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'X-Agent-ID': config.agentId,
      },
      timeout: 30000,
    });
    
    // Start periodic flush
    setInterval(() => this.flush(), config.flushInterval || 30000);
  }
  
  async sendStatus(status: EdgeAgentStatus): Promise<void> {
    this.buffer.status.push(status);
    
    if (this.buffer.status.length >= (this.config.batchSize || 10)) {
      await this.flushStatus();
    }
  }
  
  async sendMetrics(metrics: EdgeAgentMetrics): Promise<void> {
    this.buffer.metrics.push(metrics);
    
    if (this.buffer.metrics.length >= (this.config.batchSize || 50)) {
      await this.flushMetrics();
    }
  }
  
  async sendLogs(logs: LogEntry[]): Promise<void> {
    this.buffer.logs.push(...logs);
    
    if (this.buffer.logs.length >= (this.config.batchSize || 100)) {
      await this.flushLogs();
    }
  }
  
  private async flush(): Promise<void> {
    await Promise.allSettled([
      this.flushStatus(),
      this.flushMetrics(),
      this.flushLogs(),
    ]);
  }
  
  private async flushStatus(): Promise<void> {
    if (this.buffer.status.length === 0) return;
    
    const items = this.buffer.status.splice(0);
    
    try {
      await this.client.post('/v1/edge/status', {
        items,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Re-add items to buffer on failure
      this.buffer.status.unshift(...items.slice(-10)); // Keep only last 10
      console.error('Failed to send status telemetry:', error);
    }
  }
  
  private async flushMetrics(): Promise<void> {
    if (this.buffer.metrics.length === 0) return;
    
    const items = this.buffer.metrics.splice(0);
    
    try {
      await this.client.post('/v1/edge/metrics', {
        items,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Re-add items to buffer on failure
      this.buffer.metrics.unshift(...items.slice(-50)); // Keep only last 50
      console.error('Failed to send metrics telemetry:', error);
    }
  }
  
  private async flushLogs(): Promise<void> {
    if (this.buffer.logs.length === 0) return;
    
    const items = this.buffer.logs.splice(0);
    
    try {
      await this.client.post('/v1/edge/logs', {
        items,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Re-add items to buffer on failure
      this.buffer.logs.unshift(...items.slice(-100)); // Keep only last 100
      console.error('Failed to send logs telemetry:', error);
    }
  }
  
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.get('/v1/edge/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }
}

// Mock telemetry relay for offline/testing
export class MockTelemetryRelay implements TelemetryRelay {
  async sendStatus(status: EdgeAgentStatus): Promise<void> {
    console.log('[MOCK] Status:', JSON.stringify(status, null, 2));
  }
  
  async sendMetrics(metrics: EdgeAgentMetrics): Promise<void> {
    console.log('[MOCK] Metrics:', JSON.stringify(metrics, null, 2));
  }
  
  async sendLogs(logs: LogEntry[]): Promise<void> {
    console.log('[MOCK] Logs:', logs.length, 'entries');
  }
}