import { EventEmitter } from 'eventemitter3';
import pino from 'pino';
import { ISecurityDashboard, ISecurityMonitor } from './interfaces';

interface Alert {
  id: string;
  severity: string;
  message: string;
  timestamp: string;
  acknowledged: boolean;
}

interface RealtimeMetrics {
  eventsPerSecond: number;
  activeSandboxes: number;
  quarantinedSandboxes: number;
  criticalEvents: number;
}

export class SecurityDashboard extends EventEmitter implements ISecurityDashboard {
  private logger = pino({ name: 'security-dashboard' });
  private alerts: Alert[] = [];
  private metricsHistory: Array<{ timestamp: string; metrics: RealtimeMetrics }> = [];
  private updateInterval?: NodeJS.Timer;
  private securityMonitor?: ISecurityMonitor;

  constructor(monitor?: ISecurityMonitor) {
    super();
    this.securityMonitor = monitor;
    
    if (monitor) {
      this.startMonitoring();
    }
  }

  async getRealtimeMetrics(): Promise<RealtimeMetrics> {
    if (!this.securityMonitor) {
      return {
        eventsPerSecond: 0,
        activeSandboxes: 0,
        quarantinedSandboxes: 0,
        criticalEvents: 0,
      };
    }

    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);
    
    const recentEvents = await this.securityMonitor.getEvents({
      startTime: oneMinuteAgo,
      endTime: now,
    });

    const criticalEvents = recentEvents.filter(e => e.severity === 'critical');
    const uniqueSandboxes = new Set(recentEvents.map(e => e.sandboxId));

    const metrics: RealtimeMetrics = {
      eventsPerSecond: recentEvents.length / 60,
      activeSandboxes: uniqueSandboxes.size,
      quarantinedSandboxes: await this.countQuarantinedSandboxes(),
      criticalEvents: criticalEvents.length,
    };

    // Store metrics for history
    this.metricsHistory.push({
      timestamp: now.toISOString(),
      metrics,
    });

    // Keep only last 24 hours of history
    const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
    this.metricsHistory = this.metricsHistory.filter(
      h => new Date(h.timestamp).getTime() > dayAgo
    );

    return metrics;
  }

  async getHistoricalData(
    metric: string,
    timeRange: { start: Date; end: Date },
    granularity: 'minute' | 'hour' | 'day'
  ): Promise<Array<{ timestamp: string; value: number }>> {
    const data: Array<{ timestamp: string; value: number }> = [];
    
    // Filter history within time range
    const filteredHistory = this.metricsHistory.filter(h => {
      const time = new Date(h.timestamp).getTime();
      return time >= timeRange.start.getTime() && time <= timeRange.end.getTime();
    });

    // Aggregate based on granularity
    const buckets = this.createTimeBuckets(timeRange, granularity);
    
    for (const bucket of buckets) {
      const bucketData = filteredHistory.filter(h => {
        const time = new Date(h.timestamp).getTime();
        return time >= bucket.start && time < bucket.end;
      });

      if (bucketData.length > 0) {
        const value = this.aggregateMetric(bucketData, metric);
        data.push({
          timestamp: new Date(bucket.start).toISOString(),
          value,
        });
      }
    }

    return data;
  }

  async getActiveAlerts(): Promise<Alert[]> {
    return this.alerts.filter(a => !a.acknowledged);
  }

  async acknowledgeAlert(alertId: string): Promise<void> {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      this.logger.info({ alertId }, 'Alert acknowledged');
      this.emit('alert:acknowledged', alert);
    }
  }

  subscribeToUpdates(callback: (update: any) => void): () => void {
    this.on('update', callback);
    
    // Return unsubscribe function
    return () => {
      this.off('update', callback);
    };
  }

  private startMonitoring(): void {
    // Subscribe to security events
    if (this.securityMonitor) {
      // Type assertion needed as EventEmitter methods might not be in interface
      const monitor = this.securityMonitor as any;
      
      if (monitor.on) {
        monitor.on('event', (event: any) => {
          this.handleSecurityEvent(event);
        });

        monitor.on('alert', (alert: any) => {
          this.createAlert(alert.event.severity, alert.event.message);
        });

        monitor.on('quarantine', (record: any) => {
          this.createAlert('critical', `Sandbox ${record.sandboxId} quarantined: ${record.reason}`);
        });
      }
    }

    // Start periodic updates
    this.updateInterval = setInterval(() => {
      this.publishUpdate();
    }, 5000); // Update every 5 seconds
  }

  private async publishUpdate(): Promise<void> {
    try {
      const metrics = await this.getRealtimeMetrics();
      const alerts = await this.getActiveAlerts();
      
      const update = {
        timestamp: new Date().toISOString(),
        metrics,
        alerts,
        recentEvents: await this.getRecentEvents(),
      };

      this.emit('update', update);
    } catch (error) {
      this.logger.error({ error }, 'Failed to publish dashboard update');
    }
  }

  private handleSecurityEvent(event: any): void {
    // Create alerts for high-severity events
    if (event.severity === 'critical') {
      this.createAlert('critical', event.message);
    } else if (event.severity === 'high' && event.type === 'privilege_escalation') {
      this.createAlert('high', `Privilege escalation detected in sandbox ${event.sandboxId}`);
    }
  }

  private createAlert(severity: string, message: string): void {
    const alert: Alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      severity,
      message,
      timestamp: new Date().toISOString(),
      acknowledged: false,
    };

    this.alerts.push(alert);
    
    // Keep only last 1000 alerts
    if (this.alerts.length > 1000) {
      this.alerts = this.alerts.slice(-1000);
    }

    this.emit('alert:new', alert);
    this.logger.warn({ alertId: alert.id, severity, message }, 'New security alert');
  }

  private async countQuarantinedSandboxes(): Promise<number> {
    // This would query the actual quarantine records
    // For now, return a placeholder
    return 0;
  }

  private async getRecentEvents(): Promise<any[]> {
    if (!this.securityMonitor) {
      return [];
    }

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const events = await this.securityMonitor.getEvents({
      startTime: fiveMinutesAgo,
      endTime: new Date(),
    });

    return events.slice(-10); // Last 10 events
  }

  private createTimeBuckets(
    timeRange: { start: Date; end: Date },
    granularity: 'minute' | 'hour' | 'day'
  ): Array<{ start: number; end: number }> {
    const buckets: Array<{ start: number; end: number }> = [];
    const interval = this.getInterval(granularity);
    
    let current = timeRange.start.getTime();
    while (current < timeRange.end.getTime()) {
      buckets.push({
        start: current,
        end: current + interval,
      });
      current += interval;
    }

    return buckets;
  }

  private getInterval(granularity: 'minute' | 'hour' | 'day'): number {
    switch (granularity) {
      case 'minute':
        return 60 * 1000;
      case 'hour':
        return 60 * 60 * 1000;
      case 'day':
        return 24 * 60 * 60 * 1000;
    }
  }

  private aggregateMetric(
    data: Array<{ metrics: RealtimeMetrics }>,
    metric: string
  ): number {
    if (data.length === 0) return 0;

    const values = data.map(d => {
      switch (metric) {
        case 'eventsPerSecond':
          return d.metrics.eventsPerSecond;
        case 'activeSandboxes':
          return d.metrics.activeSandboxes;
        case 'quarantinedSandboxes':
          return d.metrics.quarantinedSandboxes;
        case 'criticalEvents':
          return d.metrics.criticalEvents;
        default:
          return 0;
      }
    });

    // Return average
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  destroy(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
    
    this.removeAllListeners();
  }
}