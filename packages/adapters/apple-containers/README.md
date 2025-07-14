# @sandstorm/adapters-apple-containers

Apple Containers adapter for Sandstorm - Native macOS containerization with VM-level isolation.

## Overview

This adapter integrates Apple's native Containerization framework with Sandstorm, providing secure container execution on macOS. Unlike traditional container runtimes that share the host kernel, Apple Containers runs each container in its own lightweight virtual machine, offering superior isolation and security.

## Features

- **VM-Level Isolation**: Each container runs in its own lightweight VM
- **Native macOS Integration**: Leverages Apple's Virtualization framework
- **OCI Compliance**: Supports standard container images from any registry
- **Sub-Second Startup**: Despite VM overhead, achieves fast container startup
- **Rosetta 2 Support**: Run x86_64 containers on Apple Silicon
- **Resource Management**: Fine-grained CPU and memory controls

## Requirements

- **macOS 15.0+** (Sequoia or later)
- **Apple Silicon** (M1/M2/M3) - Intel Macs have limited support
- **Apple Container CLI** installed and running

## Installation

```bash
# Install the adapter
bun add @sandstorm/adapters-apple-containers

# Install Apple Container CLI (if not already installed)
# Download from: https://github.com/apple/container/releases
# Then start the container system:
container system start
```

## Usage

```typescript
import { Sandstorm } from '@sandstorm/sdk';
import { AppleContainersProvider } from '@sandstorm/adapters-apple-containers';

// Initialize the provider
const provider = new AppleContainersProvider({
  defaultTimeout: 30000,
  maxMemoryGB: 4,
  maxCpuCores: 4,
  enableRosetta: true, // For x86_64 containers
});

// Use with Sandstorm SDK
const sandstorm = new Sandstorm({
  providers: [provider],
});

// Run code in a secure VM-isolated container
const result = await sandstorm.run({
  code: `
    import numpy as np
    print(f"Random matrix: {np.random.rand(3, 3)}")
  `,
  language: 'python',
  requirements: ['numpy'],
  provider: 'apple-containers',
});
```

## Configuration

```typescript
interface AppleContainersConfig {
  defaultTimeout?: number;      // Default: 30000ms
  maxMemoryGB?: number;        // Default: 4GB
  maxCpuCores?: number;        // Default: 4 cores
  enableRosetta?: boolean;     // Default: true
  customKernel?: string;       // Custom kernel path
  containerPath?: string;      // Default: 'container'
  registryAuth?: Array<{       // Registry credentials
    registry: string;
    username: string;
    password: string;
  }>;
}
```

## Language Support

The adapter automatically selects appropriate container images:

| Language | Default Image |
|----------|--------------|
| Python | `python:3.11-slim` |
| JavaScript | `node:20-slim` |
| TypeScript | `node:20-slim` |
| Go | `golang:1.21-alpine` |
| Rust | `rust:1.75-slim` |
| Java | `eclipse-temurin:21-jre` |
| C++ | `gcc:13` |
| C# | `mcr.microsoft.com/dotnet/sdk:8.0` |
| PHP | `php:8.3-cli` |
| Ruby | `ruby:3.3-slim` |
| Shell | `alpine:latest` |

## Custom Images

You can use custom OCI-compliant images:

```typescript
const result = await sandstorm.run({
  code: 'print("Hello from custom image")',
  language: 'python',
  containerImage: 'myregistry.io/my-python:latest',
  provider: 'apple-containers',
});
```

## Security Benefits

1. **VM Isolation**: Each container runs in its own virtual machine
2. **No Shared Kernel**: Eliminates container escape vulnerabilities
3. **Keychain Integration**: Secure credential storage
4. **XPC Communication**: Hardened inter-process communication

## Limitations

- **macOS Only**: Requires macOS 15.0 or later
- **Apple Silicon Preferred**: Intel Macs have reduced functionality
- **No GPU Support**: GPU acceleration not yet available
- **Network Limitations**: Container-to-container networking is limited
- **No Snapshots**: Container snapshots not supported in v0.1.0

## Performance

Despite running containers in VMs, Apple Containers achieves:
- Sub-second startup times
- Efficient resource utilization
- Dynamic memory allocation
- Hardware-accelerated virtualization on Apple Silicon

## Examples

### Data Science Workload

```typescript
const result = await sandstorm.run({
  code: `
    import pandas as pd
    import matplotlib.pyplot as plt
    
    data = pd.DataFrame({
        'x': range(10),
        'y': [i**2 for i in range(10)]
    })
    
    print(data.describe())
  `,
  language: 'python',
  requirements: ['pandas', 'matplotlib'],
  memory: 2048,
  provider: 'apple-containers',
});
```

### Web Scraping

```typescript
const result = await sandstorm.run({
  code: `
    const axios = require('axios');
    const cheerio = require('cheerio');
    
    async function scrape() {
      const { data } = await axios.get('https://example.com');
      const $ = cheerio.load(data);
      console.log($('title').text());
    }
    
    scrape();
  `,
  language: 'javascript',
  requirements: ['axios', 'cheerio'],
  provider: 'apple-containers',
});
```

## Troubleshooting

### Container system not running

```bash
# Check status
container system status

# Start if needed
container system start
```

### Image pull failures

```bash
# Manually pull image
container image pull <image-name>

# Check available images
container image ls
```

### Resource limits

Ensure your system has sufficient resources:
- At least 8GB RAM recommended
- 20GB free disk space
- Apple Silicon for best performance

## License

MIT - See LICENSE file for details