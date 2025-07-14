# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sandstorm is a vendor-agnostic Sandbox Routing Layer that provides a unified API for routing AI workloads to various sandbox providers (E2B, Modal, Daytona, Morph) or self-hosted infrastructure. It's built as a monorepo using pnpm workspaces and Turbo.

## Key Architecture

- **Monorepo Structure**: Uses pnpm workspaces with packages in `/packages` directory
- **Multi-language**: TypeScript for packages/SDKs, Rust for high-performance services (gateway, telemetry, security), Python for ML models
- **Core Design**: Smart routing engine that optimizes for cost and performance across multiple sandbox providers
- **Edge Support**: Rootless edge agent using Podman for self-hosted execution

## Essential Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run development servers
pnpm dev

# Run tests
pnpm test

# Run tests for specific package
cd packages/<package-name> && pnpm test

# Run integration tests
RUN_INTEGRATION_TESTS=1 pnpm test

# Lint code
pnpm lint

# Type checking
pnpm typecheck

# Format code
pnpm format

# Clean build artifacts
pnpm clean
```

## Package Structure

Core packages:
- `@sandstorm/core`: Shared interfaces and types
- `@sandstorm/sdk`: Client SDK with cloud/edge modes
- `@sandstorm/edge-agent`: Self-hosted execution using Podman
- `@sandstorm/arbitrage`: Cost optimization engine
- `@sandstorm/ml-router`: ML-based routing with LightGBM
- `@sandstorm/security`: Runtime security monitoring
- `@sandstorm/telemetry`: Logging and monitoring
- `@sandstorm/bootc-builder`: Bootable container images

Rust services in `/services`:
- `gateway`: Main API gateway with containerd shims
- `telemetry-collector`: High-performance telemetry
- `security-monitor`: eBPF-based security monitoring
- `snapshot-vault`: Durable state storage

## Testing Approach

- **Framework**: Vitest for TypeScript packages
- **Test Location**: Tests are co-located with source files or in `__tests__` directories
- **Integration Tests**: Require `RUN_INTEGRATION_TESTS=1` environment variable
- **Container Testing**: Mocked Podman/Docker for unit tests, real containers for integration tests

## Build System

- **TypeScript**: tsup for building packages
- **Rust**: Cargo for services
- **Orchestration**: Turbo for efficient monorepo builds
- **Configuration**: Shared TypeScript config in `/packages/tsconfig`

## Key Documentation

- `/README.md`: Project overview and quick start
- `/docs/IMPLEMENTATION_PLAN.md`: v2 feature roadmap
- `/docs/ML_ORCHESTRATION.md`: AI-driven orchestration details
- `/docs/self-hosted-deployment.md`: Edge deployment guide