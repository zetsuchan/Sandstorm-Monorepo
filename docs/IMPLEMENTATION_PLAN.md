# Sandstorm v2 Implementation Plan

## Overview

This document outlines the implementation plan for upgrading Sandstorm with 2025-era container technology, including bootc, rootless runtimes, pluggable containerd shims, AI-driven orchestration, multi-cloud edge support, and runtime security.

## Core Features to Implement

### 1. Bootc Integration (bootable-container images)
**Goal**: Enable Sandstorm to ship whole OS layers as OCI images for bare-metal/VM deployment

**Tasks**:
- Create `packages/bootc-builder` package
- Implement bootc hash storage in SandboxSpec
- Build bare-metal provider adapter
- Create cold-boot pool management system

**Key Files**:
- `packages/bootc-builder/src/builder.ts`
- `packages/adapters/bare-metal/src/index.ts`
- `services/pool-manager/src/main.rs`

### 2. Rootless/Daemon-less Runtime Support
**Goal**: Zero-root sandboxes for regulated environments and self-hosted edge mode

**Tasks**:
- Create `packages/edge-agent` for rootless Podman integration
- Build self-hosted mode in SDK
- Implement telemetry relay from edge nodes
- Add VPC deployment documentation

**Key Files**:
- `packages/edge-agent/src/podman-adapter.ts`
- `packages/sdk/src/edge-mode.ts`
- `docs/self-hosted-deployment.md`

### 3. Pluggable Containerd Shims
**Goal**: Support multiple isolation backends (Firecracker, gVisor, Kata) based on requirements

**Tasks**:
- Define `SandboxRuntime` trait in Rust
- Implement shim registry system
- Create adapters for Firecracker, gVisor, Kata
- Add isolation level to SandboxSpec

**Key Files**:
- `services/gateway/src/runtime/mod.rs`
- `services/gateway/src/runtime/firecracker.rs`
- `services/gateway/src/runtime/gvisor.rs`
- `services/gateway/src/runtime/kata.rs`

### 4. AI-Driven Orchestration
**Goal**: ML-based routing for optimal cost/performance placement

**Tasks**:
- Create `packages/ml-router` with LightGBM integration
- Build telemetry collection pipeline
- Implement cost-latency prediction model
- Add "optimize_cost" strategy to API

**Key Files**:
- `packages/ml-router/src/predictor.ts`
- `packages/ml-router/src/training.ts`
- `services/telemetry-collector/src/main.rs`

### 5. Multi-Cloud + Edge Containerization
**Goal**: Deploy sandboxes to 5G MEC, sovereign clouds, and edge POPs

**Tasks**:
- Create Edge Targets API
- Implement edge node discovery
- Build bootc-based edge flashing system
- Add latency-based routing

**Key Files**:
- `packages/edge-discovery/src/index.ts`
- `services/edge-coordinator/src/main.rs`
- `packages/core/src/edge-types.ts`

### 6. Runtime Security Add-ons
**Goal**: Enterprise-grade runtime threat detection and compliance

**Tasks**:
- Integrate Falco/eBPF rules engine
- Build security event collector
- Implement SIEM webhook integration
- Create Shield tier with auto-quarantine

**Key Files**:
- `packages/security/src/falco-integration.ts`
- `packages/security/src/siem-webhook.ts`
- `services/security-monitor/src/main.rs`

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
1. Set up shim registry architecture
2. Create bootc builder prototype
3. Implement basic rootless agent

### Phase 2: Core Features (Weeks 3-4)
1. Complete Firecracker and Podman shims
2. Build ML telemetry pipeline
3. Deploy edge discovery system

### Phase 3: Advanced Features (Weeks 5-6)
1. Integrate Falco security monitoring
2. Complete gVisor and Kata shims
3. Train and deploy ML routing model

### Phase 4: Production Readiness (Weeks 7-8)
1. Performance optimization
2. Security hardening
3. Documentation and examples
4. Launch new SKUs (Edge, Autopilot, Shield, BootKit)

## Parallel Work Streams

The following components can be developed in parallel by separate agents:

1. **Bootc & Bare-Metal Stream**
   - bootc-builder package
   - Bare-metal adapter
   - Cold-boot pool manager

2. **Rootless & Edge Stream**
   - Edge agent with Podman
   - Self-hosted SDK mode
   - Edge telemetry relay

3. **Shim Registry Stream**
   - Runtime trait definition
   - Firecracker adapter
   - gVisor adapter
   - Kata adapter

4. **ML & Optimization Stream**
   - ML router package
   - Telemetry collector
   - Cost prediction model

5. **Security Stream**
   - Falco integration
   - SIEM webhooks
   - Shield tier features