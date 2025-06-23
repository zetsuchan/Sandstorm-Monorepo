import { BareMetalNode } from '@sandstorm/core';

export interface BareMetalConfig {
  nodes: BareMetalNode[];
  bootcRegistry: string;
  sshConfig: {
    username: string;
    privateKey?: string;
    password?: string;
    port?: number;
  };
  ipxeServerUrl: string;
  snapshotStoragePath: string;
}

export interface NodeProvisioningOptions {
  nodeId: string;
  bootcHash: string;
  userData?: string;
  networkConfig?: {
    staticIp?: string;
    gateway?: string;
    dns?: string[];
  };
}

export interface NodeSnapshot {
  nodeId: string;
  timestamp: Date;
  filesystemSnapshot: string;
  memorySnapshot?: string;
  bootcHash: string;
  metadata: Record<string, any>;
}