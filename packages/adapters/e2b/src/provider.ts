/**
 * @license MIT
 * @copyright 2025 Sandstorm Contributors
 * @module @sandstorm/adapters-e2b
 */

import { Sandbox } from '@e2b/code-interpreter';
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
  E2BConfig, 
  E2BLanguageMap, 
  E2BStreamHandlers,
  E2BExecutionOptions,
  E2BSandboxMetrics,
} from './types';

export class E2BProvider implements ISandboxProvider {
  readonly name: SandboxProvider = 'e2b';
  private config: E2BConfig;
  private activeSandboxes: Map<string, Sandbox>;
  private sandboxMetrics: Map<string, E2BSandboxMetrics>;

  constructor(config: E2BConfig) {
    this.config = E2BConfig.parse(config);
    this.activeSandboxes = new Map();
    this.sandboxMetrics = new Map();
    
    // Set E2B API key
    if (this.config.apiKey) {
      process.env.E2B_API_KEY = this.config.apiKey;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Try to create a minimal sandbox to check availability
      const testSandbox = await Sandbox.create({ 
        timeoutMs: 5000,
      });
      await testSandbox.close();
      return true;
    } catch (error) {
      console.error('E2B availability check failed:', error);
      return false;
    }
  }

  async estimateCost(spec: SandboxSpec): Promise<number> {
    // E2B pricing is per second of runtime
    // Base rate: $0.00014 per second (~$0.50 per hour)
    const baseRatePerSecond = 0.00014;
    const estimatedDurationSeconds = (spec.timeout || this.config.defaultTimeout) / 1000;
    
    let costMultiplier = 1;
    
    // GPU instances cost more
    if (spec.gpu) {
      costMultiplier = 10; // GPU instances are ~10x more expensive
    }
    
    // High memory instances cost more
    if (spec.memory && spec.memory > 4096) {
      costMultiplier *= 1.5;
    }
    
    // Persistent sessions cost more
    if (spec.stateful) {
      costMultiplier *= 1.2;
    }
    
    return baseRatePerSecond * estimatedDurationSeconds * costMultiplier;
  }

  async estimateLatency(spec: SandboxSpec): Promise<number> {
    // E2B has very fast startup times
    let baseLatency = 150; // 150ms base startup time
    
    // Add time for package installation if needed
    if (spec.requirements && spec.requirements.length > 0) {
      baseLatency += spec.requirements.length * 500; // ~500ms per package
    }
    
    // Custom templates may take longer
    if (spec.stateful) {
      baseLatency += 100;
    }
    
    return baseLatency;
  }

  async run(spec: SandboxSpec): Promise<SandboxResult> {
    const startTime = Date.now();
    const sandboxId = uuidv4();
    let sandbox: Sandbox | null = null;
    
    try {
      // Map language to E2B supported format
      const e2bLanguage = this.mapLanguage(spec.language);
      
      // Create sandbox with configuration
      sandbox = await Sandbox.create({
        timeoutMs: spec.timeout || this.config.defaultTimeout,
        // Add custom template support if needed
      });
      
      // Store active sandbox
      this.activeSandboxes.set(sandboxId, sandbox);
      
      // Initialize metrics
      const metrics: E2BSandboxMetrics = {
        executionTime: 0,
        cpuTime: 0,
        memoryPeak: 0,
        networkIn: 0,
        networkOut: 0,
        filesCreated: 0,
        packagesInstalled: [],
      };
      this.sandboxMetrics.set(sandboxId, metrics);
      
      // Set environment variables if provided
      if (spec.environment) {
        for (const [key, value] of Object.entries(spec.environment)) {
          await sandbox.runCode(`import os; os.environ['${key}'] = '${value}'`);
        }
      }
      
      // Upload files if provided
      if (spec.files) {
        for (const [path, content] of Object.entries(spec.files)) {
          await sandbox.filesystem.write(path, content);
          metrics.filesCreated++;
        }
      }
      
      // Install requirements if specified
      if (spec.requirements && spec.requirements.length > 0) {
        for (const requirement of spec.requirements) {
          if (e2bLanguage === 'python') {
            await sandbox.runCode(`!pip install ${requirement}`);
            metrics.packagesInstalled.push(requirement);
          } else if (e2bLanguage === 'js') {
            await sandbox.runCode(`!npm install ${requirement}`);
            metrics.packagesInstalled.push(requirement);
          }
        }
      }
      
      // Execute the main code
      const execution = await sandbox.runCode(spec.code);
      
      // Collect output files
      const outputFiles: Record<string, string> = {};
      if (execution.results && execution.results.length > 0) {
        // E2B returns file artifacts in results
        for (const result of execution.results) {
          if (result.type === 'file' && result.path) {
            const content = await sandbox.filesystem.read(result.path);
            outputFiles[result.path] = content;
          }
        }
      }
      
      // Calculate execution time
      const duration = Date.now() - startTime;
      metrics.executionTime = duration;
      
      // Calculate cost based on actual runtime
      const cost = (duration / 1000) * 0.00014 * (spec.gpu ? 10 : 1);
      
      // Clean up sandbox
      await sandbox.close();
      this.activeSandboxes.delete(sandboxId);
      
      return {
        id: sandboxId,
        provider: 'e2b',
        stdout: execution.text || '',
        stderr: execution.error || '',
        exitCode: execution.error ? 1 : 0,
        duration,
        cost,
        files: outputFiles,
        logs: execution.logs?.map(log => ({
          timestamp: new Date().toISOString(),
          level: 'info' as const,
          message: log,
        })),
        metrics: {
          cpuUsage: metrics.cpuTime,
          memoryUsage: metrics.memoryPeak,
        },
      };
      
    } catch (error) {
      // Clean up on error
      if (sandbox) {
        try {
          await sandbox.close();
        } catch (cleanupError) {
          console.error('Failed to cleanup sandbox:', cleanupError);
        }
        this.activeSandboxes.delete(sandboxId);
      }
      
      throw this.wrapError(error);
    }
  }

  async snapshot(sandboxId: string): Promise<SandboxSnapshot> {
    const sandbox = this.activeSandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox ${sandboxId} not found or already closed`);
    }
    
    // E2B doesn't have built-in snapshot functionality
    // We'll simulate it by saving the current state
    const snapshotId = uuidv4();
    const timestamp = new Date().toISOString();
    
    // Get current files
    const files = await sandbox.filesystem.list('/');
    const filesystemHash = this.hashFiles(files);
    
    return {
      id: snapshotId,
      sandboxId,
      provider: 'e2b',
      timestamp,
      filesystemHash,
      size: files.length * 1024, // Rough estimate
      metadata: {
        fileCount: files.length,
        metrics: this.sandboxMetrics.get(sandboxId),
      },
    };
  }

  async restore(snapshotId: string): Promise<string> {
    // E2B doesn't support direct snapshot restoration
    // This would need to be implemented by recreating the sandbox
    // and restoring files from external storage
    throw new Error('Snapshot restoration not yet implemented for E2B provider');
  }

  async getQuota(): Promise<{ used: number; limit: number }> {
    // E2B doesn't expose quota information via SDK
    // Return placeholder values
    return {
      used: 0,
      limit: 1000000, // $1000 default limit
    };
  }

  private mapLanguage(language: Language): string {
    const languageMap: Record<Language, string> = {
      python: 'python',
      javascript: 'js',
      typescript: 'js',
      ruby: 'ruby',
      cpp: 'cpp',
      shell: 'bash',
      go: 'python', // E2B doesn't support Go directly, fallback to Python
      rust: 'python', // E2B doesn't support Rust directly, fallback to Python
      java: 'python', // E2B doesn't support Java directly, fallback to Python
    };
    
    return languageMap[language] || 'python';
  }

  private hashFiles(files: string[]): string {
    // Simple hash function for file list
    return Buffer.from(files.sort().join(',')).toString('base64').substring(0, 16);
  }

  private wrapError(error: any): Error {
    if (error instanceof Error) {
      // Check for specific E2B error types
      if (error.message.includes('rate limit')) {
        return new Error(`E2B rate limit exceeded: ${error.message}`);
      }
      if (error.message.includes('quota')) {
        return new Error(`E2B quota exceeded: ${error.message}`);
      }
      if (error.message.includes('timeout')) {
        return new Error(`E2B execution timeout: ${error.message}`);
      }
      return error;
    }
    return new Error(`E2B error: ${String(error)}`);
  }

  async cleanup(): Promise<void> {
    // Close all active sandboxes
    for (const [id, sandbox] of this.activeSandboxes) {
      try {
        await sandbox.close();
      } catch (error) {
        console.error(`Failed to close sandbox ${id}:`, error);
      }
    }
    this.activeSandboxes.clear();
    this.sandboxMetrics.clear();
  }
}