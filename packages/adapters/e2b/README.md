# @sandstorm/adapters-e2b

E2B adapter for Sandstorm - provides integration with E2B's Code Interpreter SDK for secure AI code execution.

## Features

- Fast sandbox startup (~150-200ms)
- Support for Python, JavaScript, Ruby, and C++
- Real-time streaming of stdout/stderr
- File system operations
- Package installation support
- Jupyter notebook compatibility
- Data visualization support
- Persistent sandbox sessions (up to 24 hours)

## Installation

```bash
npm install @sandstorm/adapters-e2b
```

## Usage

```typescript
import { E2BProvider } from '@sandstorm/adapters-e2b';

// Initialize the provider
const provider = new E2BProvider({
  apiKey: process.env.E2B_API_KEY!,
  defaultTimeout: 60000, // 60 seconds
});

// Check availability
const available = await provider.isAvailable();

// Run code in a sandbox
const result = await provider.run({
  code: 'print("Hello from E2B!")',
  language: 'python',
  cpu: 1,
  memory: 512,
  timeout: 30000,
});

console.log(result.stdout); // "Hello from E2B!"
```

## Configuration

The E2B provider accepts the following configuration options:

- `apiKey` (required): Your E2B API key
- `defaultTimeout`: Default timeout for sandbox execution (default: 120000ms)
- `baseUrl`: Custom API base URL (optional)
- `maxRetries`: Maximum number of retry attempts (default: 3)

## Provider-Specific Features

### Streaming Output

E2B supports real-time streaming of execution output:

```typescript
const result = await provider.run({
  code: 'for i in range(5): print(i); time.sleep(1)',
  language: 'python',
  streaming: true,
  onStdout: (data) => console.log('Output:', data),
  onStderr: (data) => console.error('Error:', data),
});
```

### File Operations

E2B sandboxes support file operations:

```typescript
const result = await provider.run({
  code: 'with open("output.txt", "w") as f: f.write("Hello")',
  language: 'python',
  files: {
    'input.txt': 'Initial content',
  },
});

// Access output files
console.log(result.files['output.txt']); // "Hello"
```

### Package Installation

Install packages dynamically during execution:

```typescript
const result = await provider.run({
  code: `
    import subprocess
    subprocess.run(['pip', 'install', 'requests'])
    import requests
    print(requests.__version__)
  `,
  language: 'python',
});
```

## Cost Estimation

E2B charges per second of sandbox runtime. The provider estimates costs based on:
- Base rate per second
- Additional charges for GPU usage
- Premium features (persistent sessions, high memory)

## Error Handling

The provider handles E2B-specific errors and maps them to standard Sandstorm error types:
- Rate limiting
- Quota exceeded
- Invalid API key
- Sandbox timeout
- Resource limits

## License

MIT