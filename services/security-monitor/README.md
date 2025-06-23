# Sandstorm Security Monitor Service

A high-performance Rust service that provides real-time security monitoring for Sandstorm sandboxes.

## Overview

The Security Monitor Service is the core component of Sandstorm's runtime security infrastructure. It runs alongside sandboxes to collect security events, enforce policies, and provide auto-quarantine capabilities.

## Features

- **Real-time Event Processing**: High-throughput security event ingestion and processing
- **eBPF Integration**: Low-level kernel monitoring with minimal overhead
- **Falco Integration**: Advanced threat detection using Falco rules
- **Auto-Quarantine**: Automatic sandbox isolation for security violations
- **Policy Engine**: Flexible rule-based security policy enforcement
- **SIEM Integration**: Enterprise security information and event management
- **Compliance Reporting**: Automated compliance reports for various standards
- **Real-time Dashboard**: WebSocket-based live security monitoring
- **Provenance Tracking**: Cryptographic proof of execution with blockchain anchoring

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Security Monitor Service                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │    eBPF     │  │    Falco    │  │    Event Aggregator     │ │
│  │  Monitor    │  │ Integration │  │                         │ │
│  │             │  │             │  │  • Pattern Detection   │ │
│  └─────────────┘  └─────────────┘  │  • Anomaly Detection   │ │
│         │                 │        │  • Correlation         │ │
│         └─────────────────┼────────┴─────────────────────────┘ │
│                          │                    │                │
│  ┌─────────────────────────────────────────────▼─────────────┐  │
│  │                 Policy Engine                            │  │
│  │                                                          │  │
│  │  • Rule Evaluation     • Threshold Checking             │  │
│  │  • Action Determination • Auto-Quarantine Logic         │  │
│  └─────────────────────────────────────────────┬─────────────┘  │
│                                                │                │
│  ┌─────────────────────────────────────────────▼─────────────┐  │
│  │                 Event Store                              │  │
│  │                                                          │  │
│  │  • PostgreSQL Storage  • Event Indexing                 │  │
│  │  • Metrics Aggregation • Retention Management           │  │
│  └─────────────────────────────────────────────┬─────────────┘  │
│                                                │                │
│  ┌─────────────────────────────────────────────▼─────────────┐  │
│  │               API & Dashboard                            │  │
│  │                                                          │  │
│  │  • REST API           • WebSocket Streaming             │  │
│  │  • Prometheus Metrics • Real-time Dashboard             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Installation

### Prerequisites

- Rust 1.70+
- PostgreSQL 13+
- Linux kernel 5.4+ (for eBPF support)
- Falco (optional, for enhanced threat detection)

### Build

```bash
cd services/security-monitor
cargo build --release
```

### Database Setup

```bash
# Create database
createdb sandstorm_security

# Set connection string
export DATABASE_URL="postgres://user:pass@localhost/sandstorm_security"

# Run migrations
sqlx migrate run
```

## Configuration

### Environment Variables

```bash
# Server Configuration
PORT=8081
DATABASE_URL=postgres://user:pass@localhost/sandstorm_security

# eBPF Configuration
EBPF_ENABLED=true

# Falco Configuration
FALCO_ENABLED=true
FALCO_RULES_PATH=/etc/falco/rules.yaml

# SIEM Integration
SIEM_WEBHOOK_URL=https://your-siem.com/webhook
SIEM_API_KEY=your-api-key

# Retention and Performance
METRICS_RETENTION_DAYS=30
EVENT_BATCH_SIZE=1000
QUARANTINE_AUTO_RELEASE=false
QUARANTINE_MAX_DURATION_HOURS=24
```

### Falco Rules

Create custom Falco rules for Sandstorm-specific threats:

```yaml
# /etc/falco/sandstorm-rules.yaml
- rule: Sandstorm Crypto Mining Detection
  desc: Detect cryptocurrency mining in sandboxes
  condition: >
    spawned_process and proc.name in (xmrig, minergate, cpuminer) or
    (proc.cmdline contains "stratum" or proc.cmdline contains "mining")
  output: >
    Crypto mining detected in sandbox (user=%user.name command=%proc.cmdline 
    sandbox=%k8s.pod.label.sandstorm_sandbox_id)
  priority: CRITICAL

- rule: Sandstorm Privilege Escalation
  desc: Detect privilege escalation attempts in sandboxes
  condition: >
    spawned_process and proc.name in (sudo, su, pkexec) and
    k8s.pod.label.sandstorm_tier exists
  output: >
    Privilege escalation attempt in sandbox (user=%user.name command=%proc.cmdline 
    sandbox=%k8s.pod.label.sandstorm_sandbox_id)
  priority: HIGH

- rule: Sandstorm Sensitive File Access
  desc: Detect access to sensitive files in sandboxes
  condition: >
    open_read and fd.name in (/etc/passwd, /etc/shadow, /root/.ssh/id_rsa) and
    k8s.pod.label.sandstorm_tier exists
  output: >
    Sensitive file access in sandbox (user=%user.name file=%fd.name 
    sandbox=%k8s.pod.label.sandstorm_sandbox_id)
  priority: HIGH
```

## Usage

### Starting the Service

```bash
# Start the security monitor
./target/release/security-monitor

# Or with systemd
sudo systemctl start sandstorm-security-monitor
sudo systemctl enable sandstorm-security-monitor
```

### API Endpoints

#### Events

```bash
# Capture security event
curl -X POST http://localhost:8081/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "id": "event_123",
    "event_type": "file_access",
    "severity": "medium",
    "timestamp": "2023-12-01T10:00:00Z",
    "sandbox_id": "sandbox_456",
    "provider": "kubernetes",
    "message": "File access detected",
    "details": {"file": "/etc/passwd"}
  }'

# List events
curl "http://localhost:8081/api/events?sandbox_id=sandbox_456&limit=100"

# Aggregate events
curl "http://localhost:8081/api/events/aggregate?window_ms=300000"
```

#### Policies

```bash
# Create security policy
curl -X POST http://localhost:8081/api/policies \
  -H "Content-Type: application/json" \
  -d '{
    "id": "policy_custom",
    "name": "Custom Policy",
    "description": "Custom security policy",
    "enabled": true,
    "tier": "shield",
    "rules": [...]
  }'

# List policies
curl http://localhost:8081/api/policies

# Update policy
curl -X PUT http://localhost:8081/api/policies/policy_custom \
  -H "Content-Type: application/json" \
  -d '{...}'
```

#### Quarantine

```bash
# Quarantine sandbox
curl -X POST http://localhost:8081/api/quarantine \
  -H "Content-Type: application/json" \
  -d '{
    "sandbox_id": "sandbox_456",
    "reason": "Critical security violation",
    "triggering_event": {...}
  }'

# Release from quarantine
curl -X POST http://localhost:8081/api/quarantine/quarantine_123/release

# List quarantines
curl http://localhost:8081/api/quarantine
```

#### Monitoring

```bash
# Start monitoring sandbox
curl -X POST http://localhost:8081/api/monitor/sandbox/sandbox_456/start \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "kubernetes",
    "ebpf_programs": ["file_monitor", "network_monitor"],
    "falco_rules": "/etc/falco/sandstorm-rules.yaml"
  }'

# Stop monitoring
curl -X POST http://localhost:8081/api/monitor/sandbox/sandbox_456/stop

# Get monitoring status
curl http://localhost:8081/api/monitor/sandbox/sandbox_456/status
```

#### Dashboard

```bash
# Get dashboard metrics
curl http://localhost:8081/api/dashboard/metrics

# Get alerts
curl http://localhost:8081/api/dashboard/alerts

# WebSocket connection for real-time updates
wscat -c ws://localhost:8081/api/dashboard/ws
```

### WebSocket API

Connect to `ws://localhost:8081/api/dashboard/ws` for real-time updates:

```javascript
const ws = new WebSocket('ws://localhost:8081/api/dashboard/ws');

ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  
  switch (update.type) {
    case 'security_event':
      console.log('New security event:', update.data);
      break;
    case 'alert':
      console.log('Security alert:', update.data);
      break;
    case 'metrics_update':
      console.log('Metrics update:', update.data);
      break;
  }
};

// Subscribe to specific channels
ws.send(JSON.stringify({
  type: 'subscribe',
  channel: 'critical_events'
}));
```

## Monitoring and Metrics

### Prometheus Metrics

Available at `http://localhost:8081/metrics`:

```
# HELP security_events_total Total number of security events processed
# TYPE security_events_total counter
security_events_total{} 1234

# HELP security_events_by_type_file_access Number of file_access events
# TYPE security_events_by_type_file_access counter
security_events_by_type_file_access{} 456

# HELP quarantined_sandboxes Number of currently quarantined sandboxes
# TYPE quarantined_sandboxes gauge
quarantined_sandboxes{} 3

# HELP security_response_time_seconds Time taken to process security events
# TYPE security_response_time_seconds histogram
security_response_time_seconds_bucket{le="0.001"} 100
security_response_time_seconds_bucket{le="0.01"} 450
security_response_time_seconds_bucket{le="0.1"} 800
```

### Health Checks

```bash
# Basic health check
curl http://localhost:8081/health

# Detailed system status
curl http://localhost:8081/api/dashboard/metrics
```

## Performance Tuning

### Database Optimization

```sql
-- Partition large tables by date
CREATE TABLE security_events_2023_12 PARTITION OF security_events
FOR VALUES FROM ('2023-12-01') TO ('2024-01-01');

-- Optimize indexes for common queries
CREATE INDEX CONCURRENTLY idx_security_events_sandbox_timestamp 
ON security_events(sandbox_id, timestamp DESC);

-- Configure autovacuum for high-write tables
ALTER TABLE security_events SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);
```

### eBPF Program Optimization

```c
// Minimize map lookups in hot paths
// Use per-CPU arrays for better performance
// Implement efficient filtering in kernel space
```

### Event Processing

```bash
# Increase batch sizes for high-volume environments
export EVENT_BATCH_SIZE=5000

# Adjust flush intervals
export SIEM_FLUSH_INTERVAL=1000

# Enable async processing
export ASYNC_EVENT_PROCESSING=true
```

## Security Considerations

### Access Control

- Service should run with minimal privileges
- Use dedicated database user with limited permissions
- Restrict API access with authentication/authorization
- Encrypt sensitive configuration values

### Network Security

- Use TLS for all external communications
- Implement rate limiting on API endpoints
- Validate and sanitize all input data
- Use secure WebSocket connections (WSS)

### Data Protection

- Encrypt sensitive event data at rest
- Implement proper data retention policies
- Ensure secure deletion of expired data
- Regular security audits of stored data

## Troubleshooting

### Common Issues

**Service fails to start**
```bash
# Check database connectivity
psql $DATABASE_URL -c "SELECT 1"

# Verify eBPF support
sudo bpftool prog list

# Check Falco installation
falco --version
```

**High memory usage**
```bash
# Reduce event batch size
export EVENT_BATCH_SIZE=500

# Decrease retention period
export METRICS_RETENTION_DAYS=7

# Enable event compression
export COMPRESS_EVENTS=true
```

**eBPF programs not loading**
```bash
# Check kernel version
uname -r

# Verify BPF capabilities
sudo setcap cap_sys_admin,cap_bpf+ep ./security-monitor

# Debug BPF loading
export RUST_LOG=libbpf=debug
```

**Performance issues**
```bash
# Enable async processing
export ASYNC_EVENT_PROCESSING=true

# Increase worker threads
export TOKIO_WORKER_THREADS=8

# Optimize database connections
export DATABASE_MAX_CONNECTIONS=20
```

## Development

### Building from Source

```bash
# Install dependencies
sudo apt-get install libbpf-dev clang llvm

# Build with debug info
cargo build --features debug

# Run tests
cargo test

# Run with hot reload
cargo watch -x run
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details.