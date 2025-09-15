# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Shared `@sandstorm/telemetry` package with edge status/metrics schemas and client helpers.
- Snapshot Vault Axum service for storing snapshot metadata and blobs locally.
- Sandstorm dashboard app scaffolded with edge fleet, recent runs, and provider performance views.

### Changed
- Edge agent now samples real Podman stats, streams sandbox run telemetry, and reports richer system metrics.
- Telemetry collector ingests edge status/metrics/log batches and exposes query APIs consumed by the dashboard and ML router.
- ML router incorporates live edge capacity signals to inform provider selection for `edge` workloads.

## [Unreleased]

## [0.3.0] - 2025-07-14

### Added
- **Apple Containers Adapter**: Native macOS containerization support with VM-level isolation
  - Each container runs in its own lightweight virtual machine
  - Deep integration with macOS tools (Keychain, XPC, vmnet)
  - Sub-second startup despite VM overhead
  - Rosetta 2 support for x86_64 containers on Apple Silicon
  - Enhanced security through complete kernel isolation
  - OCI-compliant with support for standard container images

### Changed
- **Complete Migration to Bun.js**: Replaced entire JavaScript toolchain with Bun
  - Package management: Migrated from pnpm to Bun workspaces
  - Build system: Replaced tsup with Bun's native bundler
  - Test runner: Migrated from Vitest to Bun's built-in test framework
  - Runtime: Now using Bun as the primary JavaScript runtime
- **Performance Improvements**: 
  - Faster installs with Bun's binary lockfile
  - Reduced build times with native bundling
  - Improved test execution speed
- **Developer Experience**:
  - Simplified toolchain with single tool for all JS operations
  - Native TypeScript execution without compilation step
  - Built-in test runner with familiar syntax

### Technical Details
- **Bun Version**: 1.0+
- **Build Configuration**: Custom build script using Bun.build API
- **Test Migration**: Updated all test imports from 'vitest' to 'bun:test'
- **CI/CD**: Updated GitHub Actions to use oven-sh/setup-bun

### Migration Notes
- Removed `pnpm-workspace.yaml` in favor of `bunfig.toml`
- Updated all package.json scripts to use Bun commands
- Replaced `it.skipIf` with `it.if` for conditional tests
- All TypeScript packages now built with Bun's bundler

## [0.2.0] - 2025-07-13

### Added
- **Provider Adapters**: Implemented specific adapters for major sandbox providers
  - E2B adapter (`@sandstorm/adapters-e2b`) with Code Interpreter SDK integration
  - Modal adapter (`@sandstorm/adapters-modal`) with serverless container support
  - Daytona adapter (`@sandstorm/adapters-daytona`) with ultra-fast 90ms startup
- **Unified API Layer**: Extended core types to support provider-specific features while maintaining a consistent interface
- **Streaming Support**: Added `StreamHandlers` interface for real-time output streaming
- **Provider-Specific Features**:
  - E2B: Jupyter notebook support, data visualization, persistent sessions
  - Modal: Custom container images, GPU support, function deployment
  - Daytona: Workspace templates, Git integration, persistent workspaces
- **Cost & Latency Optimization**: Smart provider selection based on constraints
- **Comprehensive Examples**: Added unified usage examples demonstrating cross-provider execution

### Changed
- Extended `SandboxSpec` type with provider-specific optional fields
- Enhanced `ISandboxProvider` interface with streaming support and cleanup methods
- Updated README with new adapter documentation

### Technical Details
- **Languages**: TypeScript (90%), Rust (8%), Python (2%)
- **Dependencies**: Added provider SDKs (@e2b/code-interpreter, modal, @daytonaio/sdk)
- **Build System**: Configured tsup for all adapter packages

## [0.1.0] - 2025-01-12

### Added
- **Core Infrastructure**: Monorepo setup with pnpm workspaces and Turbo
- **Base Packages**:
  - `@sandstorm/core`: Core interfaces and types
  - `@sandstorm/sdk`: Client SDK with cloud and edge modes
  - `@sandstorm/edge-agent`: Rootless edge agent using Podman
  - `@sandstorm/arbitrage`: Cost optimization engine
  - `@sandstorm/ml-router`: ML-based routing with LightGBM
  - `@sandstorm/security`: Runtime security monitoring
  - `@sandstorm/telemetry`: Unified logging and monitoring
  - `@sandstorm/bootc-builder`: Bootable container images
- **Rust Services**:
  - Gateway service with pluggable containerd shims
  - Telemetry collector
  - Security monitor with eBPF
  - Snapshot vault for durable state
- **Provider Support**: Initial bare-metal adapter
- **Documentation**: Comprehensive README, implementation plans, and ML orchestration guide

### Technical Foundation
- **Architecture**: Vendor-agnostic sandbox routing layer
- **Security**: Multi-tier security model with Falco integration
- **Deployment**: Support for cloud, edge, and bare-metal deployments
- **Observability**: OpenTelemetry-based telemetry stack

## [0.0.1] - 2025-01-11

### Added
- Initial project setup
- Basic monorepo structure
- License (MIT)
- Core package definitions

[Unreleased]: https://github.com/sandstorm/sandstorm/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/sandstorm/sandstorm/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/sandstorm/sandstorm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sandstorm/sandstorm/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/sandstorm/sandstorm/releases/tag/v0.0.1
