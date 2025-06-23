import { EventEmitter } from 'eventemitter3';
import { spawn, ChildProcess } from 'child_process';
import { readFile } from 'fs/promises';
import pino from 'pino';
import { IFalcoIntegration } from './interfaces';
import { SecurityEvent, SecurityEventType, SecuritySeverity, MonitoringConfig } from './types';

export class FalcoIntegration extends EventEmitter implements IFalcoIntegration {
  private logger = pino({ name: 'falco-integration' });
  private config?: MonitoringConfig['falco'];
  private falcoProcess?: ChildProcess;
  private eventsProcessed = 0;
  private rulesLoaded = 0;

  async initialize(config: MonitoringConfig['falco']): Promise<void> {
    this.config = config;
    if (!config?.enabled) {
      this.logger.info('Falco integration disabled');
      return;
    }

    // Load custom rules if provided
    if (config.rulesFile) {
      await this.loadRules(config.rulesFile);
    }
  }

  async start(): Promise<void> {
    if (!this.config?.enabled) {
      return;
    }

    const args = [
      '-o', 'json_output=true',
      '-o', 'json_include_output_property=true',
    ];

    if (this.config.rulesFile) {
      args.push('-r', this.config.rulesFile);
    }

    this.falcoProcess = spawn('falco', args);

    this.falcoProcess.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const falcoEvent = JSON.parse(line);
          this.processFalcoEvent(falcoEvent);
        } catch (error) {
          this.logger.error({ error, line }, 'Failed to parse Falco event');
        }
      }
    });

    this.falcoProcess.stderr?.on('data', (data) => {
      this.logger.error({ stderr: data.toString() }, 'Falco stderr');
    });

    this.falcoProcess.on('error', (error) => {
      this.logger.error({ error }, 'Falco process error');
    });

    this.falcoProcess.on('exit', (code) => {
      this.logger.info({ code }, 'Falco process exited');
    });

    this.logger.info('Falco integration started');
  }

  async stop(): Promise<void> {
    if (this.falcoProcess) {
      this.falcoProcess.kill('SIGTERM');
      await new Promise((resolve) => {
        this.falcoProcess?.on('exit', resolve);
      });
      this.falcoProcess = undefined;
    }
  }

  onEvent(callback: (event: SecurityEvent) => void): void {
    this.on('event', callback);
  }

  async loadRules(rulesPath: string): Promise<void> {
    try {
      const rulesContent = await readFile(rulesPath, 'utf-8');
      // Count rules (simple approximation)
      this.rulesLoaded = (rulesContent.match(/- rule:/g) || []).length;
      this.logger.info({ rulesPath, count: this.rulesLoaded }, 'Loaded Falco rules');
    } catch (error) {
      this.logger.error({ error, rulesPath }, 'Failed to load Falco rules');
      throw error;
    }
  }

  async getStats(): Promise<{ eventsProcessed: number; rulesLoaded: number }> {
    return {
      eventsProcessed: this.eventsProcessed,
      rulesLoaded: this.rulesLoaded,
    };
  }

  private processFalcoEvent(falcoEvent: any): void {
    this.eventsProcessed++;

    const securityEvent: SecurityEvent = {
      id: `falco_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: this.mapFalcoEventType(falcoEvent.rule),
      severity: this.mapFalcoSeverity(falcoEvent.priority),
      timestamp: falcoEvent.time,
      sandboxId: this.extractSandboxId(falcoEvent),
      provider: 'custom' as any, // Will be enriched by the monitor
      message: falcoEvent.output,
      details: falcoEvent.output_fields || {},
      metadata: {
        pid: falcoEvent.output_fields?.proc_pid,
        uid: falcoEvent.output_fields?.user,
        gid: falcoEvent.output_fields?.group,
        executable: falcoEvent.output_fields?.proc_name,
        syscall: falcoEvent.output_fields?.syscall,
      },
      falcoRule: falcoEvent.rule,
    };

    this.emit('event', securityEvent);
  }

  private mapFalcoEventType(rule: string): SecurityEventType {
    const ruleMapping: Record<string, SecurityEventType> = {
      'Write below etc': 'file_access',
      'Read sensitive file': 'file_access',
      'Outbound Connection': 'network_activity',
      'Inbound Connection': 'network_activity',
      'Spawned Process': 'process_spawn',
      'Run shell': 'process_spawn',
      'Sudo': 'privilege_escalation',
      'Change thread namespace': 'privilege_escalation',
      'Container escape': 'suspicious_behavior',
      'Crypto mining': 'suspicious_behavior',
    };

    for (const [pattern, type] of Object.entries(ruleMapping)) {
      if (rule.includes(pattern)) {
        return type;
      }
    }

    return 'policy_violation';
  }

  private mapFalcoSeverity(priority: string): SecuritySeverity {
    switch (priority.toUpperCase()) {
      case 'EMERGENCY':
      case 'ALERT':
      case 'CRITICAL':
        return 'critical';
      case 'ERROR':
        return 'high';
      case 'WARNING':
        return 'medium';
      case 'NOTICE':
      case 'INFO':
      case 'DEBUG':
        return 'low';
      default:
        return 'medium';
    }
  }

  private extractSandboxId(falcoEvent: any): string {
    // Try to extract sandbox ID from container name or labels
    const containerName = falcoEvent.output_fields?.container_name;
    if (containerName?.startsWith('sandbox_')) {
      return containerName.replace('sandbox_', '');
    }

    // Try to extract from Kubernetes labels
    const k8sLabels = falcoEvent.output_fields?.k8s_labels;
    if (k8sLabels?.['sandstorm.io/sandbox-id']) {
      return k8sLabels['sandstorm.io/sandbox-id'];
    }

    // Default fallback
    return 'unknown';
  }
}