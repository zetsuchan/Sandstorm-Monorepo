import { EventEmitter } from 'eventemitter3';
import pino from 'pino';
import { ISecurityMonitor } from './interfaces';
import {
  SecurityEvent,
  SecurityPolicy,
  QuarantineRecord,
  SecurityMetrics,
  PolicyAction,
  SecurityRule,
} from './types';

export class SecurityMonitor extends EventEmitter implements ISecurityMonitor {
  private logger = pino({ name: 'security-monitor' });
  private events: SecurityEvent[] = [];
  private policies = new Map<string, SecurityPolicy>();
  private quarantines = new Map<string, QuarantineRecord>();
  private eventIndex = new Map<string, Set<number>>(); // sandboxId -> event indices

  async captureEvent(event: SecurityEvent): Promise<void> {
    // Store event
    const index = this.events.length;
    this.events.push(event);

    // Update index
    const sandboxEvents = this.eventIndex.get(event.sandboxId) || new Set();
    sandboxEvents.add(index);
    this.eventIndex.set(event.sandboxId, sandboxEvents);

    // Evaluate policies
    const evaluation = await this.evaluateEvent(event);
    
    // Take action based on policy
    if (evaluation.action === 'quarantine') {
      await this.quarantine(
        event.sandboxId,
        `Policy violation: ${evaluation.matchedRules.join(', ')}`,
        event
      );
    } else if (evaluation.action === 'alert') {
      this.emit('alert', { event, matchedRules: evaluation.matchedRules });
    }

    // Emit event for real-time monitoring
    this.emit('event', event);

    this.logger.info({
      eventId: event.id,
      type: event.type,
      severity: event.severity,
      sandboxId: event.sandboxId,
      action: evaluation.action,
    }, 'Security event captured');
  }

  async getEvents(filters?: {
    sandboxId?: string;
    type?: string;
    severity?: string;
    startTime?: Date;
    endTime?: Date;
  }): Promise<SecurityEvent[]> {
    let filteredEvents = this.events;

    if (filters?.sandboxId) {
      const indices = this.eventIndex.get(filters.sandboxId);
      if (indices) {
        filteredEvents = Array.from(indices).map(i => this.events[i]);
      } else {
        return [];
      }
    }

    if (filters?.type) {
      filteredEvents = filteredEvents.filter(e => e.type === filters.type);
    }

    if (filters?.severity) {
      filteredEvents = filteredEvents.filter(e => e.severity === filters.severity);
    }

    if (filters?.startTime) {
      const startMs = filters.startTime.getTime();
      filteredEvents = filteredEvents.filter(
        e => new Date(e.timestamp).getTime() >= startMs
      );
    }

    if (filters?.endTime) {
      const endMs = filters.endTime.getTime();
      filteredEvents = filteredEvents.filter(
        e => new Date(e.timestamp).getTime() <= endMs
      );
    }

    return filteredEvents;
  }

  async applyPolicy(policy: SecurityPolicy): Promise<void> {
    this.policies.set(policy.id, policy);
    this.logger.info({ policyId: policy.id, name: policy.name }, 'Applied security policy');
  }

  async removePolicy(policyId: string): Promise<void> {
    this.policies.delete(policyId);
    this.logger.info({ policyId }, 'Removed security policy');
  }

  async evaluateEvent(event: SecurityEvent): Promise<{
    action: string;
    matchedRules: string[];
  }> {
    const matchedRules: string[] = [];
    let finalAction: PolicyAction = 'allow';

    // Evaluate all policies
    for (const policy of this.policies.values()) {
      if (!policy.enabled) {
        continue;
      }

      for (const rule of policy.rules) {
        if (this.matchesRule(event, rule)) {
          matchedRules.push(rule.name);
          
          // Use the most restrictive action
          if (this.isMoreRestrictive(rule.action, finalAction)) {
            finalAction = rule.action;
          }
        }
      }
    }

    return {
      action: finalAction,
      matchedRules,
    };
  }

  async quarantine(
    sandboxId: string,
    reason: string,
    event: SecurityEvent
  ): Promise<QuarantineRecord> {
    const record: QuarantineRecord = {
      id: `quarantine_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sandboxId,
      reason,
      triggeredBy: event,
      startTime: new Date().toISOString(),
      autoRelease: false,
    };

    this.quarantines.set(record.id, record);
    
    // Emit quarantine event
    this.emit('quarantine', record);

    this.logger.warn({
      quarantineId: record.id,
      sandboxId,
      reason,
    }, 'Sandbox quarantined');

    return record;
  }

  async release(quarantineId: string): Promise<void> {
    const record = this.quarantines.get(quarantineId);
    if (!record) {
      throw new Error(`Quarantine record ${quarantineId} not found`);
    }

    record.endTime = new Date().toISOString();
    this.quarantines.delete(quarantineId);

    // Emit release event
    this.emit('release', record);

    this.logger.info({
      quarantineId,
      sandboxId: record.sandboxId,
    }, 'Sandbox released from quarantine');
  }

  async isQuarantined(sandboxId: string): Promise<boolean> {
    for (const record of this.quarantines.values()) {
      if (record.sandboxId === sandboxId && !record.endTime) {
        return true;
      }
    }
    return false;
  }

  async getMetrics(timeRange?: { start: Date; end: Date }): Promise<SecurityMetrics> {
    const filteredEvents = timeRange
      ? await this.getEvents({ startTime: timeRange.start, endTime: timeRange.end })
      : this.events;

    const eventsByType: Record<string, number> = {};
    const eventsBySeverity: Record<string, number> = {};

    for (const event of filteredEvents) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
      eventsBySeverity[event.severity] = (eventsBySeverity[event.severity] || 0) + 1;
    }

    const policyViolations = filteredEvents.filter(async e => {
      const evaluation = await this.evaluateEvent(e);
      return evaluation.action !== 'allow';
    }).length;

    return {
      totalEvents: filteredEvents.length,
      eventsByType,
      eventsBySeverity,
      quarantinedSandboxes: this.quarantines.size,
      policyViolations,
      complianceScore: this.calculateComplianceScore(filteredEvents),
      avgResponseTime: this.calculateAvgResponseTime(),
    };
  }

  private matchesRule(event: SecurityEvent, rule: SecurityRule): boolean {
    const condition = rule.condition;

    // Check type
    if (condition.type && event.type !== condition.type) {
      return false;
    }

    // Check severity
    if (condition.severity && !this.isSeverityMatch(event.severity, condition.severity)) {
      return false;
    }

    // Check pattern
    if (condition.pattern) {
      const regex = new RegExp(condition.pattern);
      const eventString = JSON.stringify(event);
      if (!regex.test(eventString)) {
        return false;
      }
    }

    // Check threshold (requires aggregation)
    if (condition.threshold && condition.timeWindow) {
      const count = this.countSimilarEvents(event, condition.timeWindow);
      if (count < condition.threshold) {
        return false;
      }
    }

    return true;
  }

  private isMoreRestrictive(action1: PolicyAction, action2: PolicyAction): boolean {
    const restrictiveness: Record<PolicyAction, number> = {
      'allow': 0,
      'alert': 1,
      'deny': 2,
      'quarantine': 3,
    };

    return restrictiveness[action1] > restrictiveness[action2];
  }

  private isSeverityMatch(eventSeverity: string, ruleSeverity: string): boolean {
    const severityLevels: Record<string, number> = {
      'low': 1,
      'medium': 2,
      'high': 3,
      'critical': 4,
    };

    return severityLevels[eventSeverity] >= severityLevels[ruleSeverity];
  }

  private countSimilarEvents(event: SecurityEvent, timeWindow: number): number {
    const windowStart = new Date(event.timestamp).getTime() - timeWindow;
    
    return this.events.filter(e =>
      e.type === event.type &&
      e.sandboxId === event.sandboxId &&
      new Date(e.timestamp).getTime() >= windowStart
    ).length;
  }

  private calculateComplianceScore(events: SecurityEvent[]): number {
    if (events.length === 0) {
      return 100;
    }

    const criticalEvents = events.filter(e => e.severity === 'critical').length;
    const highEvents = events.filter(e => e.severity === 'high').length;
    
    const score = 100 - (criticalEvents * 10) - (highEvents * 5);
    return Math.max(0, Math.min(100, score));
  }

  private calculateAvgResponseTime(): number {
    // This would track actual response times in production
    // For now, return a placeholder
    return 150; // ms
  }
}