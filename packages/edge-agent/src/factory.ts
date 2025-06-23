import { EdgeAgent } from './agent';
import { EdgeAgentConfig } from './types';
import * as os from 'os';
import * as path from 'path';

export interface CreateEdgeAgentOptions {
  apiKey?: string;
  cloudApiUrl?: string;
  agentName?: string;
  runtime?: 'podman' | 'docker';
  rootless?: boolean;
  port?: number;
  maxConcurrentSandboxes?: number;
  maxMemoryMB?: number;
  maxCpuCores?: number;
  workDir?: string;
  vpcMode?: boolean;
  enableNetworkIsolation?: boolean;
}

export async function createEdgeAgent(options: CreateEdgeAgentOptions = {}): Promise<EdgeAgent> {
  const config: EdgeAgentConfig = {
    // Required fields
    agentName: options.agentName || `edge-${os.hostname()}`,
    apiKey: options.apiKey || process.env.SANDSTORM_API_KEY || '',
    
    // Connection settings
    cloudApiUrl: options.cloudApiUrl || process.env.SANDSTORM_CLOUD_URL || 'https://api.sandstorm.dev',
    
    // Runtime configuration
    runtime: options.runtime || 'podman',
    rootless: options.rootless !== false,
    
    // Networking
    listenPort: options.port || 8080,
    listenHost: '0.0.0.0',
    
    // Resource limits
    maxConcurrentSandboxes: options.maxConcurrentSandboxes || 10,
    maxMemoryMB: options.maxMemoryMB || Math.floor(os.totalmem() / (1024 * 1024) * 0.8),
    maxCpuCores: options.maxCpuCores || os.cpus().length,
    
    // Storage
    workDir: options.workDir || path.join(os.homedir(), '.sandstorm-edge'),
    tempDir: path.join(os.tmpdir(), 'sandstorm-edge'),
    
    // Telemetry
    telemetryInterval: 30000,
    metricsRetention: 86400,
    
    // Security
    enableNetworkIsolation: options.enableNetworkIsolation !== false,
    
    // VPC Configuration
    vpcMode: options.vpcMode || false,
  };
  
  const agent = new EdgeAgent(config);
  return agent;
}