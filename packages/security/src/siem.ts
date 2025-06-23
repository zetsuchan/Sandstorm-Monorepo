import axios, { AxiosInstance } from 'axios';
import pino from 'pino';
import { ISiemIntegration } from './interfaces';
import { SecurityEvent, MonitoringConfig } from './types';

export class SiemIntegration implements ISiemIntegration {
  private logger = pino({ name: 'siem-integration' });
  private config?: MonitoringConfig['siem'];
  private client?: AxiosInstance;
  private eventQueue: SecurityEvent[] = [];
  private flushTimer?: NodeJS.Timeout;

  async initialize(config: MonitoringConfig['siem']): Promise<void> {
    this.config = config;
    
    if (!config?.enabled || !config.webhook) {
      this.logger.info('SIEM integration disabled');
      return;
    }

    this.client = axios.create({
      baseURL: config.webhook,
      headers: {
        'Authorization': config.apiKey ? `Bearer ${config.apiKey}` : undefined,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Start flush timer
    const flushInterval = config.flushInterval || 5000;
    this.flushTimer = setInterval(() => {
      this.flushQueue().catch((error) => {
        this.logger.error({ error }, 'Failed to flush event queue');
      });
    }, flushInterval);

    this.logger.info({ webhook: config.webhook }, 'SIEM integration initialized');
  }

  async sendEvent(event: SecurityEvent): Promise<void> {
    if (!this.config?.enabled) {
      return;
    }

    this.eventQueue.push(event);

    // Check if we should flush immediately
    const batchSize = this.config?.batchSize || 100;
    if (this.eventQueue.length >= batchSize) {
      await this.flushQueue();
    }
  }

  async sendBatch(events: SecurityEvent[]): Promise<void> {
    if (!this.config?.enabled || !this.client) {
      return;
    }

    try {
      const payload = this.formatSiemPayload(events);
      
      await this.client.post('', payload, {
        headers: {
          'X-Event-Count': events.length.toString(),
          'X-Sandstorm-Source': 'security-monitor',
        },
      });

      this.logger.info({ count: events.length }, 'Sent events to SIEM');
    } catch (error) {
      this.logger.error({ error, eventCount: events.length }, 'Failed to send events to SIEM');
      
      // Re-queue events if failed
      this.eventQueue.unshift(...events);
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.config?.enabled || !this.client) {
      return false;
    }

    try {
      const response = await this.client.get('/health', {
        validateStatus: (status) => status < 500,
      });
      
      return response.status === 200;
    } catch (error) {
      this.logger.error({ error }, 'SIEM connection test failed');
      return false;
    }
  }

  getQueueSize(): number {
    return this.eventQueue.length;
  }

  private async flushQueue(): Promise<void> {
    if (this.eventQueue.length === 0) {
      return;
    }

    const batchSize = this.config?.batchSize || 100;
    const batch = this.eventQueue.splice(0, batchSize);

    try {
      await this.sendBatch(batch);
    } catch (error) {
      // Events are re-queued in sendBatch on failure
      this.logger.error({ error }, 'Failed to flush event queue');
    }
  }

  private formatSiemPayload(events: SecurityEvent[]): any {
    // Format events for common SIEM formats
    // This can be customized based on the SIEM provider
    
    // Splunk HEC format
    if (this.config?.webhook?.includes('splunk')) {
      return events.map(event => ({
        time: new Date(event.timestamp).getTime() / 1000,
        sourcetype: 'sandstorm:security',
        event: {
          ...event,
          _raw: JSON.stringify(event),
        },
      }));
    }

    // Elasticsearch/ELK format
    if (this.config?.webhook?.includes('elastic')) {
      return {
        events: events.map(event => ({
          '@timestamp': event.timestamp,
          '@metadata': {
            beat: 'sandstorm',
            type: '_doc',
            version: '1.0.0',
          },
          ...event,
        })),
      };
    }

    // Generic JSON format
    return {
      source: 'sandstorm-security',
      timestamp: new Date().toISOString(),
      events,
    };
  }

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    
    // Final flush
    this.flushQueue().catch((error) => {
      this.logger.error({ error }, 'Failed to perform final flush');
    });
  }
}