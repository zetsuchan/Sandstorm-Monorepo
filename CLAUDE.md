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
bun install

# Build all packages
bun run build

# Run development servers
bun run dev

# Run tests
bun run test

# Run tests for specific package
cd packages/<package-name> && bun test

# Run integration tests
RUN_INTEGRATION_TESTS=1 bun test

# Lint code
bun run lint

# Type checking
bun run typecheck

# Format code
bun run format

# Clean build artifacts
bun run clean

# Run scripts directly with Bun
bun scripts/build.ts
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

- **Framework**: Bun's built-in test runner
- **Test Location**: Tests are co-located with source files or in `__tests__` directories
- **Integration Tests**: Require `RUN_INTEGRATION_TESTS=1` environment variable
- **Container Testing**: Mocked Podman/Docker for unit tests, real containers for integration tests
- **Test Syntax**: Uses `bun:test` with `describe`, `it`, `expect`, etc.

## Build System

- **TypeScript**: Bun's built-in bundler (replaced tsup)
- **Rust**: Cargo for services
- **Orchestration**: Turbo for efficient monorepo builds
- **Runtime**: Bun for all JavaScript/TypeScript execution
- **Package Manager**: Bun (replaced pnpm)

## Key Documentation

- `/README.md`: Project overview and quick start
- `/docs/IMPLEMENTATION_PLAN.md`: v2 feature roadmap
- `/docs/ML_ORCHESTRATION.md`: AI-driven orchestration details
- `/docs/self-hosted-deployment.md`: Edge deployment guide