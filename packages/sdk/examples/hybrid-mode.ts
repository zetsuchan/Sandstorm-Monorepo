import { createSandstormEdge } from '@sandstorm/sdk';

/**
 * Hybrid Cloud + Edge Example
 * 
 * This example shows how to set up Sandstorm to intelligently route
 * between cloud providers and local edge agents based on constraints.
 */

async function main() {
  const sandstorm = createSandstormEdge({
    // Cloud API for cloud providers
    apiKey: process.env.SANDSTORM_API_KEY,
    
    // Local edge agents
    edgeAgents: [
      {
        agentUrl: 'http://edge1.local:8080',
        apiKey: 'edge-key-1',
      },
      {
        agentUrl: 'http://edge2.local:8080', 
        apiKey: 'edge-key-2',
      },
    ],
    
    // Prefer edge for cost savings, but allow cloud fallback
    preferEdge: true,
    edgeFallbackToCloud: true,
  });

  // Connect to edge agents
  await sandstorm.connectEdgeAgents();

  console.log('🔄 Hybrid Cloud + Edge Setup Complete\n');

  // Example 1: Force edge execution (zero cost)
  console.log('1️⃣ Running on edge (zero cost)...');
  const edgeResult = await sandstorm.run({
    code: 'print("Running on local edge - zero cost!")',
    language: 'python',
    constraints: {
      maxCost: 0, // Force edge execution
    },
  });
  console.log('✅ Edge result:', edgeResult.stdout.trim());
  console.log(`   Cost: $${edgeResult.cost}, Duration: ${edgeResult.duration}ms\n`);

  // Example 2: Allow cloud if edge is busy
  console.log('2️⃣ Smart routing (edge preferred, cloud fallback)...');
  const smartResult = await sandstorm.run({
    code: `
import time
print("Starting computation...")
time.sleep(2)  # Simulate work
print("Computation complete!")
    `,
    language: 'python',
    constraints: {
      maxLatency: 5000, // If edge is busy, use cloud
      maxCost: 0.05,    // Allow up to 5 cents
    },
  });
  console.log('✅ Smart result:', smartResult.stdout.replace(/\n/g, ' '));
  console.log(`   Cost: $${smartResult.cost}, Duration: ${smartResult.duration}ms\n`);

  // Example 3: GPU workload - automatically routes to cloud
  console.log('3️⃣ GPU workload (automatically routes to cloud)...');
  try {
    const gpuResult = await sandstorm.run({
      code: `
# This would require GPU resources
print("GPU computation would happen here")
print("Edge agents typically don't have GPUs")
      `,
      language: 'python',
      constraints: {
        requireGpu: true,
        maxCost: 0.50,
      },
    });
    console.log('✅ GPU result:', gpuResult.stdout.replace(/\n/g, ' '));
    console.log(`   Cost: $${gpuResult.cost}, Duration: ${gpuResult.duration}ms\n`);
  } catch (error) {
    console.log('⚠️  GPU workload failed (no cloud API key?)', error.message);
  }

  // Example 4: Large memory workload with intelligent routing
  console.log('4️⃣ Large memory workload...');
  const memoryResult = await sandstorm.run({
    code: `
import sys
import psutil

memory_mb = psutil.Process().memory_info().rss / 1024 / 1024
print(f"Using {memory_mb:.1f} MB of memory")
print(f"Python version: {sys.version.split()[0]}")
    `,
    language: 'python',
    requirements: ['psutil'],
    constraints: {
      memory: 2048, // 2GB memory requirement
      maxCost: 0.10,
    },
  });
  console.log('✅ Memory result:', memoryResult.stdout.replace(/\n/g, ' '));
  console.log(`   Cost: $${memoryResult.cost}, Duration: ${memoryResult.duration}ms\n`);

  // Example 5: Check system status
  console.log('5️⃣ System status...');
  const edgeStatuses = await sandstorm.getEdgeAgentsStatus();
  console.log(`Edge agents: ${edgeStatuses.length} connected`);
  
  edgeStatuses.forEach((status, i) => {
    const memPercent = (status.resources.usedMemoryMB / status.resources.totalMemoryMB * 100).toFixed(1);
    console.log(`  Agent ${i + 1}: ${status.status}, CPU: ${status.resources.cpuUsagePercent}%, Memory: ${memPercent}%`);
    console.log(`           Sandboxes: ${status.sandboxes.running} running, ${status.sandboxes.completed} completed`);
  });

  console.log('\n🎉 Hybrid deployment demo complete!');
  console.log('💡 Tip: Edge agents provide zero-cost execution for development and testing.');
}

main().catch(console.error);