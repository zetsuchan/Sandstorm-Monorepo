/**
 * @license MIT
 * @copyright 2025 Sandstorm Contributors
 * @module @sandstorm/adapters-modal
 */

import { App, Function_ } from 'modal';
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
  ModalConfig,
  ModalGPUType,
  ModalStreamHandlers,
  ModalExecutionOptions,
  ModalResourceMetrics,
} from './types';

export class ModalProvider implements ISandboxProvider {
  readonly name: SandboxProvider = 'modal';
  private config: ModalConfig;
  private app: App | null = null;
  private activeSandboxes: Map<string, any>;
  private sandboxMetrics: Map<string, ModalResourceMetrics>;

  constructor(config: ModalConfig) {
    this.config = ModalConfig.parse(config);
    this.activeSandboxes = new Map();
    this.sandboxMetrics = new Map();
    
    // Set Modal API key
    if (this.config.apiKey) {
      process.env.MODAL_TOKEN_ID = this.config.apiKey.split(':')[0];
      process.env.MODAL_TOKEN_SECRET = this.config.apiKey.split(':')[1];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Initialize Modal app
      this.app = await App.lookup(this.config.workspace, { createIfMissing: true });
      return true;
    } catch (error) {
      console.error('Modal availability check failed:', error);
      return false;
    }
  }

  async estimateCost(spec: SandboxSpec): Promise<number> {
    // Modal pricing is per CPU cycle
    // Base rate: ~$0.000001 per CPU-second
    const cpuRatePerSecond = 0.000001;
    const estimatedDurationSeconds = (spec.timeout || this.config.defaultTimeout) / 1000;
    const cpuCount = spec.cpu || 1;
    
    let baseCost = cpuRatePerSecond * estimatedDurationSeconds * cpuCount;
    
    // GPU pricing varies by type
    if (spec.gpu && spec.gpuType) {
      const gpuRates: Record<string, number> = {
        'T4': 0.000076, // per second
        'A10G': 0.000278,
        'A100': 0.001111,
        'H100': 0.002778,
        'L4': 0.000194,
      };
      const gpuRate = gpuRates[spec.gpuType] || gpuRates['T4'];
      baseCost += gpuRate * estimatedDurationSeconds;
    }
    
    // Memory is included in CPU pricing
    // Network egress might add costs for large data transfers
    
    return baseCost;
  }

  async estimateLatency(spec: SandboxSpec): Promise<number> {
    // Modal container startup times
    let baseLatency = 500; // 500ms base container startup
    
    // Cold start penalty if using custom image
    if (spec.dockerfile) {
      baseLatency += 2000; // Additional 2s for custom image pull
    }
    
    // GPU allocation takes longer
    if (spec.gpu) {
      baseLatency += 1000;
    }
    
    // Package installation time
    if (spec.requirements && spec.requirements.length > 0) {
      baseLatency += spec.requirements.length * 300;
    }
    
    return baseLatency;
  }

  async run(spec: SandboxSpec): Promise<SandboxResult> {
    const startTime = Date.now();
    const sandboxId = uuidv4();
    let sandbox: any = null;
    
    try {
      if (!this.app) {
        await this.isAvailable();
        if (!this.app) {
          throw new Error('Modal app not initialized');
        }
      }

      // Select appropriate image based on language
      const image = await this.getImageForLanguage(spec.language);
      
      // Create sandbox with Modal
      sandbox = await this.app.createSandbox(image, {
        cpu: spec.cpu || 1,
        memory: spec.memory || 512,
        gpu: spec.gpu ? this.mapGPUType(spec.gpuType) : undefined,
        timeout: (spec.timeout || this.config.defaultTimeout) / 1000, // Convert to seconds
      });
      
      // Store active sandbox
      this.activeSandboxes.set(sandboxId, sandbox);
      
      // Initialize metrics
      const metrics: ModalResourceMetrics = {
        cpuCycles: 0,
        memoryPeak: 0,
        networkIn: 0,
        networkOut: 0,
        executionTime: 0,
        queueTime: 0,
      };
      this.sandboxMetrics.set(sandboxId, metrics);
      
      // Set environment variables
      if (spec.environment) {
        for (const [key, value] of Object.entries(spec.environment)) {
          await sandbox.exec(['sh', '-c', `export ${key}="${value}"`]);
        }
      }
      
      // Write input files
      if (spec.files) {
        for (const [path, content] of Object.entries(spec.files)) {
          // Modal doesn't have direct file write, use echo
          await sandbox.exec(['sh', '-c', `echo '${content}' > ${path}`]);
        }
      }
      
      // Install requirements
      if (spec.requirements && spec.requirements.length > 0) {
        const installCmd = this.getInstallCommand(spec.language, spec.requirements);
        if (installCmd) {
          const installProc = sandbox.exec(installCmd);
          await installProc.wait();
        }
      }
      
      // Prepare code execution command
      const execCommand = this.getExecCommand(spec.language, spec.code);
      
      // Execute the code
      const process = sandbox.exec(execCommand);
      
      // Collect output
      let stdout = '';
      let stderr = '';
      
      // Read stdout
      if (process.stdout) {
        stdout = await process.stdout.readText();
      }
      
      // Read stderr
      if (process.stderr) {
        stderr = await process.stderr.readText();
      }
      
      // Wait for completion
      const exitCode = await process.wait();
      
      // Calculate metrics
      const duration = Date.now() - startTime;
      metrics.executionTime = duration;
      
      // Estimate CPU cycles (rough approximation)
      metrics.cpuCycles = (duration / 1000) * (spec.cpu || 1) * 2.4e9; // Assume 2.4GHz CPU
      
      // Calculate cost based on actual usage
      const cost = this.calculateActualCost(metrics, spec);
      
      // Terminate sandbox
      await sandbox.terminate();
      this.activeSandboxes.delete(sandboxId);
      
      return {
        id: sandboxId,
        provider: 'modal',
        stdout,
        stderr,
        exitCode,
        duration,
        cost,
        logs: [],
        metrics: {
          cpuUsage: metrics.cpuCycles / 1e9, // Convert to GHz-seconds
          memoryUsage: metrics.memoryPeak,
        },
      };
      
    } catch (error) {
      // Clean up on error
      if (sandbox) {
        try {
          await sandbox.terminate();
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
      throw new Error(`Sandbox ${sandboxId} not found or already terminated`);
    }
    
    // Modal doesn't have built-in snapshot functionality
    // Would need to implement using volumes or external storage
    const snapshotId = uuidv4();
    const timestamp = new Date().toISOString();
    
    return {
      id: snapshotId,
      sandboxId,
      provider: 'modal',
      timestamp,
      filesystemHash: 'modal-snapshot-' + snapshotId.substring(0, 8),
      size: 0, // Would need to calculate actual size
      metadata: {
        metrics: this.sandboxMetrics.get(sandboxId),
      },
    };
  }

  async restore(snapshotId: string): Promise<string> {
    // Modal doesn't support direct snapshot restoration
    // Would need custom implementation
    throw new Error('Snapshot restoration not yet implemented for Modal provider');
  }

  async getQuota(): Promise<{ used: number; limit: number }> {
    // Modal doesn't expose quota via SDK
    // Return placeholder values
    return {
      used: 0,
      limit: 30, // $30/month free tier
    };
  }

  private async getImageForLanguage(language: Language): Promise<any> {
    if (!this.app) {
      throw new Error('Modal app not initialized');
    }

    const imageMap: Record<Language, string> = {
      python: 'python:3.11-slim',
      javascript: 'node:20-slim',
      typescript: 'node:20-slim',
      go: 'golang:1.21-alpine',
      rust: 'rust:1.75-slim',
      java: 'openjdk:21-slim',
      cpp: 'gcc:13',
      shell: 'ubuntu:22.04',
    };
    
    const imageName = imageMap[language] || this.config.defaultImage;
    return await this.app.imageFromRegistry(imageName);
  }

  private getInstallCommand(language: Language, requirements: string[]): string[] | null {
    switch (language) {
      case 'python':
        return ['pip', 'install', ...requirements];
      case 'javascript':
      case 'typescript':
        return ['npm', 'install', ...requirements];
      case 'go':
        return ['go', 'get', ...requirements];
      case 'rust':
        // Rust dependencies would be in Cargo.toml
        return null;
      case 'java':
        // Java dependencies would be in pom.xml or build.gradle
        return null;
      default:
        return null;
    }
  }

  private getExecCommand(language: Language, code: string): string[] {
    // Write code to temporary file and execute
    const tempFile = `/tmp/code_${uuidv4().substring(0, 8)}`;
    
    switch (language) {
      case 'python':
        return ['sh', '-c', `echo '${code.replace(/'/g, "'\\''")}' > ${tempFile}.py && python ${tempFile}.py`];
      case 'javascript':
        return ['sh', '-c', `echo '${code.replace(/'/g, "'\\''")}' > ${tempFile}.js && node ${tempFile}.js`];
      case 'typescript':
        return ['sh', '-c', `echo '${code.replace(/'/g, "'\\''")}' > ${tempFile}.ts && npx ts-node ${tempFile}.ts`];
      case 'go':
        return ['sh', '-c', `echo '${code.replace(/'/g, "'\\''")}' > ${tempFile}.go && go run ${tempFile}.go`];
      case 'rust':
        return ['sh', '-c', `echo '${code.replace(/'/g, "'\\''")}' > ${tempFile}.rs && rustc ${tempFile}.rs -o ${tempFile} && ${tempFile}`];
      case 'java':
        return ['sh', '-c', `echo '${code.replace(/'/g, "'\\''")}' > Main.java && javac Main.java && java Main`];
      case 'cpp':
        return ['sh', '-c', `echo '${code.replace(/'/g, "'\\''")}' > ${tempFile}.cpp && g++ ${tempFile}.cpp -o ${tempFile} && ${tempFile}`];
      case 'shell':
        return ['sh', '-c', code];
      default:
        return ['sh', '-c', code];
    }
  }

  private mapGPUType(gpuType?: string): string {
    if (!gpuType) return 'any';
    
    // Modal GPU type mapping
    const gpuMap: Record<string, string> = {
      'T4': 'nvidia-tesla-t4',
      'A10G': 'nvidia-a10g',
      'A100': 'nvidia-a100',
      'H100': 'nvidia-h100',
      'L4': 'nvidia-l4',
    };
    
    return gpuMap[gpuType] || 'any';
  }

  private calculateActualCost(metrics: ModalResourceMetrics, spec: SandboxSpec): number {
    const cpuRatePerCycle = 0.000001 / 2.4e9; // Convert to per-cycle rate
    let cost = metrics.cpuCycles * cpuRatePerCycle;
    
    if (spec.gpu && spec.gpuType) {
      const gpuRates: Record<string, number> = {
        'T4': 0.000076,
        'A10G': 0.000278,
        'A100': 0.001111,
        'H100': 0.002778,
        'L4': 0.000194,
      };
      const gpuRate = gpuRates[spec.gpuType] || gpuRates['T4'];
      cost += gpuRate * (metrics.executionTime / 1000);
    }
    
    return cost;
  }

  private wrapError(error: any): Error {
    if (error instanceof Error) {
      if (error.message.includes('rate limit')) {
        return new Error(`Modal rate limit exceeded: ${error.message}`);
      }
      if (error.message.includes('quota')) {
        return new Error(`Modal quota exceeded: ${error.message}`);
      }
      if (error.message.includes('timeout')) {
        return new Error(`Modal execution timeout: ${error.message}`);
      }
      return error;
    }
    return new Error(`Modal error: ${String(error)}`);
  }

  async cleanup(): Promise<void> {
    // Terminate all active sandboxes
    for (const [id, sandbox] of this.activeSandboxes) {
      try {
        await sandbox.terminate();
      } catch (error) {
        console.error(`Failed to terminate sandbox ${id}:`, error);
      }
    }
    this.activeSandboxes.clear();
    this.sandboxMetrics.clear();
  }
}