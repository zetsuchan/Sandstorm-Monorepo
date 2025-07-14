import {
  ISandboxProvider,
  SandboxProvider,
  SandboxSpec,
  SandboxResult,
  SandboxSnapshot,
  StreamHandlers,
  SandboxLanguage,
} from '@sandstorm/core';
import { execa, ExecaChildProcess } from 'execa';
import { randomUUID } from 'crypto';
import { writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AppleContainersConfig, AppleContainersConfigSchema } from './config';

// Internal types for tracking sandbox state
interface SandboxInstance {
  id: string;
  provider: SandboxProvider;
  containerId: string;
  startTime: number;
}

interface ProviderMetrics {
  cpuUsage: number;
  memoryUsage: number;
  networkIO: { sent: number; received: number };
}

export class AppleContainersProvider implements ISandboxProvider {
  name = 'apple-containers' as const;
  private config: AppleContainersConfig;
  private activeSandboxes = new Map<string, SandboxInstance>();
  private sandboxMetrics = new Map<string, ProviderMetrics>();

  constructor(config: AppleContainersConfig) {
    this.config = AppleContainersConfigSchema.parse(config);
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if we're on macOS
      if (process.platform !== 'darwin') {
        return false;
      }

      // Check if we're on Apple Silicon
      const { stdout: arch } = await execa('uname', ['-m']);
      if (!arch.includes('arm64')) {
        console.warn('Apple Containers works best on Apple Silicon. Intel support is limited.');
      }

      // Check macOS version (15.0+ required)
      const { stdout: version } = await execa('sw_vers', ['-productVersion']);
      const [major] = version.split('.').map(Number);
      if (major < 15) {
        return false;
      }

      // Check if container CLI is available
      await execa(this.config.containerPath, ['--version']);

      // Check if container system is running
      const { exitCode } = await execa(this.config.containerPath, ['system', 'status'], {
        reject: false,
      });

      return exitCode === 0;
    } catch {
      return false;
    }
  }

  async estimateCost(spec: SandboxSpec): Promise<number> {
    // Base rate per minute for VM (higher than shared kernel containers)
    let rate = 0.005;

    // CPU multiplier
    const cpuCores = spec.cpu || 1;
    rate *= cpuCores;

    // Memory multiplier (per GB)
    const memoryGB = (spec.memory || 512) / 1024;
    rate *= (1 + memoryGB * 0.2);

    // GPU not supported on macOS containers yet
    if (spec.gpu) {
      throw new Error('GPU acceleration is not supported in Apple Containers');
    }

    // Calculate total cost based on timeout
    const minutes = (spec.timeout || this.config.defaultTimeout) / 60000;
    return rate * minutes;
  }

  async estimateLatency(spec: SandboxSpec): Promise<number> {
    // Apple claims sub-second startup for lightweight VMs
    let baseLatency = 800; // 800ms base

    // Add time for image pull if not cached
    if (spec.containerImage) {
      baseLatency += 2000; // Assume 2s for custom image
    }

    // Add time for larger resource allocations
    const memoryGB = (spec.memory || 512) / 1024;
    baseLatency += memoryGB * 100;

    return baseLatency;
  }

  async run(
    spec: SandboxSpec,
    streamHandlers?: StreamHandlers
  ): Promise<SandboxResult> {
    const sandboxId = randomUUID();
    const startTime = Date.now();

    try {
      // Get container image
      const image = this.getImageForLanguage(spec.language, spec.containerImage);

      // Pull image if needed
      streamHandlers?.onStdout?.(`Pulling image ${image}...\\n`);
      await this.pullImage(image);

      // Create container with resource limits
      const containerId = await this.createContainer(sandboxId, spec, image);

      // Track active sandbox
      this.activeSandboxes.set(sandboxId, {
        id: sandboxId,
        provider: this.name,
        containerId,
        startTime,
      });

      // Prepare and upload code
      const codeFile = await this.prepareCode(spec);

      // Execute code
      const result = await this.executeCode(
        containerId,
        spec,
        codeFile,
        streamHandlers
      );

      // Calculate metrics
      const duration = Date.now() - startTime;
      const cost = await this.estimateCost({
        ...spec,
        timeout: duration,
      });

      // Cleanup
      await this.cleanupSandbox(sandboxId, containerId, codeFile);

      return {
        id: sandboxId,
        provider: this.name,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration,
        cost,
        metrics: {
          cpuUsage: 0, // TODO: Implement metrics collection
          memoryUsage: 0,
        },
      };
    } catch (error) {
      // Cleanup on error
      const instance = this.activeSandboxes.get(sandboxId);
      if (instance?.containerId) {
        await this.cleanupSandbox(sandboxId, instance.containerId);
      }

      throw new Error(
        `Apple Containers execution failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  async snapshot(sandboxId: string): Promise<SandboxSnapshot> {
    // Apple Containers doesn't support snapshots in v0.1.0
    throw new Error('Snapshots are not yet supported in Apple Containers');
  }

  async restore(snapshotId: string): Promise<string> {
    throw new Error('Snapshot restore is not yet supported in Apple Containers');
  }

  async getQuota(): Promise<{ used: number; limit: number }> {
    // Local provider - no real quotas
    return {
      used: this.activeSandboxes.size,
      limit: 100,
    };
  }

  async cleanup(): Promise<void> {
    // Clean up all active sandboxes
    for (const [id, instance] of this.activeSandboxes.entries()) {
      if (instance.containerId) {
        try {
          await execa(this.config.containerPath, ['rm', '-f', instance.containerId]);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
    this.activeSandboxes.clear();
    this.sandboxMetrics.clear();
  }

  private getImageForLanguage(
    language: SandboxLanguage,
    customImage?: string
  ): string {
    if (customImage) {
      return customImage;
    }

    const imageMap: Record<SandboxLanguage, string> = {
      python: 'docker.io/python:3.11-slim',
      javascript: 'docker.io/node:20-slim',
      typescript: 'docker.io/node:20-slim',
      go: 'docker.io/golang:1.21-alpine',
      rust: 'docker.io/rust:1.75-slim',
      java: 'docker.io/eclipse-temurin:21-jre',
      cpp: 'docker.io/gcc:13',
      csharp: 'docker.io/mcr.microsoft.com/dotnet/sdk:8.0',
      php: 'docker.io/php:8.3-cli',
      ruby: 'docker.io/ruby:3.3-slim',
      shell: 'docker.io/alpine:latest',
    };

    return imageMap[language] || 'docker.io/alpine:latest';
  }

  private async pullImage(image: string): Promise<void> {
    try {
      await execa(this.config.containerPath, ['image', 'pull', image]);
    } catch (error) {
      throw new Error(`Failed to pull image ${image}: ${error}`);
    }
  }

  private async createContainer(
    sandboxId: string,
    spec: SandboxSpec,
    image: string
  ): Promise<string> {
    const args = ['create'];

    // Set resource limits
    args.push('--memory', `${spec.memory || 512}M`);
    args.push('--cpus', String(spec.cpu || 1));

    // Set name
    args.push('--name', `sandstorm-${sandboxId}`);

    // Enable Rosetta if requested for x86_64 images
    if (this.config.enableRosetta && spec.architecture === 'amd64') {
      args.push('--rosetta');
    }

    // Set environment variables
    if (spec.environment) {
      for (const [key, value] of Object.entries(spec.environment)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    // Add image
    args.push(image);

    // Default command (sleep to keep container running)
    args.push('sleep', 'infinity');

    const { stdout } = await execa(this.config.containerPath, args);
    const containerId = stdout.trim();

    // Start the container
    await execa(this.config.containerPath, ['start', containerId]);

    return containerId;
  }

  private async prepareCode(spec: SandboxSpec): Promise<string> {
    const extension = this.getFileExtension(spec.language);
    const fileName = `main${extension}`;
    const tempDir = join(tmpdir(), `sandstorm-${randomUUID()}`);
    const tempFile = join(tempDir, fileName);

    // Create temporary directory
    const { mkdir } = await import('fs/promises');
    await mkdir(tempDir, { recursive: true });

    // Write code to temporary file
    await writeFile(tempFile, spec.code, 'utf-8');

    return tempFile;
  }

  private getFileExtension(language: SandboxLanguage): string {
    const extensions: Record<SandboxLanguage, string> = {
      python: '.py',
      javascript: '.js',
      typescript: '.ts',
      go: '.go',
      rust: '.rs',
      java: '.java',
      cpp: '.cpp',
      csharp: '.cs',
      php: '.php',
      ruby: '.rb',
      shell: '.sh',
    };

    return extensions[language] || '.txt';
  }

  private async executeCode(
    containerId: string,
    spec: SandboxSpec,
    codeFile: string,
    streamHandlers?: StreamHandlers
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // Copy code file to container
    const containerPath = '/tmp/code' + this.getFileExtension(spec.language);
    await execa(this.config.containerPath, ['cp', codeFile, `${containerId}:${containerPath}`]);

    // Install dependencies if needed
    if (spec.requirements?.length) {
      await this.installDependencies(containerId, spec);
    }

    // Prepare execution command
    const command = this.getExecutionCommand(spec.language, containerPath);

    // Execute with timeout
    const timeout = spec.timeout || this.config.defaultTimeout;
    let stdout = '';
    let stderr = '';

    try {
      const proc = execa(
        this.config.containerPath,
        ['exec', containerId, ...command],
        {
          timeout,
          buffer: false,
        }
      );

      // Stream output if handlers provided
      if (streamHandlers) {
        proc.stdout?.on('data', (data) => {
          const text = data.toString();
          stdout += text;
          streamHandlers.onStdout?.(text);
        });

        proc.stderr?.on('data', (data) => {
          const text = data.toString();
          stderr += text;
          streamHandlers.onStderr?.(text);
        });
      } else {
        const result = await proc;
        stdout = result.stdout;
        stderr = result.stderr;
      }

      await proc;
      return { stdout, stderr, exitCode: 0 };
    } catch (error: any) {
      if (error.timedOut) {
        throw new Error(`Execution timed out after ${timeout}ms`);
      }

      return {
        stdout: error.stdout || stdout,
        stderr: error.stderr || stderr,
        exitCode: error.exitCode || 1,
      };
    }
  }

  private async installDependencies(
    containerId: string,
    spec: SandboxSpec
  ): Promise<void> {
    const commands = this.getInstallCommands(spec.language, spec.requirements || []);

    for (const command of commands) {
      await execa(this.config.containerPath, ['exec', containerId, ...command]);
    }
  }

  private getInstallCommands(
    language: SandboxLanguage,
    requirements: string[]
  ): string[][] {
    if (requirements.length === 0) {
      return [];
    }

    switch (language) {
      case 'python':
        return [['pip', 'install', ...requirements]];
      case 'javascript':
      case 'typescript':
        return [['npm', 'install', ...requirements]];
      case 'go':
        return requirements.map(req => ['go', 'get', req]);
      case 'rust':
        // Rust dependencies would need Cargo.toml
        return [];
      case 'java':
        // Java dependencies would need build tool
        return [];
      case 'ruby':
        return [['gem', 'install', ...requirements]];
      case 'php':
        return [['composer', 'require', ...requirements]];
      default:
        return [];
    }
  }

  private getExecutionCommand(
    language: SandboxLanguage,
    codePath: string
  ): string[] {
    switch (language) {
      case 'python':
        return ['python', codePath];
      case 'javascript':
        return ['node', codePath];
      case 'typescript':
        return ['ts-node', codePath];
      case 'go':
        return ['go', 'run', codePath];
      case 'rust':
        return ['rustc', codePath, '-o', '/tmp/program', '&&', '/tmp/program'];
      case 'java':
        return ['java', codePath];
      case 'cpp':
        return ['g++', codePath, '-o', '/tmp/program', '&&', '/tmp/program'];
      case 'csharp':
        return ['dotnet', 'run', codePath];
      case 'php':
        return ['php', codePath];
      case 'ruby':
        return ['ruby', codePath];
      case 'shell':
        return ['sh', codePath];
      default:
        return ['sh', codePath];
    }
  }

  private async cleanupSandbox(
    sandboxId: string,
    containerId?: string,
    codeFile?: string
  ): Promise<void> {
    // Remove from active sandboxes
    this.activeSandboxes.delete(sandboxId);

    // Remove container
    if (containerId) {
      try {
        await execa(this.config.containerPath, ['rm', '-f', containerId]);
      } catch {
        // Ignore errors
      }
    }

    // Remove temporary code file and directory
    if (codeFile) {
      try {
        // Remove the parent directory of the code file
        const { dirname } = await import('path');
        const tempDir = dirname(codeFile);
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore errors
      }
    }
  }
}