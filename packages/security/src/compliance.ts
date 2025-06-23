import pino from 'pino';
import { IComplianceEngine } from './interfaces';
import {
  ComplianceReport,
  ComplianceStandard,
  SecurityEvent,
} from './types';

interface ComplianceRequirement {
  id: string;
  description: string;
  check: (events: SecurityEvent[]) => boolean;
}

export class ComplianceEngine implements IComplianceEngine {
  private logger = pino({ name: 'compliance-engine' });
  private scheduledReports = new Map<string, NodeJS.Timer>();
  
  private requirements: Record<ComplianceStandard, ComplianceRequirement[]> = {
    'pci-dss': [
      {
        id: 'PCI-DSS-1.1',
        description: 'Install and maintain a firewall configuration',
        check: (events) => !events.some(e => 
          e.type === 'network_activity' && 
          e.severity === 'critical'
        ),
      },
      {
        id: 'PCI-DSS-2.3',
        description: 'Encrypt transmission of cardholder data',
        check: (events) => !events.some(e =>
          e.type === 'network_activity' &&
          e.details?.unencrypted === true
        ),
      },
      {
        id: 'PCI-DSS-8.2',
        description: 'Ensure proper user authentication',
        check: (events) => !events.some(e =>
          e.type === 'privilege_escalation'
        ),
      },
      {
        id: 'PCI-DSS-10.1',
        description: 'Track and monitor all access',
        check: (events) => events.length > 0, // Ensure logging is active
      },
    ],
    'hipaa': [
      {
        id: 'HIPAA-164.308',
        description: 'Administrative safeguards',
        check: (events) => !events.some(e =>
          e.type === 'file_access' &&
          e.metadata?.filePath?.includes('patient')
        ),
      },
      {
        id: 'HIPAA-164.312',
        description: 'Technical safeguards - Access control',
        check: (events) => !events.some(e =>
          e.type === 'privilege_escalation' ||
          (e.type === 'file_access' && e.severity === 'high')
        ),
      },
      {
        id: 'HIPAA-164.314',
        description: 'Organizational requirements',
        check: (events) => events.filter(e =>
          e.type === 'policy_violation'
        ).length < 5,
      },
    ],
    'soc2': [
      {
        id: 'SOC2-CC6.1',
        description: 'Logical and physical access controls',
        check: (events) => !events.some(e =>
          e.type === 'privilege_escalation' ||
          e.severity === 'critical'
        ),
      },
      {
        id: 'SOC2-CC7.2',
        description: 'System monitoring',
        check: (events) => true, // Monitoring is active if we have events
      },
      {
        id: 'SOC2-CC8.1',
        description: 'Change management',
        check: (events) => !events.some(e =>
          e.type === 'file_access' &&
          e.metadata?.filePath?.includes('/etc/')
        ),
      },
    ],
    'iso27001': [
      {
        id: 'ISO27001-A.9',
        description: 'Access control',
        check: (events) => events.filter(e =>
          e.type === 'privilege_escalation'
        ).length === 0,
      },
      {
        id: 'ISO27001-A.12',
        description: 'Operations security',
        check: (events) => events.filter(e =>
          e.severity === 'critical'
        ).length < 3,
      },
      {
        id: 'ISO27001-A.16',
        description: 'Information security incident management',
        check: (events) => events.filter(e =>
          e.type === 'quarantine'
        ).length > 0 || events.filter(e =>
          e.severity === 'critical'
        ).length === 0,
      },
    ],
    'gdpr': [
      {
        id: 'GDPR-32',
        description: 'Security of processing',
        check: (events) => !events.some(e =>
          e.type === 'file_access' &&
          e.metadata?.filePath?.includes('personal_data')
        ),
      },
      {
        id: 'GDPR-33',
        description: 'Notification of breach',
        check: (events) => events.filter(e =>
          e.severity === 'critical' &&
          e.type === 'file_access'
        ).length === 0,
      },
      {
        id: 'GDPR-35',
        description: 'Data protection impact assessment',
        check: (events) => events.filter(e =>
          e.type === 'policy_violation'
        ).length < 10,
      },
    ],
  };

  async generateReport(
    standard: ComplianceStandard,
    sandboxId?: string,
    timeRange?: { start: Date; end: Date }
  ): Promise<ComplianceReport> {
    const requirements = this.requirements[standard];
    if (!requirements) {
      throw new Error(`Unknown compliance standard: ${standard}`);
    }

    // In real implementation, this would fetch events from the security monitor
    const events: SecurityEvent[] = []; // Placeholder

    const findings = requirements.map(req => ({
      requirement: req.id,
      status: req.check(events) ? 'pass' as const : 'fail' as const,
      evidence: events.filter(e => this.isRelevantEvidence(e, req)),
      notes: req.description,
    }));

    const overallStatus = findings.every(f => f.status === 'pass')
      ? 'compliant' as const
      : findings.some(f => f.status === 'pass')
      ? 'partial' as const
      : 'non-compliant' as const;

    const report: ComplianceReport = {
      id: `compliance_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      standard,
      sandboxId,
      startDate: timeRange?.start.toISOString() || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      endDate: timeRange?.end.toISOString() || new Date().toISOString(),
      status: overallStatus,
      findings,
      generatedAt: new Date().toISOString(),
    };

    this.logger.info({
      reportId: report.id,
      standard,
      status: overallStatus,
      findingsCount: findings.length,
      passedCount: findings.filter(f => f.status === 'pass').length,
    }, 'Generated compliance report');

    return report;
  }

  async validateCompliance(
    standard: ComplianceStandard,
    events: SecurityEvent[]
  ): Promise<{ compliant: boolean; violations: string[] }> {
    const requirements = this.requirements[standard];
    if (!requirements) {
      throw new Error(`Unknown compliance standard: ${standard}`);
    }

    const violations: string[] = [];

    for (const req of requirements) {
      if (!req.check(events)) {
        violations.push(`${req.id}: ${req.description}`);
      }
    }

    return {
      compliant: violations.length === 0,
      violations,
    };
  }

  async getRequirements(standard: ComplianceStandard): Promise<string[]> {
    const requirements = this.requirements[standard];
    if (!requirements) {
      throw new Error(`Unknown compliance standard: ${standard}`);
    }

    return requirements.map(req => `${req.id}: ${req.description}`);
  }

  async scheduleReport(
    standard: ComplianceStandard,
    schedule: string
  ): Promise<string> {
    const scheduleId = `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Parse cron expression and set up interval
    // For simplicity, we'll use a basic interval here
    const interval = this.parseCronToInterval(schedule);
    
    const timer = setInterval(async () => {
      try {
        const report = await this.generateReport(standard);
        this.logger.info({
          scheduleId,
          reportId: report.id,
          standard,
        }, 'Scheduled compliance report generated');
        
        // In real implementation, this would store or send the report
      } catch (error) {
        this.logger.error({
          error,
          scheduleId,
          standard,
        }, 'Failed to generate scheduled compliance report');
      }
    }, interval);

    this.scheduledReports.set(scheduleId, timer);

    this.logger.info({
      scheduleId,
      standard,
      schedule,
    }, 'Scheduled compliance report');

    return scheduleId;
  }

  private isRelevantEvidence(event: SecurityEvent, requirement: ComplianceRequirement): boolean {
    // Determine if an event is relevant evidence for a specific requirement
    const relevanceMap: Record<string, (e: SecurityEvent) => boolean> = {
      'PCI-DSS-1.1': (e) => e.type === 'network_activity',
      'PCI-DSS-2.3': (e) => e.type === 'network_activity',
      'PCI-DSS-8.2': (e) => e.type === 'privilege_escalation',
      'PCI-DSS-10.1': (e) => true,
      'HIPAA-164.308': (e) => e.type === 'file_access',
      'HIPAA-164.312': (e) => e.type === 'privilege_escalation' || e.type === 'file_access',
      'HIPAA-164.314': (e) => e.type === 'policy_violation',
      'SOC2-CC6.1': (e) => e.type === 'privilege_escalation',
      'SOC2-CC7.2': (e) => true,
      'SOC2-CC8.1': (e) => e.type === 'file_access',
      'ISO27001-A.9': (e) => e.type === 'privilege_escalation',
      'ISO27001-A.12': (e) => e.severity === 'critical',
      'ISO27001-A.16': (e) => e.type === 'quarantine' || e.severity === 'critical',
      'GDPR-32': (e) => e.type === 'file_access',
      'GDPR-33': (e) => e.severity === 'critical' && e.type === 'file_access',
      'GDPR-35': (e) => e.type === 'policy_violation',
    };

    const checker = relevanceMap[requirement.id];
    return checker ? checker(event) : false;
  }

  private parseCronToInterval(cron: string): number {
    // Simplified cron parsing - in production, use a proper cron parser
    if (cron.includes('daily')) {
      return 24 * 60 * 60 * 1000; // 24 hours
    } else if (cron.includes('weekly')) {
      return 7 * 24 * 60 * 60 * 1000; // 7 days
    } else if (cron.includes('monthly')) {
      return 30 * 24 * 60 * 60 * 1000; // 30 days
    }
    
    return 24 * 60 * 60 * 1000; // Default to daily
  }

  destroy(): void {
    // Clean up scheduled reports
    for (const timer of this.scheduledReports.values()) {
      clearInterval(timer);
    }
    this.scheduledReports.clear();
  }
}