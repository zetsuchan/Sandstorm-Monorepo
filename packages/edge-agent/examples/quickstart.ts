#!/usr/bin/env node

/**
 * Quick Start Example for Sandstorm Edge Agent
 * 
 * This example demonstrates:
 * 1. Starting a local edge agent
 * 2. Connecting to it with the SDK
 * 3. Running sandboxes locally
 */

import { createEdgeAgent } from '@sandstorm/edge-agent';
import { createSandstormEdge } from '@sandstorm/sdk';

async function main() {
  console.log('🚀 Starting Sandstorm Edge Agent Example\n');

  // Step 1: Start the edge agent
  console.log('1️⃣ Starting local edge agent...');
  const agent = await createEdgeAgent({
    agentName: 'quickstart-agent',
    port: 8080,
    runtime: 'podman',
    rootless: true,
    maxConcurrentSandboxes: 5,
  });

  await agent.start();
  console.log('✅ Edge agent started on http://localhost:8080\n');

  // Step 2: Connect with SDK
  console.log('2️⃣ Connecting SDK to edge agent...');
  const sandstorm = createSandstormEdge({
    edgeAgents: [{
      agentUrl: 'http://localhost:8080',
    }],
    preferEdge: true,
  });

  await sandstorm.connectEdgeAgents();
  console.log('✅ SDK connected to edge agent\n');

  // Step 3: Run some examples
  console.log('3️⃣ Running example sandboxes...\n');

  // Example 1: Simple Python
  console.log('Running Python example...');
  const pythonResult = await sandstorm.run({
    code: `
import sys
import platform

print(f"Python {sys.version}")
print(f"Platform: {platform.platform()}")
print(f"Running in Sandstorm Edge!")
`,
    language: 'python',
  });
  console.log('Output:', pythonResult.stdout);
  console.log(`Execution time: ${pythonResult.duration}ms\n`);

  // Example 2: JavaScript with file output
  console.log('Running JavaScript example...');
  const jsResult = await sandstorm.run({
    code: `
const fs = require('fs');

console.log('Node.js version:', process.version);
console.log('Creating output file...');

fs.writeFileSync('output.json', JSON.stringify({
  timestamp: new Date().toISOString(),
  message: 'Hello from Edge Agent!',
  env: process.env.NODE_ENV || 'sandbox'
}, null, 2));

console.log('File created successfully!');
`,
    language: 'javascript',
  });
  console.log('Output:', jsResult.stdout);
  if (jsResult.files?.['output.json']) {
    console.log('Generated file:', jsResult.files['output.json']);
  }
  console.log(`Execution time: ${jsResult.duration}ms\n`);

  // Example 3: Resource-constrained execution
  console.log('Running resource-constrained example...');
  const constrainedResult = await sandstorm.run({
    code: `
import time
import psutil

# This will run with limited resources
start = time.time()
total = sum(range(10_000_000))
elapsed = time.time() - start

print(f"Sum calculation took {elapsed:.2f} seconds")
print(f"Process memory: {psutil.Process().memory_info().rss / 1024 / 1024:.1f} MB")
`,
    language: 'python',
    requirements: ['psutil'],
    constraints: {
      memory: 256, // Limit to 256MB
      cpu: 0.5,    // Limit to 0.5 CPU cores
      timeout: 5000, // 5 second timeout
    },
  });
  console.log('Output:', constrainedResult.stdout);
  console.log(`Execution time: ${constrainedResult.duration}ms\n`);

  // Step 4: Check agent status
  console.log('4️⃣ Checking agent status...');
  const status = await sandstorm.getEdgeAgentsStatus();
  console.log('Agent status:', JSON.stringify(status[0], null, 2));

  // Cleanup
  console.log('\n✅ Example completed successfully!');
  console.log('Press Ctrl+C to stop the edge agent.');
}

// Run the example
main().catch(console.error);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  process.exit(0);
});