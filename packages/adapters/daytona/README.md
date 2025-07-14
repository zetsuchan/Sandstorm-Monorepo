# @sandstorm/adapters-daytona

Daytona adapter for Sandstorm - provides integration with Daytona's secure infrastructure for AI-generated code execution.

## Features

- Ultra-fast sandbox creation (~90ms)
- Secure isolated workspaces
- Support for multiple programming languages
- Git integration
- OCI/Docker image compatibility
- Persistent workspace sessions
- SDK support for both sync and async operations
- Infrastructure flexibility (cloud, Kubernetes, bare metal)

## Installation

```bash
npm install @sandstorm/adapters-daytona
```

## Usage

```typescript
import { DaytonaProvider } from '@sandstorm/adapters-daytona';

// Initialize the provider
const provider = new DaytonaProvider({
  apiKey: process.env.DAYTONA_API_KEY!,
  apiUrl: 'https://api.daytona.io',
  defaultTimeout: 60000,
});

// Check availability
const available = await provider.isAvailable();

// Run code in a sandbox
const result = await provider.run({
  code: 'print("Hello from Daytona!")',
  language: 'python',
  cpu: 2,
  memory: 1024,
  timeout: 30000,
});

console.log(result.stdout); // "Hello from Daytona!"
```

## Configuration

The Daytona provider accepts the following configuration options:

- `apiKey` (required): Your Daytona API key
- `apiUrl`: Daytona API endpoint (default: 'https://api.daytona.io')
- `defaultTimeout`: Default timeout for sandbox execution (default: 120000ms)
- `defaultWorkspaceTemplate`: Default workspace template to use
- `region`: Preferred region for workspace creation

## Provider-Specific Features

### Workspace Templates

Daytona supports pre-configured workspace templates:

```typescript
const result = await provider.run({
  code: 'print("Using custom workspace")',
  language: 'python',
  workspaceTemplate: 'ml-workspace',
});
```

### Git Integration

Clone and work with Git repositories:

```typescript
const result = await provider.run({
  code: 'git status',
  language: 'shell',
  gitRepo: 'https://github.com/example/repo.git',
  gitBranch: 'main',
});
```

### Persistent Workspaces

Create long-running workspaces:

```typescript
const workspaceId = await provider.createWorkspace({
  name: 'my-ai-workspace',
  template: 'python-ml',
  persistent: true,
});

// Run multiple executions in the same workspace
const result1 = await provider.runInWorkspace(workspaceId, {
  code: 'pip install numpy',
  language: 'shell',
});

const result2 = await provider.runInWorkspace(workspaceId, {
  code: 'import numpy; print(numpy.__version__)',
  language: 'python',
});
```

### Fast Boot Optimization

Daytona's 90ms startup time is achieved through:
- Pre-warmed containers
- Optimized image caching
- Efficient resource allocation

## Cost Estimation

Daytona uses custom pricing models:
- Workspace creation: Fixed cost per workspace
- Execution time: Per-minute billing
- Storage: GB/month for persistent data
- Network: Egress charges for large transfers

## Error Handling

The provider handles Daytona-specific errors:
- Workspace creation failures
- Resource allocation errors
- Network connectivity issues
- API rate limiting
- Quota exceeded

## Advanced Features

### Workspace Snapshots

```typescript
// Create a snapshot
const snapshotId = await provider.snapshot(workspaceId);

// Restore from snapshot
const newWorkspaceId = await provider.restore(snapshotId);
```

### Resource Monitoring

```typescript
const metrics = await provider.getWorkspaceMetrics(workspaceId);
console.log('CPU usage:', metrics.cpu);
console.log('Memory usage:', metrics.memory);
console.log('Disk I/O:', metrics.diskIO);
```

### Multi-Language Support

```typescript
// Run multiple languages in the same workspace
const pythonResult = await provider.run({
  code: 'print("Python")',
  language: 'python',
});

const jsResult = await provider.run({
  code: 'console.log("JavaScript")',
  language: 'javascript',
  workspaceId: pythonResult.workspaceId, // Reuse workspace
});
```

## Security Features

- Isolated execution environments
- Network policies
- Resource limits
- Audit logging
- Compliance certifications

## License

MIT