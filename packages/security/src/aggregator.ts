import pino from 'pino';
import { ISecurityAggregator } from './interfaces';
import { SecurityEvent, SecurityEventType, SecuritySeverity } from './types';

interface EventPattern {
  type: SecurityEventType;
  count: number;
  severity: SecuritySeverity;
  sandboxes: string[];
  firstSeen: string;
  lastSeen: string;
}

interface CorrelationResult {
  relatedEvents: SecurityEvent[];
  correlationType: string;
  confidence: number;
}

export class SecurityAggregator implements ISecurityAggregator {
  private logger = pino({ name: 'security-aggregator' });

  async aggregate(events: SecurityEvent[], window: number): Promise<{
    patterns: EventPattern[];
    anomalies: SecurityEvent[];
  }> {
    const patterns = new Map<string, EventPattern>();
    const anomalies: SecurityEvent[] = [];
    const windowStart = Date.now() - window;

    // Group events by type and severity
    for (const event of events) {
      const eventTime = new Date(event.timestamp).getTime();
      if (eventTime < windowStart) {
        continue;
      }

      const key = `${event.type}:${event.severity}`;
      const pattern = patterns.get(key);

      if (pattern) {
        pattern.count++;
        if (!pattern.sandboxes.includes(event.sandboxId)) {
          pattern.sandboxes.push(event.sandboxId);
        }
        pattern.lastSeen = event.timestamp;
      } else {
        patterns.set(key, {
          type: event.type,
          count: 1,
          severity: event.severity,
          sandboxes: [event.sandboxId],
          firstSeen: event.timestamp,
          lastSeen: event.timestamp,
        });
      }
    }

    // Detect anomalies
    for (const event of events) {
      if (this.isAnomaly(event, Array.from(patterns.values()))) {
        anomalies.push(event);
      }
    }

    return {
      patterns: Array.from(patterns.values()).sort((a, b) => b.count - a.count),
      anomalies,
    };
  }

  filter(events: SecurityEvent[], rules: Array<{
    field: string;
    operator: 'eq' | 'ne' | 'gt' | 'lt' | 'contains' | 'regex';
    value: any;
  }>): SecurityEvent[] {
    return events.filter(event => {
      for (const rule of rules) {
        const fieldValue = this.getFieldValue(event, rule.field);
        
        if (!this.evaluateRule(fieldValue, rule.operator, rule.value)) {
          return false;
        }
      }
      return true;
    });
  }

  async correlate(events: SecurityEvent[]): Promise<CorrelationResult[]> {
    const correlations: CorrelationResult[] = [];

    // Time-based correlation
    const timeCorrelations = this.correlateByTime(events, 60000); // 1 minute window
    correlations.push(...timeCorrelations);

    // Sandbox-based correlation
    const sandboxCorrelations = this.correlateBySandbox(events);
    correlations.push(...sandboxCorrelations);

    // Attack chain correlation
    const attackChains = this.correlateAttackChains(events);
    correlations.push(...attackChains);

    return correlations;
  }

  deduplicate(events: SecurityEvent[], timeWindow: number): SecurityEvent[] {
    const seen = new Map<string, SecurityEvent>();
    const deduped: SecurityEvent[] = [];

    for (const event of events) {
      const key = this.getEventKey(event);
      const existing = seen.get(key);

      if (!existing) {
        seen.set(key, event);
        deduped.push(event);
      } else {
        const timeDiff = new Date(event.timestamp).getTime() - 
                        new Date(existing.timestamp).getTime();
        
        if (timeDiff > timeWindow) {
          seen.set(key, event);
          deduped.push(event);
        }
      }
    }

    return deduped;
  }

  private isAnomaly(event: SecurityEvent, patterns: EventPattern[]): boolean {
    // Check for rare event types
    const eventTypePattern = patterns.find(p => p.type === event.type);
    if (!eventTypePattern || eventTypePattern.count < 3) {
      return true;
    }

    // Check for unusual severity spikes
    if (event.severity === 'critical' && eventTypePattern.count > 10) {
      return true;
    }

    // Check for suspicious patterns
    if (this.isSuspiciousPattern(event)) {
      return true;
    }

    return false;
  }

  private getFieldValue(event: any, field: string): any {
    const parts = field.split('.');
    let value = event;

    for (const part of parts) {
      value = value?.[part];
      if (value === undefined) {
        return undefined;
      }
    }

    return value;
  }

  private evaluateRule(fieldValue: any, operator: string, ruleValue: any): boolean {
    switch (operator) {
      case 'eq':
        return fieldValue === ruleValue;
      case 'ne':
        return fieldValue !== ruleValue;
      case 'gt':
        return fieldValue > ruleValue;
      case 'lt':
        return fieldValue < ruleValue;
      case 'contains':
        return String(fieldValue).includes(String(ruleValue));
      case 'regex':
        return new RegExp(ruleValue).test(String(fieldValue));
      default:
        return false;
    }
  }

  private correlateByTime(events: SecurityEvent[], window: number): CorrelationResult[] {
    const correlations: CorrelationResult[] = [];
    const eventsByTime = new Map<number, SecurityEvent[]>();

    // Group events by time buckets
    for (const event of events) {
      const bucket = Math.floor(new Date(event.timestamp).getTime() / window);
      const bucketEvents = eventsByTime.get(bucket) || [];
      bucketEvents.push(event);
      eventsByTime.set(bucket, bucketEvents);
    }

    // Find correlated events in same time bucket
    for (const [bucket, bucketEvents] of eventsByTime) {
      if (bucketEvents.length > 1) {
        correlations.push({
          relatedEvents: bucketEvents,
          correlationType: 'temporal',
          confidence: Math.min(0.9, bucketEvents.length / 10),
        });
      }
    }

    return correlations;
  }

  private correlateBySandbox(events: SecurityEvent[]): CorrelationResult[] {
    const correlations: CorrelationResult[] = [];
    const eventsBySandbox = new Map<string, SecurityEvent[]>();

    // Group events by sandbox
    for (const event of events) {
      const sandboxEvents = eventsBySandbox.get(event.sandboxId) || [];
      sandboxEvents.push(event);
      eventsBySandbox.set(event.sandboxId, sandboxEvents);
    }

    // Find sandboxes with multiple high-severity events
    for (const [sandboxId, sandboxEvents] of eventsBySandbox) {
      const highSeverityEvents = sandboxEvents.filter(
        e => e.severity === 'high' || e.severity === 'critical'
      );

      if (highSeverityEvents.length > 1) {
        correlations.push({
          relatedEvents: highSeverityEvents,
          correlationType: 'sandbox_compromise',
          confidence: Math.min(0.95, highSeverityEvents.length / 5),
        });
      }
    }

    return correlations;
  }

  private correlateAttackChains(events: SecurityEvent[]): CorrelationResult[] {
    const correlations: CorrelationResult[] = [];
    
    // Known attack patterns
    const attackPatterns = [
      {
        name: 'privilege_escalation_chain',
        sequence: ['file_access', 'process_spawn', 'privilege_escalation'],
      },
      {
        name: 'data_exfiltration',
        sequence: ['file_access', 'network_activity'],
      },
      {
        name: 'lateral_movement',
        sequence: ['network_activity', 'process_spawn', 'network_activity'],
      },
    ];

    // Group events by sandbox and sort by time
    const eventsBySandbox = new Map<string, SecurityEvent[]>();
    for (const event of events) {
      const sandboxEvents = eventsBySandbox.get(event.sandboxId) || [];
      sandboxEvents.push(event);
      eventsBySandbox.set(event.sandboxId, sandboxEvents);
    }

    // Check each sandbox for attack patterns
    for (const [sandboxId, sandboxEvents] of eventsBySandbox) {
      const sortedEvents = sandboxEvents.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      for (const pattern of attackPatterns) {
        const matchedEvents = this.findSequence(sortedEvents, pattern.sequence);
        if (matchedEvents.length === pattern.sequence.length) {
          correlations.push({
            relatedEvents: matchedEvents,
            correlationType: pattern.name,
            confidence: 0.8,
          });
        }
      }
    }

    return correlations;
  }

  private findSequence(events: SecurityEvent[], sequence: string[]): SecurityEvent[] {
    const matched: SecurityEvent[] = [];
    let sequenceIndex = 0;

    for (const event of events) {
      if (event.type === sequence[sequenceIndex]) {
        matched.push(event);
        sequenceIndex++;
        
        if (sequenceIndex === sequence.length) {
          return matched;
        }
      }
    }

    return [];
  }

  private isSuspiciousPattern(event: SecurityEvent): boolean {
    // Check for known suspicious patterns
    const suspiciousPatterns = [
      /\/etc\/passwd/,
      /\/etc\/shadow/,
      /\.ssh\/id_rsa/,
      /curl.*\|.*sh/,
      /wget.*\|.*bash/,
      /nc.*-e.*\/bin\/sh/,
    ];

    const eventString = JSON.stringify(event).toLowerCase();
    return suspiciousPatterns.some(pattern => pattern.test(eventString));
  }

  private getEventKey(event: SecurityEvent): string {
    // Create a unique key for deduplication
    return `${event.type}:${event.severity}:${event.sandboxId}:${event.message}`;
  }
}