import { DaytonaProvider } from '../src';

async function main() {
  // Initialize the Daytona provider
  const provider = new DaytonaProvider({
    apiKey: process.env.DAYTONA_API_KEY || '',
    apiUrl: process.env.DAYTONA_API_URL || 'https://api.daytona.io',
    defaultTimeout: 60000,
  });

  // Check if Daytona is available
  const isAvailable = await provider.isAvailable();
  console.log('Daytona Available:', isAvailable);

  if (!isAvailable) {
    console.error('Daytona is not available. Please check your API key and URL.');
    return;
  }

  // Example 1: Simple Python execution with ultra-fast startup
  console.log('\n--- Example 1: Simple Python Execution (90ms startup) ---');
  const pythonStartTime = Date.now();
  const pythonResult = await provider.run({
    code: `
import sys
import platform
import time

start_time = time.time()
print(f"Python version: {sys.version}")
print(f"Platform: {platform.platform()}")
print(f"Startup time: {time.time() - start_time:.3f}s")

# Quick calculation to demonstrate fast execution
result = sum(i**2 for i in range(1000))
print(f"Sum of squares (0-999): {result}")
`,
    language: 'python',
    timeout: 10000,
  });

  console.log('Output:', pythonResult.stdout);
  console.log('Total time including startup:', Date.now() - pythonStartTime, 'ms');
  console.log('Cost: $', pythonResult.cost.toFixed(4));

  // Example 2: JavaScript with workspace persistence
  console.log('\n--- Example 2: Persistent Workspace with Node.js ---');
  
  // Create a persistent workspace
  const workspaceId = await provider.createWorkspace({
    name: 'my-js-workspace',
    template: 'javascript',
    persistent: true,
  });
  console.log('Created workspace:', workspaceId);

  // First execution: Install a package
  const installResult = await provider.runInWorkspace(workspaceId, {
    code: `
const { execSync } = require('child_process');
console.log('Installing lodash...');
execSync('npm install lodash', { stdio: 'inherit' });
console.log('Installation complete!');
`,
    language: 'javascript',
    timeout: 60000,
  });
  console.log('Install output:', installResult.stdout);

  // Second execution: Use the installed package
  const useResult = await provider.runInWorkspace(workspaceId, {
    code: `
const _ = require('lodash');
console.log('Using lodash from persistent workspace:');
console.log('Random number:', _.random(1, 100));
console.log('Shuffled array:', _.shuffle([1, 2, 3, 4, 5]));
`,
    language: 'javascript',
    timeout: 10000,
  });
  console.log('Usage output:', useResult.stdout);

  // Get workspace metrics
  const metrics = await provider.getWorkspaceMetrics(workspaceId);
  console.log('Workspace metrics:', metrics);

  // Example 3: Go with fast compilation
  console.log('\n--- Example 3: Go Execution ---');
  const goResult = await provider.run({
    code: `
package main

import (
    "fmt"
    "runtime"
    "time"
)

func fibonacci(n int) int {
    if n <= 1 {
        return n
    }
    return fibonacci(n-1) + fibonacci(n-2)
}

func main() {
    fmt.Printf("Go version: %s\\n", runtime.Version())
    fmt.Printf("GOOS: %s, GOARCH: %s\\n", runtime.GOOS, runtime.GOARCH)
    
    // Benchmark fibonacci
    start := time.Now()
    result := fibonacci(30)
    duration := time.Since(start)
    
    fmt.Printf("fibonacci(30) = %d\\n", result)
    fmt.Printf("Calculation took: %v\\n", duration)
}
`,
    language: 'go',
    cpu: 2,
    timeout: 30000,
  });

  console.log('Go Output:', goResult.stdout);
  console.log('Execution time:', goResult.duration, 'ms');

  // Example 4: Multi-language in same workspace
  console.log('\n--- Example 4: Multi-language Execution ---');
  
  const multiWorkspaceId = await provider.createWorkspace({
    name: 'multi-language-workspace',
    template: 'default',
    persistent: true,
  });

  // Python execution
  const pyInMulti = await provider.runInWorkspace(multiWorkspaceId, {
    code: 'with open("data.txt", "w") as f: f.write("Hello from Python\\n")',
    language: 'python',
    timeout: 10000,
  });

  // Shell execution to verify file
  const shellInMulti = await provider.runInWorkspace(multiWorkspaceId, {
    code: 'cat data.txt && echo "Read by shell script"',
    language: 'shell',
    timeout: 10000,
  });

  console.log('Multi-language output:', shellInMulti.stdout);

  // Example 5: Workspace snapshot
  console.log('\n--- Example 5: Workspace Snapshots ---');
  
  // Create a snapshot of the workspace
  const snapshot = await provider.snapshot(multiWorkspaceId);
  console.log('Created snapshot:', snapshot.id);
  console.log('Snapshot size:', snapshot.size, 'MB');

  // Example 6: Error handling
  console.log('\n--- Example 6: Error Handling ---');
  try {
    const errorResult = await provider.run({
      code: `
import sys
print("About to raise an error...")
raise RuntimeError("This is a test error!")
`,
      language: 'python',
      timeout: 10000,
    });
    
    console.log('Error output:', errorResult.stderr);
    console.log('Exit code:', errorResult.exitCode);
  } catch (error) {
    console.error('Caught error:', error);
  }

  // Example 7: Performance test with ultra-fast startup
  console.log('\n--- Example 7: Performance Test (10 quick executions) ---');
  const perfResults = [];
  
  for (let i = 0; i < 10; i++) {
    const start = Date.now();
    const result = await provider.run({
      code: `print("Execution ${i + 1}")`,
      language: 'python',
      timeout: 5000,
    });
    const duration = Date.now() - start;
    perfResults.push(duration);
  }
  
  const avgTime = perfResults.reduce((a, b) => a + b, 0) / perfResults.length;
  console.log('Execution times:', perfResults.map(t => `${t}ms`).join(', '));
  console.log('Average execution time:', avgTime.toFixed(2), 'ms');
  console.log('Min time:', Math.min(...perfResults), 'ms');
  console.log('Max time:', Math.max(...perfResults), 'ms');

  // Cost estimation examples
  console.log('\n--- Cost Estimation Examples ---');
  
  const estimates = [
    { spec: { code: 'print("test")', language: 'python' as const, timeout: 60000 }, label: 'Basic 1 minute' },
    { spec: { code: 'print("test")', language: 'python' as const, cpu: 4, memory: 4096, timeout: 300000 }, label: 'High-spec 5 minutes' },
    { spec: { code: 'print("test")', language: 'python' as const, gpu: true, timeout: 180000 }, label: 'GPU 3 minutes' },
    { spec: { code: 'print("test")', language: 'python' as const, stateful: true, timeout: 3600000 }, label: 'Persistent 1 hour' },
  ];

  for (const { spec, label } of estimates) {
    const cost = await provider.estimateCost(spec);
    const latency = await provider.estimateLatency(spec);
    console.log(`${label}: $${cost.toFixed(4)}, startup: ${latency}ms`);
  }

  // Cleanup
  await provider.cleanup();
}

// Run the examples
main().catch(console.error);