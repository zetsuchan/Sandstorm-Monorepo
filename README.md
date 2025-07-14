# Sandstorm - Vendor-Agnostic Sandbox Routing Layer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://img.shields.io/github/actions/workflow/status/zetsuchan/Sandstorm-Monorepo/ci.yml?label=CI)](https://github.com/zetsuchan/Sandstorm-Monorepo/actions)
[![Bun](https://img.shields.io/badge/bun-1.0%2B-F472B6.svg)](https://bun.sh)
[![Rust](https://img.shields.io/badge/rust-1.82%2B-orange.svg)](https://www.rust-lang.org/)
[![Production Ready](https://img.shields.io/badge/production-ready-brightgreen.svg)](https://github.com/zetsuchan/Sandstorm-Monorepo)
[![Sandstorm](https://img.shields.io/badge/Sandstorm-2024--2025-blue.svg)](https://github.com/zetsuchan/Sandstorm-Monorepo)

> One API to rule them all. Route AI workloads to E2B, Modal, Daytona, or your own K8s—automatically picking the fastest and cheapest option.

## Problem

AI teams now juggle 4-5 sandbox clouds—E2B for quick REPLs, Modal for heavy jobs, Daytona for poly-lang editing, plus their own K8s when credits run dry. Every provider has a different SDK, quota limits, and pricing curve. Engineers waste days wiring adapters, duplicating observability, and chasing the lowest cost.

## Solution

Sandstorm is a vendor-agnostic Sandbox Routing Layer that provides:

- **One 5-line SDK** (`sandstorm.run(code, spec)`) that dispatches to E2B, Daytona, Modal, Apple Containers, Morph, your own Kubernetes cluster, or rootless edge agents
- **Smart arbitrage engine** chooses the fastest or cheapest backend in real time, with automatic retry on quota errors
- **Unified telemetry & billing**: single dashboard for logs, snapshots, spend, and compliance across all sandboxes
- **Pluggable policies**: bring-your-own isolation rules, egress firewall, Secrets Manager integration, SOC-2 audit trail

## Quick Start

```typescript
import { Sandstorm } from '@sandstorm/sdk';

const sandstorm = new Sandstorm({
  apiKey: process.env.SANDSTORM_API_KEY
});

// Sandstorm automatically routes to the best provider
const result = await sandstorm.run({
  code: `
    import numpy as np
    print(np.random.rand(5))
  `,
  language: 'python',
  requirements: ['numpy'],
  constraints: {
    maxCost: 0.10,        // Max $0.10 per run
    maxLatency: 5000,     // Max 5s startup time
    preferredRegion: 'us-west'
  }
});
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   AI Developer  │     │   DevOps Team   │     │   Finance/Sec   │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                         │
         └───────────────────────┴─────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    Sandstorm Gateway    │
                    │  • Smart Routing         │
                    │  • Cost Optimization    │
                    │  • Unified Telemetry    │
                    └────────────┬────────────┘
                                 │
        ┌────────────┬───────────┼───────────┬────────────┐
        │            │           │           │            │
   ┌────▼────┐  ┌────▼────┐ ┌───▼────┐ ┌───▼────┐  ┌────▼────┐  ┌────▼────┐
   │   E2B   │  │  Modal  │ │Daytona │ │  Apple │  │  Morph │  │   K8s   │
   └─────────┘  └─────────┘ └────────┘ └────────┘  └─────────┘  └─────────┘
```

## Key Features

### Multi-Provider Orchestration
- Adapters translate our open `SandboxSpec` to each provider's API
- Automatic failover and retry on quota limits
- Provider health monitoring and circuit breaking

### Smart Cost Optimization
- Real-time price comparison across providers
- Spot capacity marketplace for unused credits
- Predictive routing based on workload patterns

### Enterprise-Grade Security
- End-to-end encryption for code and data
- VPC isolation and private endpoints
- SOC-2 compliant audit trails
- On-chain memory snapshots for provenance

### Developer Experience
- 5-line SDK in TypeScript, Python, Go, and Rust
- <100ms streaming logs from any sandbox
- Unified debugging and profiling tools
- VS Code and JetBrains extensions

## Monorepo Structure

```
sandstorm-monorepo/
├── packages/
│   ├── core/           # Core interfaces and types
│   ├── sdk/            # Client SDKs with edge mode support
│   ├── edge-agent/     # Rootless edge agent for self-hosted execution
│   ├── adapters/       # Provider-specific adapters
│   │   ├── e2b/        # E2B Code Interpreter integration
│   │   ├── modal/      # Modal serverless infrastructure
│   │   ├── daytona/    # Daytona fast workspace provider
│   │   ├── apple-containers/ # Apple's native containerization with VM isolation
│   │   └── bare-metal/ # Bare metal with bootc images
│   ├── arbitrage/      # Cost optimization engine
│   └── telemetry/      # Unified logging/monitoring
├── services/
│   ├── gateway/        # Main API gateway (Rust)
│   └── snapshot-vault/ # Durable state storage
├── apps/
│   └── dashboard/      # Web monitoring dashboard
└── docs/               # Documentation and deployment guides
```

## Getting Started

### Prerequisites
- Bun 1.0+ (JavaScript runtime & package manager)
- Rust 1.82+ (for gateway service)

### Installation

```bash
# Clone the repository
git clone https://github.com/sandstorm/sandstorm.git
cd sandstorm-monorepo

# Install dependencies
bun install

# Build all packages
bun run build

# Run development servers
bun run dev

# Run tests
bun run test
```

### Self-Hosted Edge Deployment

For running sandboxes on your own infrastructure:

```bash
# Install edge agent globally
bun install -g @sandstorm/edge-agent

# Check system requirements
sandstorm-edge check

# Initialize configuration
sandstorm-edge init

# Start edge agent
sandstorm-edge start -c sandstorm-edge.json
```

See the [Self-Hosted Deployment Guide](./docs/self-hosted-deployment.md) for detailed setup instructions.

## Business Model

- **Usage fee**: 5% margin on pass-through compute plus $0.001 per snapshot GB-hour
- **Enterprise tier**: VPC-isolated router + SSO + custom pricing (starts $3k/mo)
- **Provider marketplace cut**: 2% on third-party capacity sold through Sandstorm

## Roadmap

- [x] Core routing engine
- [x] Rootless edge agent with Podman support
- [x] SDK with edge mode integration
- [x] E2B, Modal, Daytona, Apple Containers adapters
- [ ] Cost optimization algorithm
- [ ] Snapshot vault with on-chain anchoring
- [ ] Enterprise security features
- [ ] Provider marketplace
- [ ] Edge relay network
- [ ] AI-powered workload prediction

## Vision

Become the Cloudflare of AI compute—a global edge network that routes every agent's code, memory, and data to the optimal execution substrate, abstracting the whole cloud layer into a single API.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines.

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

**Tagline**: Sandstorm lets AI developers run code on any sandbox cloud (or your own K8s) via one API that auto-shops for the fastest and cheapest option.