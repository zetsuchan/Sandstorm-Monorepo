# Introducing Sandstorm: The Vendor-Agnostic Sandbox Routing Layer

*January 2025*

## The Problem We're Solving

AI teams are drowning in sandbox complexity. They juggle E2B for quick REPLs, Modal for GPU jobs, Daytona for polyglot editing, and fallback to their own Kubernetes when credits dry up. Each provider speaks a different API dialect, enforces different quotas, and bills on different curves. 

Engineers waste days writing adapters, duplicating observability setups, and manually chasing the lowest cost option. Meanwhile, CFOs watch cloud costs spiral as teams accidentally leave expensive sandboxes running or hit surge pricing during peak hours.

## Enter Sandstorm

Sandstorm is a vendor-agnostic sandbox routing layer that abstracts away this complexity. One simple API call intelligently routes your code to the optimal execution environment:

```typescript
const result = await sandstorm.run({
  code: `print("Hello from the optimal cloud!")`,
  language: 'python',
  constraints: {
    maxCost: 0.10,
    maxLatency: 5000
  }
});
```

Behind that simple interface, Sandstorm:
- **Intelligently routes** workloads to E2B, Modal, Daytona, Morph, or your own K8s
- **Optimizes costs** by comparing real-time pricing across providers
- **Handles failures** with automatic retry and fallback logic
- **Unifies telemetry** into a single dashboard for logs, metrics, and spend
- **Enforces policies** for security, compliance, and budget controls

## Architecture: Cloud Layer 8

If bare-metal → VM → container → Kubernetes felt like moving from assembly to high-level languages, then Sandstorm is the "standard library" for the agent-native cloud era.

Our architecture treats infrastructure as compiler flags—90% of the time you call our SDK, 10% you drop to provider-specific "assembly" when needed:

```
Your AI App → Sandstorm SDK → Smart Router → Provider Adapters → [E2B|Modal|Daytona|K8s]
                                    ↓
                            Cost Optimization
                            Telemetry & Billing  
                            Security Policies
```

## What We've Built So Far

### Core Infrastructure
- **Monorepo structure** with TypeScript packages and Rust services
- **Type-safe interfaces** for sandbox specifications and results
- **Provider adapter framework** for pluggable backends
- **Client SDKs** starting with TypeScript (Python, Go, Rust coming soon)

### Key Components

**@sandstorm/core** - Shared types and interfaces
```typescript
interface SandboxSpec {
  code: string;
  language: Language;
  cpu?: number;
  memory?: number;
  timeout?: number;
  gpu?: boolean;
  requirements?: string[];
  environment?: Record<string, string>;
}
```

**@sandstorm/sdk** - Dead-simple client library
```typescript
const sandstorm = new Sandstorm({ apiKey: process.env.SANDSTORM_API_KEY });
const result = await sandstorm.run({ code, language: 'python' });
```

**Gateway Service** - High-performance Rust router
- Axum-based HTTP server
- Provider health monitoring
- Smart routing decisions
- Unified logging pipeline

## The Business Model

We're building a sustainable business through:
- **Usage fees**: 5% margin on compute + $0.001/GB-hour for snapshots
- **Enterprise tier**: VPC isolation, SSO, custom SLAs starting at $3k/month
- **Marketplace cut**: 2% on third-party capacity sold through our platform

## What's Next

This is just the foundation. We're already working on:
- Production-ready adapters for all major providers
- ML-powered cost prediction and optimization
- Durable state snapshots with on-chain anchoring
- Edge deployment capabilities
- Enterprise security features

## Join the Revolution

Sandstorm transforms how AI teams think about compute. No more vendor lock-in. No more manual cost optimization. No more integration headaches.

Just write your code and let Sandstorm handle the rest.

Check out our [GitHub repo](https://github.com/zetsuchan/Sandstorm-Monorepo) and join us in building the future of AI infrastructure.

---

*Sandstorm: One API to rule them all.*