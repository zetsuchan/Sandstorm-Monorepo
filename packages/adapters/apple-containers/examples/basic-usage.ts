import { Sandstorm } from '@sandstorm/sdk';
import { AppleContainersProvider } from '@sandstorm/adapters-apple-containers';

async function main() {
  // Initialize Apple Containers provider
  const appleContainers = new AppleContainersProvider({
    defaultTimeout: 30000,
    maxMemoryGB: 4,
    maxCpuCores: 4,
    enableRosetta: true,
  });

  // Create Sandstorm client with Apple Containers
  const sandstorm = new Sandstorm({
    providers: [appleContainers],
  });

  console.log('🍎 Apple Containers Example - VM-Isolated Container Execution\n');

  // Example 1: Basic Python execution
  console.log('1. Running Python code in VM-isolated container:');
  const pythonResult = await sandstorm.run({
    code: `
import sys
import platform

print(f"Python {sys.version}")
print(f"Platform: {platform.platform()}")
print(f"Architecture: {platform.machine()}")
print("Hello from Apple Containers! 🚀")
    `,
    language: 'python',
    provider: 'apple-containers',
  });
  console.log(pythonResult.stdout);
  console.log(`✅ Completed in ${pythonResult.duration}ms\n`);

  // Example 2: Multi-language support
  console.log('2. Running JavaScript with dependencies:');
  const jsResult = await sandstorm.run({
    code: `
const crypto = require('crypto');
const os = require('os');

console.log('System info from isolated VM:');
console.log('- Hostname:', os.hostname());
console.log('- Platform:', os.platform());
console.log('- CPUs:', os.cpus().length);
console.log('- Total Memory:', (os.totalmem() / 1024 / 1024).toFixed(2), 'MB');
console.log('- Random UUID:', crypto.randomUUID());
    `,
    language: 'javascript',
    provider: 'apple-containers',
  });
  console.log(jsResult.stdout);

  // Example 3: Custom container image
  console.log('\n3. Using custom container image:');
  const customResult = await sandstorm.run({
    code: 'echo "Running in custom Alpine container"',
    language: 'shell',
    containerImage: 'alpine:latest',
    provider: 'apple-containers',
  });
  console.log(customResult.stdout);

  // Example 4: Resource constraints
  console.log('\n4. Running with resource constraints:');
  const constrainedResult = await sandstorm.run({
    code: `
import multiprocessing
import psutil

print(f"CPU cores available: {multiprocessing.cpu_count()}")
print(f"Memory available: {psutil.virtual_memory().available / (1024**3):.2f} GB")
print("Resource constraints are enforced at VM level!")
    `,
    language: 'python',
    requirements: ['psutil'],
    cpu: 2,
    memory: 1024, // 1GB
    provider: 'apple-containers',
  });
  console.log(constrainedResult.stdout);

  // Example 5: x86_64 container on Apple Silicon with Rosetta
  console.log('\n5. Running x86_64 container with Rosetta 2:');
  const x86Result = await sandstorm.run({
    code: `
import platform
print(f"Architecture: {platform.machine()}")
print("Rosetta 2 enables x86_64 containers on Apple Silicon!")
    `,
    language: 'python',
    architecture: 'amd64', // Request x86_64 container
    provider: 'apple-containers',
  });
  console.log(x86Result.stdout);

  // Example 6: Streaming output
  console.log('\n6. Streaming long-running task:');
  await sandstorm.run({
    code: `
import time
for i in range(5):
    print(f"Progress: {i+1}/5")
    time.sleep(1)
print("Task completed!")
    `,
    language: 'python',
    provider: 'apple-containers',
    streaming: true,
  }, {
    onStdout: (data) => process.stdout.write(`  [STREAM] ${data}`),
  });

  console.log('\n✨ All examples completed successfully!');
  console.log('🔒 Each container ran in its own lightweight VM for maximum isolation.');
}

// Run the examples
main().catch(console.error);