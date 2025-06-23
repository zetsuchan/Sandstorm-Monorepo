# Sandstorm Security Package

## Overview

The Sandstorm Security package provides comprehensive runtime security monitoring, threat detection, and compliance features for the Sandstorm platform. It integrates with multiple security tools and provides both basic and enhanced "Shield" tier capabilities.

## Features

### Core Security Monitoring
- **Falco Integration**: Runtime threat detection using Falco rules
- **eBPF Monitoring**: Low-level system call and kernel event monitoring
- **SIEM Integration**: Enterprise webhook integration for security events
- **Event Aggregation**: Intelligent event correlation and pattern detection
- **Auto-Quarantine**: Automatic sandbox isolation for suspicious behavior

### Shield Tier Features
- **Enhanced Monitoring**: Advanced threat detection with ML-based anomaly detection
- **Compliance Reporting**: Automated compliance reports for PCI-DSS, HIPAA, SOC2, ISO27001, GDPR
- **Signed Provenance**: Cryptographic proof of sandbox execution with blockchain anchoring
- **Real-time Dashboard**: Live security metrics and alerting

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Falco          │    │  eBPF Programs   │    │  SIEM Webhook   │
│  Integration    │───▶│  (File/Net/Proc) │───▶│  Integration    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                Security Event Aggregator                       │
├─────────────────────────────────────────────────────────────────┤
│  • Pattern Detection    • Anomaly Detection                    │
│  • Event Correlation    • Threat Intelligence                  │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                Policy Engine                                    │
├─────────────────────────────────────────────────────────────────┤
│  • Rule Evaluation      • Action Determination                 │
│  • Threshold Checking   • Auto-Quarantine Logic               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                Security Monitor                                 │
├─────────────────────────────────────────────────────────────────┤
│  • Event Storage        • Quarantine Management                │
│  • Dashboard Metrics    • Compliance Tracking                  │
└─────────────────────────────────────────────────────────────────┘
```

## Installation

```bash
# Install the security package
npm install @sandstorm/security

# Install security monitor service dependencies
cd services/security-monitor
cargo build --release
```

## Configuration

### Environment Variables

```bash
# Security Monitor Service
DATABASE_URL=postgres://user:pass@localhost/sandstorm_security
EBPF_ENABLED=true
FALCO_ENABLED=true
FALCO_RULES_PATH=/etc/falco/rules.yaml
SIEM_WEBHOOK_URL=https://your-siem.com/webhook
SIEM_API_KEY=your-api-key
```

### Security Policies

```typescript
import { SecurityMonitor, securityPolicyTemplates } from '@sandstorm/security';

const monitor = new SecurityMonitor();

// Apply basic security policy
await monitor.applyPolicy(securityPolicyTemplates.basic);

// Apply Shield tier policy for enhanced protection
await monitor.applyPolicy(securityPolicyTemplates.shield);

// Apply specialized policies
await monitor.applyPolicy(securityPolicyTemplates.crypto);
await monitor.applyPolicy(securityPolicyTemplates.ml_workload);
```

## Usage

### Basic Security Monitoring

```typescript
import { SecurityMonitor, FalcoIntegration, EbpfMonitor } from '@sandstorm/security';

// Initialize security monitor
const monitor = new SecurityMonitor();

// Set up integrations
const falco = new FalcoIntegration();
await falco.initialize({ enabled: true });

const ebpf = new EbpfMonitor();
await ebpf.initialize({ enabled: true });

// Start monitoring
falco.onEvent(async (event) => {
  await monitor.captureEvent(event);
});

ebpf.onTrace(async (trace) => {
  // Convert eBPF trace to security event
  const event = convertTraceToEvent(trace);
  await monitor.captureEvent(event);
});
```

### SIEM Integration

```typescript
import { SiemIntegration } from '@sandstorm/security';

const siem = new SiemIntegration();
await siem.initialize({
  enabled: true,
  webhook: 'https://your-siem.com/api/events',
  apiKey: 'your-api-key',
  batchSize: 100,
  flushInterval: 5000
});

// Events are automatically sent to SIEM
monitor.on('event', (event) => {
  siem.sendEvent(event);
});
```

### Compliance Reporting

```typescript
import { ComplianceEngine } from '@sandstorm/security';

const compliance = new ComplianceEngine();

// Generate PCI-DSS compliance report
const report = await compliance.generateReport('pci-dss', sandboxId, {
  start: new Date('2023-01-01'),
  end: new Date('2023-12-31')
});

// Schedule automated reports
await compliance.scheduleReport('hipaa', '0 0 1 * *'); // Monthly
```

### Provenance and Attestation

```typescript
import { ProvenanceService } from '@sandstorm/security';

const provenance = new ProvenanceService();

// Create signed provenance for sandbox execution
const signedProvenance = await provenance.createProvenance(
  sandboxResult,
  securityEvents
);

// Anchor on blockchain for immutable proof
const anchor = await provenance.anchorOnChain(
  signedProvenance,
  'ethereum'
);

// Verify provenance
const isValid = await provenance.verifyProvenance(signedProvenance);
```

## Security Event Types

| Type | Description | Severity Levels |
|------|-------------|-----------------|
| `file_access` | File system access events | low, medium, high |
| `network_activity` | Network connections and data transfer | low, medium, high, critical |
| `process_spawn` | Process creation and execution | medium, high |
| `privilege_escalation` | Privilege escalation attempts | high, critical |
| `resource_limit` | Resource usage violations | medium, high |
| `suspicious_behavior` | Anomalous or malicious patterns | high, critical |
| `policy_violation` | Security policy violations | medium, high, critical |
| `quarantine` | Sandbox quarantine events | critical |
| `compliance_check` | Compliance requirement checks | low, medium, high |

## Policy Templates

### Basic Security Policy
- Blocks access to critical system files
- Alerts on privilege escalation
- Monitors network activity

### Shield Security Policy
- Auto-quarantine for critical events
- Enhanced suspicious behavior detection
- Resource limit enforcement
- Compliance violation tracking

### Specialized Policies
- **Cryptocurrency**: Protects private keys, detects mining
- **ML/AI Workloads**: Monitors model files, GPU usage
- **Zero Trust**: Deny-by-default with strict controls

## Dashboard and Monitoring

The security package includes a real-time dashboard accessible via WebSocket:

```typescript
import { SecurityDashboard } from '@sandstorm/security';

const dashboard = new SecurityDashboard(monitor);

// Subscribe to real-time updates
const unsubscribe = dashboard.subscribeToUpdates((update) => {
  console.log('Security update:', update);
});

// Get current metrics
const metrics = await dashboard.getRealtimeMetrics();
const alerts = await dashboard.getActiveAlerts();
```

## Performance Considerations

- **eBPF Programs**: Minimal overhead (~1-3% CPU)
- **Event Processing**: Async batching for high throughput
- **Storage**: Configurable retention and aggregation
- **Network**: Efficient SIEM webhook batching

## Security Best Practices

1. **Principle of Least Privilege**: Apply restrictive policies by default
2. **Defense in Depth**: Layer multiple security controls
3. **Continuous Monitoring**: Enable all available integrations
4. **Incident Response**: Configure auto-quarantine for critical events
5. **Compliance**: Regular automated compliance reporting
6. **Audit Trail**: Maintain immutable provenance records

## Troubleshooting

### Common Issues

**eBPF programs fail to load**
```bash
# Check kernel version and BPF support
uname -r
cat /boot/config-$(uname -r) | grep BPF

# Verify permissions
sudo setcap cap_sys_admin+ep /path/to/security-monitor
```

**Falco integration not working**
```bash
# Check Falco installation
falco --version

# Verify rules file
falco -r /etc/falco/rules.yaml --dry-run
```

**High event volume**
```bash
# Adjust aggregation settings
export EVENT_BATCH_SIZE=1000
export METRICS_RETENTION_DAYS=7
```

## License

MIT License - see LICENSE file for details.