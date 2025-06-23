# Self-Hosted Edge Deployment Guide

This guide covers deploying Sandstorm Edge Agents on your own infrastructure for running sandboxes locally with rootless container support.

## Overview

Sandstorm Edge Agents allow you to run code sandboxes on your own infrastructure while maintaining connectivity to the Sandstorm cloud for telemetry and orchestration. Edge agents support:

- **Rootless execution** using Podman
- **VPC-isolated deployments** with no internet access
- **Local resource management** with configurable limits
- **Automatic telemetry relay** to Sandstorm cloud
- **Zero-cost execution** on your own hardware

## System Requirements

### Minimum Requirements

- Linux-based operating system (Ubuntu 20.04+, RHEL 8+, Debian 11+)
- 2 CPU cores
- 4GB RAM
- 20GB available disk space
- Podman 4.0+ or Docker 20.10+

### Recommended Requirements

- 4+ CPU cores
- 8GB+ RAM
- 50GB+ available disk space
- SSD storage for better performance

## Installation

### 1. Install Container Runtime

#### Podman (Recommended for Rootless)

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y podman

# RHEL/CentOS/Fedora
sudo dnf install -y podman

# Enable rootless support
systemctl --user enable --now podman.socket
```

#### Docker (Alternative)

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Add user to docker group (requires logout/login)
sudo usermod -aG docker $USER
```

### 2. Install Edge Agent

```bash
# Install globally via npm
npm install -g @sandstorm/edge-agent

# Or download pre-built binary
curl -L https://github.com/sandstorm/releases/latest/download/sandstorm-edge-linux-amd64 -o sandstorm-edge
chmod +x sandstorm-edge
sudo mv sandstorm-edge /usr/local/bin/
```

### 3. Verify Installation

```bash
# Check system requirements
sandstorm-edge check

# Expected output:
# ✓ podman is available: podman version 4.7.0
# ✓ Rootless socket found at /run/user/1000/podman/podman.sock
# ✓ System resources: 8 CPU cores, 16384 MB memory
# ✓ Network connectivity to Sandstorm Cloud
# System check complete!
```

## Configuration

### Basic Configuration

Create a configuration file:

```bash
sandstorm-edge init
```

This creates `sandstorm-edge.json`:

```json
{
  "agentName": "edge-production-01",
  "apiKey": "<your-sandstorm-api-key>",
  "cloudApiUrl": "https://api.sandstorm.dev",
  "runtime": "podman",
  "rootless": true,
  "port": 8080,
  "maxConcurrentSandboxes": 10,
  "maxMemoryMB": 8192,
  "maxCpuCores": 4,
  "enableNetworkIsolation": true,
  "vpcMode": false
}
```

### Advanced Configuration

```json
{
  "agentName": "edge-vpc-secure",
  "apiKey": "<your-api-key>",
  "cloudApiUrl": "https://api.sandstorm.dev",
  "runtime": "podman",
  "rootless": true,
  "listenPort": 8080,
  "listenHost": "0.0.0.0",
  "publicUrl": "https://edge.internal.company.com",
  
  // Resource limits
  "maxConcurrentSandboxes": 20,
  "maxMemoryMB": 16384,
  "maxCpuCores": 8,
  
  // Storage
  "workDir": "/opt/sandstorm-edge/data",
  "tempDir": "/opt/sandstorm-edge/tmp",
  
  // Telemetry
  "telemetryInterval": 30000,
  "metricsRetention": 86400,
  
  // Security
  "allowedImages": [
    "docker.io/python:*",
    "docker.io/node:*",
    "docker.io/golang:*"
  ],
  "blockedImages": [
    "*:latest"
  ],
  "enableNetworkIsolation": true,
  
  // VPC Configuration
  "vpcMode": true,
  "vpcCidr": "10.0.0.0/16",
  "dnsServers": ["10.0.0.2", "10.0.0.3"]
}
```

## Deployment Patterns

### 1. Standalone Edge Agent

Simple deployment for development or small-scale usage:

```bash
# Start with configuration file
sandstorm-edge start -c sandstorm-edge.json

# Or use environment variables
export SANDSTORM_API_KEY="your-api-key"
sandstorm-edge start --name my-edge-agent
```

### 2. Systemd Service (Recommended for Production)

Create `/etc/systemd/system/sandstorm-edge.service`:

```ini
[Unit]
Description=Sandstorm Edge Agent
After=network.target

[Service]
Type=simple
User=sandstorm
Group=sandstorm
WorkingDirectory=/opt/sandstorm-edge
ExecStart=/usr/local/bin/sandstorm-edge start -c /etc/sandstorm/edge.json
Restart=always
RestartSec=10

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/sandstorm-edge

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
# Create user
sudo useradd -r -s /bin/false sandstorm

# Create directories
sudo mkdir -p /opt/sandstorm-edge/{data,tmp}
sudo chown -R sandstorm:sandstorm /opt/sandstorm-edge

# Install service
sudo systemctl daemon-reload
sudo systemctl enable sandstorm-edge
sudo systemctl start sandstorm-edge

# Check status
sudo systemctl status sandstorm-edge
sudo journalctl -u sandstorm-edge -f
```

### 3. Kubernetes Deployment

Deploy as a DaemonSet for cluster-wide coverage:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: sandstorm-edge-config
  namespace: sandstorm
data:
  edge.json: |
    {
      "agentName": "edge-k8s-${NODE_NAME}",
      "apiKey": "${SANDSTORM_API_KEY}",
      "runtime": "podman",
      "rootless": false,
      "maxConcurrentSandboxes": 5,
      "enableNetworkIsolation": true
    }
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: sandstorm-edge
  namespace: sandstorm
spec:
  selector:
    matchLabels:
      app: sandstorm-edge
  template:
    metadata:
      labels:
        app: sandstorm-edge
    spec:
      containers:
      - name: edge-agent
        image: sandstorm/edge-agent:latest
        ports:
        - containerPort: 8080
        env:
        - name: NODE_NAME
          valueFrom:
            fieldRef:
              fieldPath: spec.nodeName
        - name: SANDSTORM_API_KEY
          valueFrom:
            secretKeyRef:
              name: sandstorm-secrets
              key: api-key
        volumeMounts:
        - name: config
          mountPath: /etc/sandstorm
        - name: podman-socket
          mountPath: /run/podman
        - name: data
          mountPath: /var/lib/sandstorm-edge
        securityContext:
          privileged: true
        resources:
          limits:
            cpu: "2"
            memory: "4Gi"
          requests:
            cpu: "1"
            memory: "2Gi"
      volumes:
      - name: config
        configMap:
          name: sandstorm-edge-config
      - name: podman-socket
        hostPath:
          path: /run/podman
      - name: data
        hostPath:
          path: /var/lib/sandstorm-edge
          type: DirectoryOrCreate
```

### 4. VPC-Isolated Deployment

For air-gapped environments with no internet access:

```bash
# Configure for VPC mode
cat > vpc-edge.json <<EOF
{
  "agentName": "edge-airgap-01",
  "apiKey": "offline-mode",
  "runtime": "podman",
  "rootless": true,
  "vpcMode": true,
  "enableNetworkIsolation": true,
  "allowedImages": [
    "registry.internal.company.com/*"
  ]
}
EOF

# Pre-pull required images
podman pull registry.internal.company.com/python:3.11-slim
podman pull registry.internal.company.com/node:20-slim

# Start in offline mode
sandstorm-edge start -c vpc-edge.json
```

## Security Considerations

### 1. Rootless Mode (Recommended)

Rootless containers provide better security isolation:

```bash
# Verify rootless setup
podman info | grep rootless

# Configure user namespaces
echo "user.max_user_namespaces=28633" | sudo tee /etc/sysctl.d/99-rootless.conf
sudo sysctl -p /etc/sysctl.d/99-rootless.conf
```

### 2. Network Isolation

Edge agents support complete network isolation for sandboxes:

```json
{
  "enableNetworkIsolation": true,
  "vpcMode": true,
  "vpcCidr": "10.0.0.0/16"
}
```

### 3. Image Allowlisting

Restrict which container images can be used:

```json
{
  "allowedImages": [
    "docker.io/python:3.11-*",
    "docker.io/node:20-*",
    "registry.company.com/*"
  ],
  "blockedImages": [
    "*:latest",
    "docker.io/alpine:*"
  ]
}
```

### 4. Resource Limits

Prevent resource exhaustion:

```json
{
  "maxConcurrentSandboxes": 10,
  "maxMemoryMB": 8192,
  "maxCpuCores": 4
}
```

### 5. SELinux/AppArmor

Enable additional security modules:

```bash
# SELinux (RHEL/Fedora)
sudo setsebool -P container_manage_cgroup on

# AppArmor (Ubuntu/Debian)
sudo aa-enforce /etc/apparmor.d/podman
```

## Monitoring and Maintenance

### Health Checks

```bash
# Check agent status
curl http://localhost:8080/health

# View detailed status
curl http://localhost:8080/status | jq
```

### Logs

```bash
# Systemd logs
sudo journalctl -u sandstorm-edge -f

# Container logs
podman logs -f sandstorm-edge
```

### Metrics

The edge agent exposes Prometheus-compatible metrics:

```bash
curl http://localhost:8080/metrics
```

### Updates

```bash
# Update via npm
npm update -g @sandstorm/edge-agent

# Or download new binary
curl -L https://github.com/sandstorm/releases/latest/download/sandstorm-edge-linux-amd64 -o sandstorm-edge
chmod +x sandstorm-edge
sudo systemctl stop sandstorm-edge
sudo mv sandstorm-edge /usr/local/bin/
sudo systemctl start sandstorm-edge
```

## SDK Integration

Use the Sandstorm SDK with edge mode:

```typescript
import { createSandstormEdge } from '@sandstorm/sdk';

// Connect to edge agents
const sandstorm = createSandstormEdge({
  // Optional: Cloud API for fallback
  apiKey: process.env.SANDSTORM_API_KEY,
  
  // Edge agent configuration
  edgeAgents: [
    {
      agentUrl: 'http://edge1.internal:8080',
      apiKey: 'edge-key-1'
    },
    {
      agentUrl: 'http://edge2.internal:8080',
      apiKey: 'edge-key-2'
    }
  ],
  
  // Prefer edge execution
  preferEdge: true,
  edgeFallbackToCloud: true
});

// Initialize edge connections
await sandstorm.connectEdgeAgents();

// Run code on edge
const result = await sandstorm.run({
  code: 'print("Hello from edge!")',
  language: 'python',
  constraints: {
    maxCost: 0, // Force edge execution
  }
});

// Check edge agents status
const statuses = await sandstorm.getEdgeAgentsStatus();
console.log('Edge agents:', statuses);
```

## Troubleshooting

### Common Issues

1. **Podman socket not found**
   ```bash
   systemctl --user start podman.socket
   loginctl enable-linger $USER
   ```

2. **Permission denied errors**
   ```bash
   # Check subuid/subgid
   grep $USER /etc/subuid /etc/subgid
   
   # Add if missing
   echo "$USER:100000:65536" | sudo tee -a /etc/subuid
   echo "$USER:100000:65536" | sudo tee -a /etc/subgid
   ```

3. **Network isolation not working**
   ```bash
   # Enable IP forwarding
   echo "net.ipv4.ip_forward=1" | sudo tee /etc/sysctl.d/99-forward.conf
   sudo sysctl -p /etc/sysctl.d/99-forward.conf
   ```

4. **High memory usage**
   ```bash
   # Limit container memory
   podman run --memory=512m --memory-swap=512m ...
   ```

### Debug Mode

Run with verbose logging:

```bash
LOG_LEVEL=debug sandstorm-edge start -c edge.json
```

## Best Practices

1. **Use rootless mode** whenever possible for better security
2. **Configure resource limits** to prevent resource exhaustion
3. **Enable network isolation** for untrusted code
4. **Monitor metrics** and set up alerts for failures
5. **Regular updates** to get security patches
6. **Use image allowlists** to control what can run
7. **Implement log aggregation** for multi-agent deployments
8. **Test failover** between edge and cloud regularly

## Support

- Documentation: https://docs.sandstorm.dev/edge
- GitHub Issues: https://github.com/sandstorm/sandstorm/issues
- Community Forum: https://forum.sandstorm.dev
- Enterprise Support: support@sandstorm.dev