import { BareMetalProvider, BareMetalConfig } from '../src';
import { SandboxSpec } from '@sandstorm/core';

// Example configuration for a bare-metal cluster
const config: BareMetalConfig = {
  nodes: [
    {
      id: 'node-001',
      ipAddress: '10.0.1.10',
      macAddress: '52:54:00:12:34:56',
      hostname: 'sandstorm-node-001',
      status: 'available',
      specs: {
        cpu: 32,
        memory: 65536, // 64GB
        disk: 2000, // 2TB
        gpu: true,
        gpuType: 'nvidia-a100',
      },
    },
    {
      id: 'node-002',
      ipAddress: '10.0.1.11',
      macAddress: '52:54:00:12:34:57',
      hostname: 'sandstorm-node-002',
      status: 'available',
      specs: {
        cpu: 16,
        memory: 32768, // 32GB
        disk: 1000, // 1TB
        gpu: false,
      },
    },
  ],
  bootcRegistry: 'registry.sandstorm.io',
  sshConfig: {
    username: 'sandstorm',
    privateKey: process.env.SSH_PRIVATE_KEY || '/home/sandstorm/.ssh/id_rsa',
    port: 22,
  },
  ipxeServerUrl: 'http://boot.sandstorm.io',
  snapshotStoragePath: '/mnt/sandstorm-snapshots',
};

async function main() {
  // Initialize the bare-metal provider
  const provider = new BareMetalProvider(config);

  // Check availability
  const isAvailable = await provider.isAvailable();
  console.log('Bare-metal provider available:', isAvailable);

  // Example 1: Run Python code with custom packages
  const pythonSpec: SandboxSpec = {
    code: `
import numpy as np
import matplotlib.pyplot as plt

# Generate some data
x = np.linspace(0, 10, 100)
y = np.sin(x)

# Create a plot
plt.figure(figsize=(10, 6))
plt.plot(x, y)
plt.title('Sine Wave')
plt.xlabel('X')
plt.ylabel('Y')
plt.savefig('sine_wave.png')
print("Plot saved as sine_wave.png")
`,
    language: 'python',
    dockerfile: `
FROM quay.io/fedora/fedora-bootc:40
RUN dnf install -y python3 python3-pip
RUN pip3 install numpy matplotlib
`,
    cpu: 4,
    memory: 8192,
    stateful: true,
  };

  console.log('Running Python example...');
  const pythonResult = await provider.run(pythonSpec);
  console.log('Python output:', pythonResult.stdout);
  console.log('Generated files:', Object.keys(pythonResult.files || {}));

  // Example 2: Run GPU workload
  const gpuSpec: SandboxSpec = {
    code: `
import torch
import torch.nn as nn

# Check GPU availability
if torch.cuda.is_available():
    device = torch.cuda.get_device_name(0)
    print(f"GPU available: {device}")
    
    # Simple GPU computation
    x = torch.randn(1000, 1000).cuda()
    y = torch.randn(1000, 1000).cuda()
    z = torch.matmul(x, y)
    print(f"Matrix multiplication result shape: {z.shape}")
    print(f"GPU memory allocated: {torch.cuda.memory_allocated() / 1024**2:.2f} MB")
else:
    print("No GPU available")
`,
    language: 'python',
    dockerfile: `
FROM quay.io/fedora/fedora-bootc:40
RUN dnf install -y python3 python3-pip
RUN pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
`,
    gpu: true,
    gpuType: 'nvidia-a100',
    memory: 16384,
  };

  console.log('\nRunning GPU example...');
  const gpuResult = await provider.run(gpuSpec);
  console.log('GPU output:', gpuResult.stdout);

  // Example 3: Create and restore snapshot
  console.log('\nCreating snapshot...');
  const snapshot = await provider.snapshot(pythonResult.id);
  console.log('Snapshot created:', snapshot.id);

  console.log('Restoring from snapshot...');
  const restoredId = await provider.restore(snapshot.id);
  console.log('Restored sandbox:', restoredId);

  // Check quota
  const quota = await provider.getQuota();
  console.log('\nQuota:', quota);
}

// Run the example
main().catch(console.error);