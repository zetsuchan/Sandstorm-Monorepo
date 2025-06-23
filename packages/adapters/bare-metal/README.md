# @sandstorm/adapter-bare-metal

Bare-metal provider adapter for Sandstorm. This adapter enables running sandboxes on physical servers using bootc images.

## Installation

```bash
pnpm add @sandstorm/adapter-bare-metal
```

## Usage

```typescript
import { BareMetalProvider, BareMetalConfig } from '@sandstorm/adapter-bare-metal';

const config: BareMetalConfig = {
  nodes: [{
    id: 'node-1',
    ipAddress: '192.168.1.100',
    macAddress: '00:11:22:33:44:55',
    hostname: 'bare-metal-1',
    status: 'available',
    specs: {
      cpu: 16,
      memory: 32768,
      disk: 1000,
      gpu: false
    }
  }],
  bootcRegistry: 'registry.example.com',
  sshConfig: {
    username: 'root',
    privateKey: '/path/to/key'
  },
  ipxeServerUrl: 'http://ipxe.example.com',
  snapshotStoragePath: '/var/lib/sandstorm/snapshots'
};

const provider = new BareMetalProvider(config);

// Run a sandbox
const result = await provider.run({
  code: 'print("Hello from bare metal!")',
  language: 'python',
  dockerfile: 'FROM quay.io/fedora/fedora-bootc:40\nRUN dnf install -y python3'
});
```

## Features

- Provisions bare-metal nodes using bootc images
- Supports snapshot/restore for bare-metal environments
- iPXE network booting
- Resource-based node selection
- Metrics collection (CPU, memory, GPU)

## Configuration

### BareMetalConfig

- `nodes`: Array of available bare-metal nodes
- `bootcRegistry`: Container registry for bootc images
- `sshConfig`: SSH configuration for node access
- `ipxeServerUrl`: URL of the iPXE server
- `snapshotStoragePath`: Path for storing snapshots

## Requirements

- iPXE server for network booting
- Container registry for bootc images
- SSH access to bare-metal nodes
- LVM for filesystem snapshots (optional)
- CRIU for memory snapshots (optional)