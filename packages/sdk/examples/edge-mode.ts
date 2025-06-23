import { createSandstormEdge } from '@sandstorm/sdk';

async function main() {
  // Example 1: Single edge agent
  const singleEdge = createSandstormEdge({
    edgeAgents: [{
      agentUrl: 'http://localhost:8080',
    }],
    preferEdge: true,
  });

  await singleEdge.connectEdgeAgents();

  const result1 = await singleEdge.run({
    code: 'print("Hello from local edge!")',
    language: 'python',
  });
  console.log('Single edge result:', result1);

  // Example 2: Multiple edge agents with cloud fallback
  const multiEdge = createSandstormEdge({
    apiKey: process.env.SANDSTORM_API_KEY,
    edgeAgents: [
      { agentUrl: 'http://edge1.local:8080' },
      { agentUrl: 'http://edge2.local:8080' },
      { agentUrl: 'http://edge3.local:8080' },
    ],
    preferEdge: true,
    edgeFallbackToCloud: true,
  });

  await multiEdge.connectEdgeAgents();

  // Run on edge with automatic load balancing
  const result2 = await multiEdge.run({
    code: `
import numpy as np
import time

# Simulate some computation
start = time.time()
matrix = np.random.rand(1000, 1000)
result = np.linalg.eigvals(matrix)
elapsed = time.time() - start

print(f"Computed {len(result)} eigenvalues in {elapsed:.2f} seconds")
    `,
    language: 'python',
    requirements: ['numpy'],
    constraints: {
      memory: 1024,
      cpu: 2,
    },
  });
  console.log('Multi-edge result:', result2);

  // Example 3: Check edge agent status
  const statuses = await multiEdge.getEdgeAgentsStatus();
  console.log('Edge agent statuses:');
  statuses.forEach(status => {
    console.log(`- ${status.agentId}: ${status.status}`);
    console.log(`  Resources: ${status.resources.usedMemoryMB}/${status.resources.totalMemoryMB} MB`);
    console.log(`  Sandboxes: ${status.sandboxes.running} running, ${status.sandboxes.completed} completed`);
  });

  // Example 4: VPC-isolated edge agent
  const vpcEdge = createSandstormEdge({
    edgeAgents: [{
      agentUrl: 'http://10.0.1.100:8080',
      apiKey: 'vpc-internal-key',
    }],
    preferEdge: true,
    edgeFallbackToCloud: false, // No fallback in VPC mode
  });

  const vpcResult = await vpcEdge.run({
    code: `
# This runs in complete network isolation
import os
import socket

hostname = socket.gethostname()
pid = os.getpid()

print(f"Running on {hostname} with PID {pid}")
print("Network isolated - no internet access")
    `,
    language: 'python',
  });
  console.log('VPC edge result:', vpcResult);
}

// Run examples
main().catch(console.error);