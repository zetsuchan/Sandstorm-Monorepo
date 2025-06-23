import axios, { AxiosInstance } from 'axios';
import { SandboxSpec, SandboxResult, SandboxConstraints, ISandboxProvider } from '@sandstorm/core';
import { RunOptions } from './client';

export interface EdgeAgentConfig {
  agentUrl: string;
  apiKey?: string;
  timeout?: number;
}

export interface EdgeAgentInfo {
  agentId: string;
  status: 'starting' | 'running' | 'degraded' | 'stopping' | 'stopped';
  version: string;
  runtime: {
    type: 'podman' | 'docker';
    version: string;
    rootless: boolean;
  };
  resources: {
    totalMemoryMB: number;
    usedMemoryMB: number;
    totalCpuCores: number;
    cpuUsagePercent: number;
  };
  sandboxes: {
    running: number;
    completed: number;
    failed: number;
    queued: number;
  };
}

export class EdgeModeClient implements ISandboxProvider {
  name = 'edge' as const;
  private client: AxiosInstance;
  private agentInfo?: EdgeAgentInfo;
  
  constructor(private config: EdgeAgentConfig) {
    this.client = axios.create({
      baseURL: config.agentUrl,
      timeout: config.timeout || 120000,
      headers: config.apiKey ? {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      } : {
        'Content-Type': 'application/json',
      },
    });
  }
  
  async connect(): Promise<void> {
    try {
      const response = await this.client.get<EdgeAgentInfo>('/status');
      this.agentInfo = response.data;
    } catch (error) {
      throw new Error(`Failed to connect to edge agent: ${error}`);
    }
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }
  
  async estimateCost(spec: SandboxSpec): Promise<number> {
    // Edge agents have no direct cost
    return 0;
  }
  
  async estimateLatency(spec: SandboxSpec): Promise<number> {
    // Estimate based on agent resources
    if (!this.agentInfo) {
      await this.connect();
    }
    
    const baseLatency = 100;
    const queueFactor = 1 + (this.agentInfo!.sandboxes.queued * 0.5);
    const loadFactor = 1 + (this.agentInfo!.sandboxes.running / 10);
    
    return Math.round(baseLatency * queueFactor * loadFactor);
  }
  
  async run(spec: SandboxSpec): Promise<SandboxResult> {
    const response = await this.client.post<SandboxResult>('/run', spec);
    return response.data;
  }
  
  async runWithOptions(options: RunOptions): Promise<SandboxResult> {
    const spec: SandboxSpec = {
      code: options.code,
      language: options.language || 'python',
      requirements: options.requirements,
      environment: options.environment,
      files: options.files,
      cpu: options.constraints?.cpu,
      memory: options.constraints?.memory,
      timeout: options.constraints?.timeout,
      gpu: options.constraints?.gpu,
    };
    
    return this.run(spec);
  }
  
  async snapshot(sandboxId: string): Promise<any> {
    throw new Error('Snapshots not supported on edge agents');
  }
  
  async restore(snapshotId: string): Promise<string> {
    throw new Error('Snapshots not supported on edge agents');
  }
  
  async getQuota(): Promise<{ used: number; limit: number }> {
    if (!this.agentInfo) {
      await this.connect();
    }
    
    const used = this.agentInfo!.sandboxes.completed + this.agentInfo!.sandboxes.failed;
    return { used, limit: Infinity };
  }
  
  async getStatus(): Promise<EdgeAgentInfo> {
    const response = await this.client.get<EdgeAgentInfo>('/status');
    this.agentInfo = response.data;
    return response.data;
  }
  
  async getMetrics(): Promise<any> {
    const response = await this.client.get('/metrics');
    return response.data;
  }
}

// Extended Sandstorm client for edge mode
export interface SandstormEdgeConfig {
  apiKey?: string;
  baseUrl?: string;
  edgeAgents?: EdgeAgentConfig[];
  preferEdge?: boolean;
  edgeFallbackToCloud?: boolean;
}

export class SandstormEdge {
  private cloudClient?: AxiosInstance;
  private edgeClients: EdgeModeClient[] = [];
  
  constructor(private config: SandstormEdgeConfig) {
    // Initialize cloud client if API key is provided
    if (config.apiKey) {
      this.cloudClient = axios.create({
        baseURL: config.baseUrl || 'https://api.sandstorm.dev',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
    }
    
    // Initialize edge clients
    if (config.edgeAgents) {
      this.edgeClients = config.edgeAgents.map(agent => new EdgeModeClient(agent));
    }
  }
  
  async connectEdgeAgents(): Promise<void> {
    await Promise.allSettled(
      this.edgeClients.map(client => client.connect())
    );
  }
  
  async run(options: RunOptions | SandboxSpec & { constraints?: SandboxConstraints }): Promise<SandboxResult> {
    const spec: SandboxSpec = 'code' in options ? {
      code: options.code,
      language: options.language || 'python',
      requirements: options.requirements,
      environment: options.environment,
      files: options.files,
    } : options;
    
    // Try edge agents first if preferred
    if (this.config.preferEdge && this.edgeClients.length > 0) {
      const availableEdgeClients = await this.getAvailableEdgeClients();
      
      if (availableEdgeClients.length > 0) {
        // Select edge client with lowest latency
        const selectedClient = await this.selectBestEdgeClient(availableEdgeClients, spec);
        
        try {
          return await selectedClient.run(spec);
        } catch (error) {
          console.error('Edge execution failed:', error);
          
          if (!this.config.edgeFallbackToCloud || !this.cloudClient) {
            throw error;
          }
        }
      }
    }
    
    // Fall back to cloud
    if (!this.cloudClient) {
      throw new Error('No cloud client configured and edge execution failed');
    }
    
    const response = await this.cloudClient.post<SandboxResult>('/v1/sandboxes/run', {
      spec,
      constraints: options.constraints,
    });
    
    return response.data;
  }
  
  async getEdgeAgentsStatus(): Promise<EdgeAgentInfo[]> {
    const statuses = await Promise.allSettled(
      this.edgeClients.map(client => client.getStatus())
    );
    
    return statuses
      .filter((result): result is PromiseFulfilledResult<EdgeAgentInfo> => 
        result.status === 'fulfilled'
      )
      .map(result => result.value);
  }
  
  private async getAvailableEdgeClients(): Promise<EdgeModeClient[]> {
    const availabilityChecks = await Promise.allSettled(
      this.edgeClients.map(async (client) => ({
        client,
        available: await client.isAvailable(),
      }))
    );
    
    return availabilityChecks
      .filter((result): result is PromiseFulfilledResult<{ client: EdgeModeClient; available: boolean }> => 
        result.status === 'fulfilled' && result.value.available
      )
      .map(result => result.value.client);
  }
  
  private async selectBestEdgeClient(
    clients: EdgeModeClient[], 
    spec: SandboxSpec
  ): Promise<EdgeModeClient> {
    const latencies = await Promise.all(
      clients.map(async (client) => ({
        client,
        latency: await client.estimateLatency(spec),
      }))
    );
    
    latencies.sort((a, b) => a.latency - b.latency);
    return latencies[0].client;
  }
}

// Convenience function to create edge-enabled client
export function createSandstormEdge(config: SandstormEdgeConfig): SandstormEdge {
  return new SandstormEdge(config);
}