# @sandstorm/edge-agent

Run Sandstorm sandboxes on your own infrastructure with rootless container support.

## Features

- **Rootless Execution** - Run containers without root privileges using Podman
- **VPC Support** - Deploy in isolated networks without internet access
- **Resource Management** - Configure CPU, memory, and concurrency limits
- **Telemetry Relay** - Automatic reporting to Sandstorm cloud
- **Multi-Runtime** - Support for Podman and Docker
- **Zero Cost** - Run sandboxes on your own hardware

## Installation

```bash
npm install -g @sandstorm/edge-agent
```

## Quick Start

```bash
# Check system requirements
sandstorm-edge check

# Initialize configuration
sandstorm-edge init

# Edit configuration and add your API key
vim sandstorm-edge.json

# Start the agent
sandstorm-edge start -c sandstorm-edge.json
```

## Configuration

```json
{
  "agentName": "my-edge-agent",
  "apiKey": "<your-api-key>",
  "runtime": "podman",
  "rootless": true,
  "port": 8080,
  "maxConcurrentSandboxes": 10,
  "enableNetworkIsolation": true
}
```

## Programmatic Usage

```typescript
import { createEdgeAgent } from '@sandstorm/edge-agent';

const agent = await createEdgeAgent({
  apiKey: process.env.SANDSTORM_API_KEY,
  runtime: 'podman',
  rootless: true,
});

await agent.start();
```

## Documentation

See the [Self-Hosted Deployment Guide](../../docs/self-hosted-deployment.md) for detailed setup instructions.

## License

MIT