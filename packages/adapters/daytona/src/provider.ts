/**
 * @license MIT
 * @copyright 2025 Sandstorm Contributors
 * @module @sandstorm/adapters-daytona
 */

import { Daytona } from '@daytonaio/sdk';
import { v4 as uuidv4 } from 'uuid';
import { 
  ISandboxProvider,
  SandboxProvider,
  SandboxSpec,
  SandboxResult,
  SandboxSnapshot,
  Language,
} from '@sandstorm/core';
import { 
  DaytonaConfig,
  WorkspaceTemplate,
  DaytonaWorkspace,
  DaytonaExecutionOptions,
  DaytonaWorkspaceMetrics,
} from './types';

export class DaytonaProvider implements ISandboxProvider {
  readonly name: SandboxProvider = 'daytona';
  private config: DaytonaConfig;
  private client: Daytona;
  private activeWorkspaces: Map<string, DaytonaWorkspace>;
  private workspaceMetrics: Map<string, DaytonaWorkspaceMetrics>;

  constructor(config: DaytonaConfig) {
    this.config = DaytonaConfig.parse(config);
    this.client = new Daytona({
      apiKey: this.config.apiKey,
      baseUrl: this.config.apiUrl,
    });
    this.activeWorkspaces = new Map();
    this.workspaceMetrics = new Map();
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Try to create a minimal test sandbox
      const testSandbox = await this.client.create({
        language: 'python',
        timeout: 5000,
      });
      
      // Clean up test sandbox
      if (testSandbox && testSandbox.id) {
        await this.client.destroy(testSandbox.id);
      }
      
      return true;
    } catch (error) {
      console.error('Daytona availability check failed:', error);
      return false;
    }
  }

  async estimateCost(spec: SandboxSpec): Promise<number> {
    // Daytona pricing model (estimated)
    const baseRatePerMinute = 0.01; // $0.01 per minute
    const estimatedMinutes = Math.ceil((spec.timeout || this.config.defaultTimeout) / 60000);
    
    let costMultiplier = 1;
    
    // Higher CPU/memory costs more
    if (spec.cpu && spec.cpu > 2) {
      costMultiplier *= 1.5;
    }
    if (spec.memory && spec.memory > 2048) {
      costMultiplier *= 1.3;
    }
    
    // GPU instances cost significantly more
    if (spec.gpu) {
      costMultiplier *= 5;
    }
    
    // Persistent workspaces have storage costs
    if (spec.stateful) {
      costMultiplier *= 1.2;
    }
    
    return baseRatePerMinute * estimatedMinutes * costMultiplier;
  }

  async estimateLatency(spec: SandboxSpec): Promise<number> {
    // Daytona's ultra-fast 90ms startup
    let baseLatency = 90;
    
    // Custom workspace templates may take longer
    if (spec.dockerfile) {
      baseLatency += 1000; // 1s for custom setup
    }
    
    // Git clone operations add time
    const options = spec as any;
    if (options.gitRepo) {
      baseLatency += 2000; // 2s for git clone
    }
    
    // Package installation
    if (spec.requirements && spec.requirements.length > 0) {
      baseLatency += spec.requirements.length * 200; // 200ms per package
    }
    
    return baseLatency;
  }

  async run(spec: SandboxSpec): Promise<SandboxResult> {
    const startTime = Date.now();
    const sandboxId = uuidv4();
    let workspace: any = null;
    
    try {
      // Map language to workspace template
      const template = this.getWorkspaceTemplate(spec.language);
      
      // Create Daytona sandbox/workspace
      workspace = await this.client.create({
        language: this.mapLanguageToDaytona(spec.language),
        cpu: spec.cpu,
        memory: spec.memory,
        timeout: spec.timeout || this.config.defaultTimeout,
        template: template,
      });
      
      // Store workspace info
      const workspaceInfo: DaytonaWorkspace = {
        id: workspace.id || sandboxId,
        name: `sandbox-${sandboxId}`,
        status: 'ready',
        template: template,
        createdAt: new Date(),
        lastActivity: new Date(),
        resources: {
          cpu: spec.cpu || 1,
          memory: spec.memory || 512,
          disk: 10240, // 10GB default
        },
      };
      this.activeWorkspaces.set(sandboxId, workspaceInfo);
      
      // Initialize metrics
      const metrics: DaytonaWorkspaceMetrics = {
        cpu: 0,
        memory: 0,
        diskIO: { read: 0, write: 0 },
        network: { in: 0, out: 0 },
        processCount: 0,
      };
      this.workspaceMetrics.set(sandboxId, metrics);
      
      // Set environment variables
      if (spec.environment) {
        for (const [key, value] of Object.entries(spec.environment)) {
          await workspace.process.setEnv(key, value);
        }
      }
      
      // Upload files
      if (spec.files) {
        for (const [path, content] of Object.entries(spec.files)) {
          await workspace.filesystem.write(path, content);
        }
      }
      
      // Install requirements
      if (spec.requirements && spec.requirements.length > 0) {
        const installCmd = this.getInstallCommand(spec.language, spec.requirements);
        if (installCmd) {
          await workspace.process.execute(installCmd);
        }
      }
      
      // Execute the main code
      const result = await workspace.process.code_run(spec.code);
      
      // Update metrics
      const duration = Date.now() - startTime;
      metrics.cpu = Math.random() * 50 + 25; // Simulated CPU usage
      metrics.memory = spec.memory ? spec.memory * 0.7 : 358; // Simulated memory usage
      
      // Calculate cost
      const cost = this.calculateActualCost(duration, spec);
      
      // Clean up workspace if not persistent
      if (!spec.stateful) {
        await this.client.destroy(workspace.id);
        this.activeWorkspaces.delete(sandboxId);
      }
      
      return {
        id: sandboxId,
        provider: 'daytona',
        stdout: result.result || '',
        stderr: result.error || '',
        exitCode: result.error ? 1 : 0,
        duration,
        cost,
        logs: result.logs?.map((log: string) => ({
          timestamp: new Date().toISOString(),
          level: 'info' as const,
          message: log,
        })),
        metrics: {
          cpuUsage: metrics.cpu,
          memoryUsage: metrics.memory,
        },
      };
      
    } catch (error) {
      // Clean up on error
      if (workspace && workspace.id) {
        try {
          await this.client.destroy(workspace.id);
        } catch (cleanupError) {
          console.error('Failed to cleanup workspace:', cleanupError);
        }
        this.activeWorkspaces.delete(sandboxId);
      }
      
      throw this.wrapError(error);
    }
  }

  async snapshot(sandboxId: string): Promise<SandboxSnapshot> {
    const workspace = this.activeWorkspaces.get(sandboxId);
    if (!workspace) {
      throw new Error(`Workspace ${sandboxId} not found or already destroyed`);
    }
    
    const snapshotId = uuidv4();
    const timestamp = new Date().toISOString();
    
    // Daytona would implement workspace snapshots
    // This is a placeholder implementation
    return {
      id: snapshotId,
      sandboxId,
      provider: 'daytona',
      timestamp,
      filesystemHash: `daytona-snapshot-${snapshotId.substring(0, 8)}`,
      size: workspace.resources.disk * 0.3, // Estimate 30% disk usage
      metadata: {
        workspaceTemplate: workspace.template,
        metrics: this.workspaceMetrics.get(sandboxId),
      },
    };
  }

  async restore(snapshotId: string): Promise<string> {
    // Daytona snapshot restoration would be implemented here
    // This would create a new workspace from a snapshot
    const newWorkspaceId = uuidv4();
    
    // Placeholder implementation
    return newWorkspaceId;
  }

  async getQuota(): Promise<{ used: number; limit: number }> {
    // Daytona quota management
    // This would query the actual API for quota information
    return {
      used: 0,
      limit: 10000, // $10,000 placeholder limit
    };
  }

  // Daytona-specific methods
  async createWorkspace(options: {
    name: string;
    template: WorkspaceTemplate;
    persistent: boolean;
  }): Promise<string> {
    const workspace = await this.client.create({
      language: 'python', // Default
      template: options.template,
      persistent: options.persistent,
    });
    
    const workspaceId = workspace.id || uuidv4();
    const workspaceInfo: DaytonaWorkspace = {
      id: workspaceId,
      name: options.name,
      status: 'ready',
      template: options.template,
      createdAt: new Date(),
      lastActivity: new Date(),
      resources: {
        cpu: 2,
        memory: 2048,
        disk: 10240,
      },
    };
    
    this.activeWorkspaces.set(workspaceId, workspaceInfo);
    return workspaceId;
  }

  async runInWorkspace(workspaceId: string, spec: Omit<SandboxSpec, 'stateful'>): Promise<SandboxResult> {
    const workspace = this.activeWorkspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    
    // Update last activity
    workspace.lastActivity = new Date();
    
    // Run code in existing workspace
    return this.run({ ...spec, stateful: true });
  }

  async getWorkspaceMetrics(workspaceId: string): Promise<DaytonaWorkspaceMetrics> {
    const metrics = this.workspaceMetrics.get(workspaceId);
    if (!metrics) {
      throw new Error(`No metrics found for workspace ${workspaceId}`);
    }
    return metrics;
  }

  private getWorkspaceTemplate(language: Language): WorkspaceTemplate {
    const templateMap: Record<Language, WorkspaceTemplate> = {
      python: 'python',
      javascript: 'javascript',
      typescript: 'javascript',
      go: 'go',
      rust: 'rust',
      java: 'java',
      cpp: 'default',
      shell: 'default',
    };
    
    return templateMap[language] || 'default';
  }

  private mapLanguageToDaytona(language: Language): string {
    // Map to Daytona's expected language identifiers
    const languageMap: Record<Language, string> = {
      python: 'python',
      javascript: 'javascript',
      typescript: 'typescript',
      go: 'go',
      rust: 'rust',
      java: 'java',
      cpp: 'cpp',
      shell: 'bash',
    };
    
    return languageMap[language] || 'python';
  }

  private getInstallCommand(language: Language, requirements: string[]): string | null {
    switch (language) {
      case 'python':
        return `pip install ${requirements.join(' ')}`;
      case 'javascript':
      case 'typescript':
        return `npm install ${requirements.join(' ')}`;
      case 'go':
        return `go get ${requirements.join(' ')}`;
      case 'rust':
        return `cargo add ${requirements.join(' ')}`;
      case 'java':
        // Would need to modify pom.xml or build.gradle
        return null;
      default:
        return null;
    }
  }

  private calculateActualCost(duration: number, spec: SandboxSpec): number {
    const minutes = Math.ceil(duration / 60000);
    const baseRate = 0.01; // $0.01 per minute
    
    let cost = baseRate * minutes;
    
    // Additional costs for resources
    if (spec.cpu && spec.cpu > 2) {
      cost *= 1.5;
    }
    if (spec.memory && spec.memory > 2048) {
      cost *= 1.3;
    }
    if (spec.gpu) {
      cost *= 5;
    }
    
    return cost;
  }

  private wrapError(error: any): Error {
    if (error instanceof Error) {
      if (error.message.includes('rate limit')) {
        return new Error(`Daytona rate limit exceeded: ${error.message}`);
      }
      if (error.message.includes('quota')) {
        return new Error(`Daytona quota exceeded: ${error.message}`);
      }
      if (error.message.includes('timeout')) {
        return new Error(`Daytona execution timeout: ${error.message}`);
      }
      if (error.message.includes('not found')) {
        return new Error(`Daytona workspace not found: ${error.message}`);
      }
      return error;
    }
    return new Error(`Daytona error: ${String(error)}`);
  }

  async cleanup(): Promise<void> {
    // Destroy all non-persistent workspaces
    for (const [id, workspace] of this.activeWorkspaces) {
      try {
        await this.client.destroy(workspace.id);
      } catch (error) {
        console.error(`Failed to destroy workspace ${id}:`, error);
      }
    }
    this.activeWorkspaces.clear();
    this.workspaceMetrics.clear();
  }
}