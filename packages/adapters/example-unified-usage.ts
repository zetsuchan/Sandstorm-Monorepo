import { ISandboxProvider, SandboxSpec, SandboxConstraints } from '@sandstorm/core';
import { E2BProvider } from '@sandstorm/adapters-e2b';
import { ModalProvider } from '@sandstorm/adapters-modal';
import { DaytonaProvider } from '@sandstorm/adapters-daytona';

/**
 * Example demonstrating the unified API layer for all sandbox providers
 */
async function main() {
  // Initialize all providers
  const providers: ISandboxProvider[] = [
    new E2BProvider({
      apiKey: process.env.E2B_API_KEY || '',
      defaultTimeout: 60000,
    }),
    new ModalProvider({
      apiKey: process.env.MODAL_API_KEY || '',
      workspace: process.env.MODAL_WORKSPACE || 'sandstorm-test',
      defaultTimeout: 60000,
    }),
    new DaytonaProvider({
      apiKey: process.env.DAYTONA_API_KEY || '',
      apiUrl: process.env.DAYTONA_API_URL || 'https://api.daytona.io',
      defaultTimeout: 60000,
    }),
  ];

  // Check which providers are available
  console.log('Checking provider availability...');
  for (const provider of providers) {
    const available = await provider.isAvailable();
    console.log(`${provider.name}: ${available ? 'Available' : 'Not available'}`);
  }

  // Filter to only available providers
  const availableProviders: ISandboxProvider[] = [];
  for (const provider of providers) {
    if (await provider.isAvailable()) {
      availableProviders.push(provider);
    }
  }

  if (availableProviders.length === 0) {
    console.error('No providers available. Please check your API keys.');
    return;
  }

  // Example 1: Simple execution across all providers
  console.log('\n--- Example 1: Execute Same Code Across All Providers ---');
  const simpleSpec: SandboxSpec = {
    code: `
import sys
import platform
print(f"Provider: {platform.node()}")
print(f"Python: {sys.version.split()[0]}")
print(f"Platform: {platform.platform()}")

# Quick benchmark
import time
start = time.time()
sum([i**2 for i in range(1000000)])
end = time.time()
print(f"Computation time: {(end-start)*1000:.2f}ms")
`,
    language: 'python',
    timeout: 30000,
  };

  for (const provider of availableProviders) {
    console.log(`\nExecuting on ${provider.name}:`);
    const startTime = Date.now();
    try {
      const result = await provider.run(simpleSpec);
      console.log('Output:', result.stdout);
      console.log(`Total time: ${result.duration}ms, Cost: $${result.cost.toFixed(6)}`);
    } catch (error) {
      console.error(`Error on ${provider.name}:`, error);
    }
  }

  // Example 2: Cost optimization - find cheapest provider
  console.log('\n--- Example 2: Cost-Optimized Provider Selection ---');
  const costSpec: SandboxSpec = {
    code: 'print("Cost optimization test")',
    language: 'python',
    cpu: 2,
    memory: 2048,
    timeout: 60000,
  };

  let cheapestProvider: ISandboxProvider | null = null;
  let lowestCost = Infinity;

  for (const provider of availableProviders) {
    const estimatedCost = await provider.estimateCost(costSpec);
    console.log(`${provider.name} estimated cost: $${estimatedCost.toFixed(6)}`);
    if (estimatedCost < lowestCost) {
      lowestCost = estimatedCost;
      cheapestProvider = provider;
    }
  }

  if (cheapestProvider) {
    console.log(`\nCheapest provider: ${cheapestProvider.name}`);
    const result = await cheapestProvider.run(costSpec);
    console.log(`Actual cost: $${result.cost.toFixed(6)}`);
  }

  // Example 3: Latency optimization - find fastest provider
  console.log('\n--- Example 3: Latency-Optimized Provider Selection ---');
  const latencySpec: SandboxSpec = {
    code: 'print("Latency optimization test")',
    language: 'python',
    timeout: 10000,
  };

  let fastestProvider: ISandboxProvider | null = null;
  let lowestLatency = Infinity;

  for (const provider of availableProviders) {
    const estimatedLatency = await provider.estimateLatency(latencySpec);
    console.log(`${provider.name} estimated latency: ${estimatedLatency}ms`);
    if (estimatedLatency < lowestLatency) {
      lowestLatency = estimatedLatency;
      fastestProvider = provider;
    }
  }

  if (fastestProvider) {
    console.log(`\nFastest provider: ${fastestProvider.name}`);
    const startTime = Date.now();
    const result = await fastestProvider.run(latencySpec);
    console.log(`Actual latency: ${Date.now() - startTime}ms`);
  }

  // Example 4: Provider-specific features through unified API
  console.log('\n--- Example 4: Provider-Specific Features ---');

  // E2B-specific: Jupyter notebook style execution
  const e2bProvider = availableProviders.find(p => p.name === 'e2b');
  if (e2bProvider) {
    console.log('\nE2B - Data visualization:');
    const vizSpec: SandboxSpec = {
      code: `
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 2*np.pi, 100)
y = np.sin(x)

plt.figure(figsize=(8, 4))
plt.plot(x, y)
plt.title('Sine Wave')
plt.savefig('sine.png')
print("Plot saved as sine.png")
`,
      language: 'python',
      timeout: 30000,
      streaming: true, // E2B supports streaming
    };
    
    const result = await e2bProvider.run(vizSpec);
    console.log('Output:', result.stdout);
  }

  // Modal-specific: Custom container image
  const modalProvider = availableProviders.find(p => p.name === 'modal');
  if (modalProvider) {
    console.log('\nModal - Custom container:');
    const containerSpec: SandboxSpec = {
      code: 'node -e "console.log(`Node.js ${process.version} in custom container`)"',
      language: 'javascript',
      containerImage: 'node:20-alpine', // Modal-specific feature
      timeout: 30000,
    };
    
    const result = await modalProvider.run(containerSpec);
    console.log('Output:', result.stdout);
  }

  // Daytona-specific: Persistent workspace
  const daytonaProvider = availableProviders.find(p => p.name === 'daytona');
  if (daytonaProvider) {
    console.log('\nDaytona - Persistent workspace:');
    const workspaceSpec: SandboxSpec = {
      code: 'echo "Data" > persistent.txt && cat persistent.txt',
      language: 'shell',
      stateful: true, // Daytona supports persistent workspaces
      workspaceTemplate: 'default', // Daytona-specific feature
      timeout: 30000,
    };
    
    const result = await daytonaProvider.run(workspaceSpec);
    console.log('Output:', result.stdout);
  }

  // Example 5: Constraint-based provider selection
  console.log('\n--- Example 5: Constraint-Based Selection ---');
  
  async function selectProvider(
    spec: SandboxSpec,
    constraints: SandboxConstraints,
    providers: ISandboxProvider[]
  ): Promise<ISandboxProvider | null> {
    let bestProvider: ISandboxProvider | null = null;
    let bestScore = -Infinity;

    for (const provider of providers) {
      // Skip excluded providers
      if (constraints.excludeProviders?.includes(provider.name)) {
        continue;
      }

      // Check if provider meets constraints
      const cost = await provider.estimateCost(spec);
      const latency = await provider.estimateLatency(spec);

      if (constraints.maxCost && cost > constraints.maxCost) {
        continue;
      }
      if (constraints.maxLatency && latency > constraints.maxLatency) {
        continue;
      }

      // Calculate score (lower cost and latency is better)
      let score = 1000 - cost * 100 - latency * 0.01;

      // Boost score for preferred providers
      if (constraints.preferredProviders?.includes(provider.name)) {
        score *= 1.5;
      }

      if (score > bestScore) {
        bestScore = score;
        bestProvider = provider;
      }
    }

    return bestProvider;
  }

  const constrainedSpec: SandboxSpec = {
    code: 'print("Constraint-based selection")',
    language: 'python',
    cpu: 1,
    memory: 512,
    timeout: 30000,
  };

  const constraints: SandboxConstraints = {
    maxCost: 0.01, // Max $0.01
    maxLatency: 1000, // Max 1 second startup
    preferredProviders: ['daytona', 'e2b'],
  };

  const selectedProvider = await selectProvider(constrainedSpec, constraints, availableProviders);
  if (selectedProvider) {
    console.log(`Selected provider: ${selectedProvider.name}`);
    const result = await selectedProvider.run(constrainedSpec);
    console.log(`Result: ${result.stdout.trim()}`);
    console.log(`Cost: $${result.cost.toFixed(6)}, Duration: ${result.duration}ms`);
  } else {
    console.log('No provider meets the constraints');
  }

  // Example 6: Parallel execution across providers
  console.log('\n--- Example 6: Parallel Execution ---');
  const parallelSpec: SandboxSpec = {
    code: `
import time
import random

start = time.time()
# Simulate some work
time.sleep(random.uniform(0.1, 0.5))
duration = time.time() - start

print(f"Execution completed in {duration:.3f}s")
`,
    language: 'python',
    timeout: 30000,
  };

  console.log('Running in parallel across all providers...');
  const parallelResults = await Promise.allSettled(
    availableProviders.map(async provider => {
      const startTime = Date.now();
      const result = await provider.run(parallelSpec);
      return {
        provider: provider.name,
        output: result.stdout.trim(),
        duration: Date.now() - startTime,
        cost: result.cost,
      };
    })
  );

  parallelResults.forEach(result => {
    if (result.status === 'fulfilled') {
      const { provider, output, duration, cost } = result.value;
      console.log(`${provider}: ${output}, Total time: ${duration}ms, Cost: $${cost.toFixed(6)}`);
    } else {
      console.error('Execution failed:', result.reason);
    }
  });

  // Cleanup all providers
  console.log('\nCleaning up...');
  for (const provider of availableProviders) {
    if (provider.cleanup) {
      await provider.cleanup();
    }
  }
}

// Run the unified example
main().catch(console.error);