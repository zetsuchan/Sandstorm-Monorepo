import { FastifyInstance, fastify } from 'fastify';
import { v4 as uuid } from 'uuid';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SandboxSpec, SandboxResult, ISandboxProvider } from '@sandstorm/core';
import { 
  EdgeAgentConfig, 
  EdgeAgentStatus, 
  EdgeAgentMetrics,
  ContainerRuntime,
  TelemetryRelay,
  LogEntry
} from './types';
import {
  EdgeSandboxRunMetrics,
  EdgeSystemMetrics,
} from '@sandstorm/telemetry';
import { PodmanAdapter } from './adapters/podman';
import { CloudTelemetryRelay, MockTelemetryRelay } from './telemetry';
import pino from 'pino';

export class EdgeAgent implements ISandboxProvider {
  name = 'edge' as any;
  private server: FastifyInstance;
  private runtime: ContainerRuntime;
  private telemetry: TelemetryRelay;
  private config: EdgeAgentConfig;
  private agentId: string;
  private startTime: number;
  private logger = pino();
  private lastRunMetrics?: EdgeSandboxRunMetrics;
  private currentSystemMetrics?: EdgeSystemMetrics;
  private systemCounters?: {
    timestamp: number;
    rxBytes: number;
    txBytes: number;
    diskReadBytes: number;
    diskWriteBytes: number;
  };
  
  private stats = {
    running: 0,
    completed: 0,
    failed: 0,
    queued: 0,
  };
  
  constructor(config: EdgeAgentConfig) {
    this.config = config;
    this.agentId = config.agentId || uuid();
    this.startTime = Date.now();
    
    // Initialize runtime
    if (config.runtime === 'podman') {
      this.runtime = new PodmanAdapter({ rootless: config.rootless });
    } else {
      throw new Error(`Unsupported runtime: ${config.runtime}`);
    }
    
    // Initialize telemetry
    if (config.apiKey && config.cloudApiUrl) {
      this.telemetry = new CloudTelemetryRelay({
        apiUrl: config.cloudApiUrl,
        apiKey: config.apiKey,
        agentId: this.agentId,
        flushInterval: config.telemetryInterval,
      });
    } else {
      this.telemetry = new MockTelemetryRelay();
    }
    
    // Initialize server
    this.server = fastify({
      logger: this.logger,
    });
    
    this.setupRoutes();
    this.startTelemetry();
  }
  
  async start(): Promise<void> {
    // Ensure runtime is available
    const available = await this.runtime.isAvailable();
    if (!available) {
      throw new Error(`Runtime ${this.config.runtime} is not available`);
    }
    
    // Create working directories
    await fs.mkdir(this.config.workDir, { recursive: true });
    await fs.mkdir(this.config.tempDir, { recursive: true });
    
    // Start server
    await this.server.listen({
      port: this.config.listenPort,
      host: this.config.listenHost,
    });
    
    this.logger.info(`Edge agent started on ${this.config.listenHost}:${this.config.listenPort}`);
    
    // Send initial status
    await this.telemetry.sendStatus(await this.getStatus());
  }
  
  async stop(): Promise<void> {
    await this.server.close();
    this.logger.info('Edge agent stopped');
  }
  
  async isAvailable(): Promise<boolean> {
    return this.runtime.isAvailable();
  }
  
  async estimateCost(spec: SandboxSpec): Promise<number> {
    // Edge agents have no direct cost
    return 0;
  }
  
  async estimateLatency(spec: SandboxSpec): Promise<number> {
    // Estimate based on local resources
    const baseLatency = 100; // Base startup time in ms
    const memoryFactor = (spec.memory || 512) / 512;
    const cpuFactor = (spec.cpu || 1);
    
    return Math.round(baseLatency * memoryFactor * cpuFactor);
  }
  
  async run(spec: SandboxSpec): Promise<SandboxResult> {
    this.stats.queued++;
    
    try {
      // Check resource limits
      if (this.stats.running >= this.config.maxConcurrentSandboxes) {
        throw new Error('Maximum concurrent sandboxes reached');
      }
      
      this.stats.running++;
      this.stats.queued--;
      
      // Run sandbox
      const result = await this.runtime.runSandbox(spec, this.config);
      
      this.stats.completed++;
      this.stats.running--;
      
      // Track metrics
      await this.trackSandboxMetrics(spec, result);
      
      return result;
    } catch (error) {
      this.stats.failed++;
      this.stats.running--;
      
      // Log error
      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `Sandbox execution failed: ${error}`,
        context: { spec, error: error.toString() },
      };
      
      await this.telemetry.sendLogs([logEntry]);
      
      throw error;
    }
  }
  
  async snapshot(sandboxId: string): Promise<any> {
    throw new Error('Snapshots not supported on edge agents');
  }
  
  async restore(snapshotId: string): Promise<string> {
    throw new Error('Snapshots not supported on edge agents');
  }
  
  async getQuota(): Promise<{ used: number; limit: number }> {
    const used = this.stats.completed + this.stats.failed;
    return { used, limit: Infinity };
  }
  
  private setupRoutes(): void {
    // Health check
    this.server.get('/health', async () => {
      return { status: 'ok', agentId: this.agentId };
    });
    
    // Status endpoint
    this.server.get('/status', async () => {
      return await this.getStatus();
    });
    
    // Run sandbox endpoint
    this.server.post('/run', async (request) => {
      const spec = request.body as SandboxSpec;
      return await this.run(spec);
    });
    
    // Metrics endpoint
    this.server.get('/metrics', async () => {
      return await this.getMetrics();
    });
  }
  
  private async getStatus(): Promise<EdgeAgentStatus> {
    const memInfo = await this.getMemoryInfo();
    const cpuInfo = await this.getCpuInfo();
    
    return {
      agentId: this.agentId,
      status: 'running',
      version: '0.0.1',
      uptime: Date.now() - this.startTime,
      lastHealthCheck: new Date().toISOString(),
      
      runtime: {
        type: this.config.runtime,
        version: await this.getRuntimeVersion(),
        rootless: this.config.rootless,
      },
      
      resources: {
        totalMemoryMB: memInfo.total,
        usedMemoryMB: memInfo.used,
        totalCpuCores: cpuInfo.cores,
        cpuUsagePercent: cpuInfo.usage,
        diskUsageGB: await this.getDiskUsage(),
      },
      
      sandboxes: {
        running: this.stats.running,
        completed: this.stats.completed,
        failed: this.stats.failed,
        queued: this.stats.queued,
      },
      
      connectivity: {
        cloudApi: await this.checkCloudConnectivity(),
        lastSync: new Date().toISOString(),
        publicEndpoint: this.config.publicUrl,
      },
    };
  }
  
  private async getMetrics(): Promise<EdgeAgentMetrics> {
    if (!this.currentSystemMetrics) {
      await this.collectSystemMetrics();
    }

    return {
      timestamp: new Date().toISOString(),
      agentId: this.agentId,
      queueDepth: this.stats.queued,
      running: this.stats.running,
      completed: this.stats.completed,
      failed: this.stats.failed,
      system: this.currentSystemMetrics!,
      sandboxRun: this.lastRunMetrics,
    };
  }
  
  private startTelemetry(): void {
    // Collect system metrics every 5 seconds
    setInterval(async () => {
      try {
        await this.collectSystemMetrics();
      } catch (error) {
        this.logger.warn({ error }, 'Failed to collect system metrics');
      }
    }, 5000);
    
    // Send telemetry at configured interval
    setInterval(async () => {
      try {
        await this.telemetry.sendStatus(await this.getStatus());
        await this.telemetry.sendMetrics(await this.getMetrics());
      } catch (error) {
        this.logger.error('Failed to send telemetry:', error);
      }
    }, this.config.telemetryInterval);
  }

  private async trackSandboxMetrics(spec: SandboxSpec, result: SandboxResult): Promise<void> {
    const metrics = result.metrics ?? {};
    const runMetrics: EdgeSandboxRunMetrics = {
      sandboxId: result.id,
      agentId: this.agentId,
      provider: 'edge',
      language: spec.language,
      durationMs: result.duration,
      exitCode: result.exitCode,
      cpuPercent: metrics.cpuUsage ?? null,
      memoryMB: metrics.memoryUsage ?? null,
      networkRxBytes: metrics.networkRxBytes ?? null,
      networkTxBytes: metrics.networkTxBytes ?? null,
      timestamp: new Date().toISOString(),
    };

    this.lastRunMetrics = runMetrics;

    if (this.telemetry.sendSandboxRun) {
      await this.telemetry.sendSandboxRun({
        telemetry: {
          sandboxId: result.id,
          provider: 'edge',
          language: spec.language,
          exitCode: result.exitCode,
          durationMs: result.duration,
          cost: result.cost,
          cpuRequested: spec.cpu,
          memoryRequested: spec.memory,
          hasGpu: Boolean(spec.gpu),
          timeoutMs: spec.timeout,
          cpuPercent: metrics.cpuUsage ?? null,
          memoryMB: metrics.memoryUsage ?? null,
          networkRxBytes: metrics.networkRxBytes ?? null,
          networkTxBytes: metrics.networkTxBytes ?? null,
          agentId: this.agentId,
          timestamp: runMetrics.timestamp,
          spec,
          result,
        },
      }).catch((error) => {
        this.logger.warn({ error }, 'Failed to push sandbox run telemetry');
      });
    }
  }
  
  private async getRuntimeVersion(): Promise<string> {
    try {
      const { execSync } = require('child_process');
      const output = execSync(`${this.config.runtime} --version`).toString();
      const match = output.match(/version (\d+\.\d+\.\d+)/);
      return match ? match[1] : 'unknown';
    } catch {
      return 'unknown';
    }
  }
  
  private async getMemoryInfo(): Promise<{ total: number; used: number }> {
    const total = os.totalmem() / (1024 * 1024);
    const free = os.freemem() / (1024 * 1024);
    return { total: Math.round(total), used: Math.round(total - free) };
  }
  
  private async getCpuInfo(): Promise<{ cores: number; usage: number }> {
    const cpus = os.cpus();
    const usage = cpus.reduce((acc, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      return acc + ((total - idle) / total * 100);
    }, 0) / cpus.length;
    
    return { cores: cpus.length, usage: Math.round(usage) };
  }
  
  private async collectSystemMetrics(): Promise<void> {
    const cpuInfo = await this.getCpuInfo();
    const memInfo = await this.getMemoryInfo();
    const load = os.loadavg();
    const now = Date.now();

    const netCounters = await this.readNetworkCounters();
    const diskCounters = await this.readDiskCounters();

    let rxRate = 0;
    let txRate = 0;
    let diskReadRate = 0;
    let diskWriteRate = 0;

    if (this.systemCounters) {
      const elapsed = Math.max(1, (now - this.systemCounters.timestamp) / 1000);
      if (netCounters) {
        rxRate = Math.max(0, (netCounters.rxBytes - this.systemCounters.rxBytes) / elapsed);
        txRate = Math.max(0, (netCounters.txBytes - this.systemCounters.txBytes) / elapsed);
      }
      if (diskCounters) {
        diskReadRate = Math.max(0, (diskCounters.readBytes - this.systemCounters.diskReadBytes) / elapsed);
        diskWriteRate = Math.max(0, (diskCounters.writeBytes - this.systemCounters.diskWriteBytes) / elapsed);
      }
    }

    this.currentSystemMetrics = {
      cpuPercent: cpuInfo.usage,
      loadAverage: [load[0], load[1], load[2]],
      memory: {
        totalMB: memInfo.total,
        usedMB: memInfo.used,
      },
      network: {
        rxBytesPerSec: rxRate,
        txBytesPerSec: txRate,
      },
      disk: {
        readBytesPerSec: diskReadRate,
        writeBytesPerSec: diskWriteRate,
      },
    };

    this.systemCounters = {
      timestamp: now,
      rxBytes: netCounters?.rxBytes ?? this.systemCounters?.rxBytes ?? 0,
      txBytes: netCounters?.txBytes ?? this.systemCounters?.txBytes ?? 0,
      diskReadBytes: diskCounters?.readBytes ?? this.systemCounters?.diskReadBytes ?? 0,
      diskWriteBytes: diskCounters?.writeBytes ?? this.systemCounters?.diskWriteBytes ?? 0,
    };
  }

  private async readNetworkCounters(): Promise<{ rxBytes: number; txBytes: number } | null> {
    try {
      const contents = await fs.readFile('/proc/net/dev', 'utf-8');
      const lines = contents.split('\n').slice(2);
      let rx = 0;
      let tx = 0;
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 17) continue;
        const iface = parts[0].replace(':', '');
        if (iface === 'lo') continue;
        rx += parseInt(parts[1], 10) || 0;
        tx += parseInt(parts[9], 10) || 0;
      }
      return { rxBytes: rx, txBytes: tx };
    } catch {
      return null;
    }
  }

  private async readDiskCounters(): Promise<{ readBytes: number; writeBytes: number } | null> {
    try {
      const contents = await fs.readFile('/proc/diskstats', 'utf-8');
      const lines = contents.trim().split('\n');
      let readSectors = 0;
      let writeSectors = 0;
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 14) continue;
        const name = parts[2];
        if (!name || name.startsWith('loop') || name.startsWith('ram')) {
          continue;
        }
        readSectors += parseInt(parts[5], 10) || 0;
        writeSectors += parseInt(parts[9], 10) || 0;
      }
      const sectorSize = 512;
      return {
        readBytes: readSectors * sectorSize,
        writeBytes: writeSectors * sectorSize,
      };
    } catch {
      return null;
    }
  }
  
  private async getDiskUsage(): Promise<number> {
    try {
      const { execSync } = require('child_process');
      const output = execSync(`df -BG ${this.config.workDir} | tail -1`).toString();
      const match = output.match(/(\d+)G/);
      return match ? parseInt(match[1]) : 0;
    } catch {
      return 0;
    }
  }
  
  private async checkCloudConnectivity(): Promise<boolean> {
    if (this.telemetry instanceof CloudTelemetryRelay) {
      return await this.telemetry.testConnection();
    }
    return false;
  }
}
