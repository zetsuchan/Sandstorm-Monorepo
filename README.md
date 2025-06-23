# Sandstorm - Vendor-Agnostic Sandbox Routing Layer

> One API to rule them all. Route AI workloads to E2B, Modal, Daytona, or your own K8s—automatically picking the fastest and cheapest option.

## Problem

AI teams now juggle 4-5 sandbox clouds—E2B for quick REPLs, Modal for heavy jobs, Daytona for poly-lang editing, plus their own K8s when credits run dry. Every provider has a different SDK, quota limits, and pricing curve. Engineers waste days wiring adapters, duplicating observability, and chasing the lowest cost.

## Solution

Sandstorm is a vendor-agnostic Sandbox Routing Layer that provides:

- **One 5-line SDK** (`sandstorm.run(code, spec)`) that dispatches to E2B, Daytona, Modal, Morph, or your own Kubernetes cluster
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
   ┌────▼────┐  ┌────▼────┐ ┌───▼────┐ ┌───▼────┐  ┌────▼────┐
   │   E2B   │  │  Modal  │ │Daytona │ │  Morph │  │   K8s   │
   └─────────┘  └─────────┘ └────────┘ └────────┘  └─────────┘
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
│   ├── sdk/            # Client SDKs
│   ├── adapters/       # Provider-specific adapters
│   ├── arbitrage/      # Cost optimization engine
│   └── telemetry/      # Unified logging/monitoring
├── services/
│   ├── gateway/        # Main API gateway (Rust)
│   └── snapshot-vault/ # Durable state storage
├── apps/
│   └── dashboard/      # Web monitoring dashboard
└── docs/               # Documentation
```

## Getting Started

### Prerequisites
- Node.js 18+
- pnpm 8+
- Rust 1.70+ (for gateway service)

### Installation

```bash
# Clone the repository
git clone https://github.com/sandstorm/sandstorm.git
cd sandstorm-monorepo

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run development servers
pnpm dev
```

## Business Model

- **Usage fee**: 5% margin on pass-through compute plus $0.001 per snapshot GB-hour
- **Enterprise tier**: VPC-isolated router + SSO + custom pricing (starts $3k/mo)
- **Provider marketplace cut**: 2% on third-party capacity sold through Sandstorm

## Roadmap

- [x] Core routing engine
- [ ] E2B, Modal, Daytona adapters
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