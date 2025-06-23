import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SandboxSpec, SandboxResult } from '@sandstorm/core';
import { ContainerRuntime, EdgeAgentConfig } from '../types';
import { v4 as uuid } from 'uuid';

const execAsync = promisify(exec);

export class PodmanAdapter implements ContainerRuntime {
  name = 'podman';
  private socketPath?: string;
  
  constructor(private config?: { socketPath?: string; rootless?: boolean }) {
    if (config?.socketPath) {
      this.socketPath = config.socketPath;
    } else if (config?.rootless !== false) {
      // Default to rootless socket
      const uid = process.getuid?.() || 1000;
      this.socketPath = `/run/user/${uid}/podman/podman.sock`;
    } else {
      // System socket
      this.socketPath = '/run/podman/podman.sock';
    }
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('podman --version');
      return stdout.includes('podman version');
    } catch {
      return false;
    }
  }
  
  async runSandbox(spec: SandboxSpec, config: EdgeAgentConfig): Promise<SandboxResult> {
    const startTime = Date.now();
    const containerId = `sandstorm-${uuid()}`;
    const workDir = path.join(config.tempDir, containerId);
    
    try {
      // Create working directory
      await fs.mkdir(workDir, { recursive: true });
      
      // Write code to file
      const codeFile = path.join(workDir, this.getFileName(spec.language));
      await fs.writeFile(codeFile, spec.code);
      
      // Write additional files if provided
      if (spec.files) {
        for (const [filename, content] of Object.entries(spec.files)) {
          const filePath = path.join(workDir, filename);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, content);
        }
      }
      
      // Prepare container image
      const image = this.getImage(spec.language);
      
      // Build podman run command
      const args = [
        'run',
        '--rm',
        '--name', containerId,
        '--workdir', '/workspace',
        '-v', `${workDir}:/workspace:Z`,
        '--memory', `${spec.memory || 512}m`,
        '--cpus', `${spec.cpu || 1}`,
      ];
      
      // Add security options for rootless mode
      if (config.rootless) {
        args.push('--userns=keep-id');
        args.push('--security-opt', 'label=disable');
      }
      
      // Network isolation
      if (config.enableNetworkIsolation) {
        args.push('--network', 'none');
      }
      
      // Environment variables
      if (spec.environment) {
        for (const [key, value] of Object.entries(spec.environment)) {
          args.push('-e', `${key}=${value}`);
        }
      }
      
      // Add timeout
      const timeout = spec.timeout || 60000;
      args.push('--timeout', Math.ceil(timeout / 1000).toString());
      
      // Add image and command
      args.push(image);
      args.push(...this.getCommand(spec.language, codeFile));
      
      // Execute container
      const result = await this.executeContainer('podman', args, timeout);
      
      // Read output files if any were created
      const outputFiles: Record<string, string> = {};
      try {
        const files = await fs.readdir(workDir);
        for (const file of files) {
          if (file !== path.basename(codeFile)) {
            const content = await fs.readFile(path.join(workDir, file), 'utf-8');
            outputFiles[file] = content;
          }
        }
      } catch {
        // Ignore errors reading output files
      }
      
      return {
        id: containerId,
        provider: 'edge' as any,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration: Date.now() - startTime,
        cost: 0, // Edge agent doesn't have direct costs
        files: Object.keys(outputFiles).length > 0 ? outputFiles : undefined,
        metrics: {
          cpuUsage: spec.cpu || 1,
          memoryUsage: spec.memory || 512,
        },
      };
    } finally {
      // Cleanup
      try {
        await fs.rm(workDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
  
  async cleanup(containerId: string): Promise<void> {
    try {
      await execAsync(`podman stop ${containerId} || true`);
      await execAsync(`podman rm ${containerId} || true`);
    } catch {
      // Ignore cleanup errors
    }
  }
  
  async getContainerStats(containerId: string): Promise<{
    cpuPercent: number;
    memoryMB: number;
    networkRxBytes: number;
    networkTxBytes: number;
  }> {
    try {
      const { stdout } = await execAsync(`podman stats --no-stream --format json ${containerId}`);
      const stats = JSON.parse(stdout);
      
      if (Array.isArray(stats) && stats.length > 0) {
        const stat = stats[0];
        return {
          cpuPercent: parseFloat(stat.CPU?.replace('%', '') || '0'),
          memoryMB: this.parseMemory(stat.MemUsage || '0'),
          networkRxBytes: parseInt(stat.NetIO?.split('/')[0] || '0'),
          networkTxBytes: parseInt(stat.NetIO?.split('/')[1] || '0'),
        };
      }
    } catch {
      // Return zeros on error
    }
    
    return {
      cpuPercent: 0,
      memoryMB: 0,
      networkRxBytes: 0,
      networkTxBytes: 0,
    };
  }
  
  private getImage(language: string): string {
    const imageMap: Record<string, string> = {
      python: 'docker.io/python:3.11-slim',
      javascript: 'docker.io/node:20-slim',
      typescript: 'docker.io/node:20-slim',
      go: 'docker.io/golang:1.21-alpine',
      rust: 'docker.io/rust:1.75-slim',
      java: 'docker.io/openjdk:17-slim',
      cpp: 'docker.io/gcc:13',
      shell: 'docker.io/alpine:latest',
    };
    
    return imageMap[language] || 'docker.io/alpine:latest';
  }
  
  private getFileName(language: string): string {
    const fileMap: Record<string, string> = {
      python: 'main.py',
      javascript: 'main.js',
      typescript: 'main.ts',
      go: 'main.go',
      rust: 'main.rs',
      java: 'Main.java',
      cpp: 'main.cpp',
      shell: 'main.sh',
    };
    
    return fileMap[language] || 'main.txt';
  }
  
  private getCommand(language: string, codeFile: string): string[] {
    const filename = path.basename(codeFile);
    
    const commandMap: Record<string, string[]> = {
      python: ['python', filename],
      javascript: ['node', filename],
      typescript: ['sh', '-c', `npx tsx ${filename}`],
      go: ['sh', '-c', `go run ${filename}`],
      rust: ['sh', '-c', `rustc ${filename} -o main && ./main`],
      java: ['sh', '-c', `javac ${filename} && java ${filename.replace('.java', '')}`],
      cpp: ['sh', '-c', `g++ ${filename} -o main && ./main`],
      shell: ['sh', filename],
    };
    
    return commandMap[language] || ['cat', filename];
  }
  
  private executeContainer(command: string, args: string[], timeout: number): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args);
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, timeout);
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        clearTimeout(timer);
        
        if (timedOut) {
          resolve({
            stdout,
            stderr: stderr + '\n[Process timed out]',
            exitCode: -1,
          });
        } else {
          resolve({
            stdout,
            stderr,
            exitCode: code || 0,
          });
        }
      });
      
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
  
  private parseMemory(memStr: string): number {
    const match = memStr.match(/(\d+\.?\d*)\s*([KMGT]?i?B?)/i);
    if (!match) return 0;
    
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    
    const multipliers: Record<string, number> = {
      'B': 1 / (1024 * 1024),
      'KB': 1 / 1024,
      'MB': 1,
      'GB': 1024,
      'TB': 1024 * 1024,
      'KIB': 1 / 1024,
      'MIB': 1,
      'GIB': 1024,
      'TIB': 1024 * 1024,
    };
    
    const multiplier = multipliers[unit] || 1;
    return Math.round(value * multiplier);
  }
}