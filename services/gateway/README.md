# Sandstorm Gateway Service

The Gateway Service is the core component of Sandstorm that manages sandbox execution through a pluggable runtime system. It provides a unified API for creating, managing, and monitoring isolated code execution environments.

## Runtime System Architecture

The gateway implements a pluggable containerd shims system with three main runtime implementations:

### Supported Runtimes

1. **gVisor (runsc)** - Standard to Strong Isolation
   - Uses application kernel for syscall interception
   - Provides good performance with enhanced security
   - Best for: Standard workloads requiring process isolation

2. **Kata Containers** - Strong to Maximum Isolation  
   - Lightweight VMs with hardware virtualization
   - Balances security and performance
   - Best for: Multi-tenant environments with strong isolation needs

3. **Firecracker** - Maximum Isolation
   - MicroVMs with minimal attack surface
   - Hardware-level isolation with fast startup
   - Best for: Serverless workloads requiring maximum security

### Isolation Levels

- **Standard**: Basic namespace and cgroup isolation (→ gVisor)
- **Strong**: VM-based isolation with shared kernel (→ Kata)  
- **Maximum**: Full hardware virtualization (→ Firecracker)

## API Endpoints

### Sandbox Management

- `POST /v1/sandboxes/run` - Create and run a new sandbox
- `POST /v1/sandboxes/:id/exec` - Execute command in existing sandbox
- `GET /v1/sandboxes/:id/status` - Get sandbox status
- `DELETE /v1/sandboxes/:id` - Destroy sandbox

### Snapshot Operations

- `POST /v1/sandboxes/:id/snapshot` - Create sandbox snapshot
- `POST /v1/sandboxes/resume` - Resume from snapshot

### Runtime Information

- `GET /v1/runtimes` - List available runtimes and their capabilities

## Configuration

The gateway automatically detects available runtime binaries on startup:

- **gVisor**: `/usr/local/bin/runsc`, `/usr/bin/runsc`, `./bin/runsc`
- **Kata**: `/usr/local/bin/kata-runtime`, `/usr/bin/kata-runtime`, `./bin/kata-runtime`  
- **Firecracker**: `/usr/local/bin/firecracker` + `/usr/local/bin/jailer`

## Request Format

```json
{
  "code": "print('Hello, World!')",
  "language": "python",
  "isolation_level": "standard",
  "runtime_preference": "gvisor",
  "cpu_limit": 1.0,
  "memory_limit": 536870912,
  "timeout": 30000,
  "environment": {
    "PYTHONPATH": "/workspace"
  },
  "mounts": [
    {
      "source": "/host/data",
      "destination": "/workspace/data", 
      "read_only": true
    }
  ]
}
```

## Runtime Selection Logic

1. If `runtime_preference` is specified and supports the `isolation_level`, use it
2. Otherwise, select based on isolation level:
   - `standard` → gVisor
   - `strong` → Kata
   - `maximum` → Firecracker

## Development

### Running Tests

```bash
cargo test
```

### Starting the Server

```bash
cargo run
```

The server will start on `http://localhost:3000` and automatically detect available runtimes.

### Adding New Runtimes

1. Implement the `SandboxRuntime` trait in a new module
2. Add the runtime to the registry initialization in `main.rs`
3. Update the isolation level support matrix

## Security Considerations

- All runtimes provide different levels of isolation
- Firecracker offers the strongest security through hardware virtualization
- gVisor provides good security with better performance
- Kata balances both security and performance for most use cases

## Performance Characteristics

- **Firecracker**: Highest isolation, ~150ms startup, minimal overhead
- **Kata**: Strong isolation, ~500ms startup, low overhead  
- **gVisor**: Good isolation, ~50ms startup, some syscall overhead

Choose the runtime based on your security requirements and performance needs.