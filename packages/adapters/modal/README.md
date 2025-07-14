# @sandstorm/adapters-modal

Modal adapter for Sandstorm - provides integration with Modal's serverless infrastructure for AI code execution.

## Features

- Container-based sandbox execution
- Support for custom Docker images
- GPU support (T4, A10G, A100, H100)
- Function deployment and invocation
- Persistent storage options
- Interactive streaming
- Pay-per-CPU-cycle pricing
- SOC 2 compliant infrastructure

## Installation

```bash
npm install @sandstorm/adapters-modal
```

## Usage

```typescript
import { ModalProvider } from '@sandstorm/adapters-modal';

// Initialize the provider
const provider = new ModalProvider({
  apiKey: process.env.MODAL_API_KEY!,
  workspace: 'my-workspace',
  defaultTimeout: 60000,
});

// Check availability
const available = await provider.isAvailable();

// Run code in a sandbox
const result = await provider.run({
  code: 'print("Hello from Modal!")',
  language: 'python',
  cpu: 2,
  memory: 2048,
  gpu: true,
  gpuType: 'T4',
  timeout: 30000,
});

console.log(result.stdout); // "Hello from Modal!"
```

## Configuration

The Modal provider accepts the following configuration options:

- `apiKey` (required): Your Modal API key
- `workspace` (required): Modal workspace name
- `defaultTimeout`: Default timeout for sandbox execution (default: 120000ms)
- `defaultImage`: Default container image (default: 'python:3.11-slim')
- `region`: Preferred region for execution

## Provider-Specific Features

### Custom Container Images

Modal supports any OCI/Docker image:

```typescript
const result = await provider.run({
  code: 'node -e "console.log(process.version)"',
  language: 'javascript',
  containerImage: 'node:20-alpine',
});
```

### GPU Support

Modal offers various GPU types for ML workloads:

```typescript
const result = await provider.run({
  code: `
import torch
print(f"CUDA available: {torch.cuda.is_available()}")
print(f"Device: {torch.cuda.get_device_name(0)}")
  `,
  language: 'python',
  gpu: true,
  gpuType: 'A100', // T4, A10G, A100, H100
});
```

### Function Deployment

Deploy functions for repeated use:

```typescript
// Deploy a function
const functionId = await provider.deployFunction({
  name: 'my-function',
  code: 'def process(data): return data.upper()',
  language: 'python',
});

// Invoke the deployed function
const result = await provider.invokeFunction(functionId, {
  args: ['hello world'],
});
```

### Persistent Storage

Modal sandboxes can use persistent volumes:

```typescript
const result = await provider.run({
  code: 'echo "data" > /mnt/volume/file.txt',
  language: 'shell',
  volumes: {
    '/mnt/volume': 'my-persistent-volume',
  },
});
```

## Cost Estimation

Modal charges per CPU cycle with no idle costs:
- CPU: ~$0.000001 per CPU-second
- GPU: Variable pricing based on GPU type
- Memory: Included in CPU pricing
- Storage: $0.10/GB/month for persistent volumes

## Error Handling

The provider handles Modal-specific errors:
- Container creation failures
- Resource limits exceeded
- Network timeouts
- Authentication errors
- Quota limits

## Advanced Features

### Streaming Output

```typescript
const result = await provider.run({
  code: 'for i in range(5): print(i); time.sleep(1)',
  language: 'python',
  streaming: true,
  onStdout: (chunk) => console.log('Output:', chunk),
});
```

### Resource Monitoring

```typescript
const metrics = await provider.getResourceUsage(sandboxId);
console.log('CPU cycles used:', metrics.cpuCycles);
console.log('Memory peak:', metrics.memoryPeak);
```

## License

MIT