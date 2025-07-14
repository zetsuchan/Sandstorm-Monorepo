import { ModalProvider } from '../src';

async function main() {
  // Initialize the Modal provider
  const provider = new ModalProvider({
    apiKey: process.env.MODAL_API_KEY || '',
    workspace: process.env.MODAL_WORKSPACE || 'sandstorm-test',
    defaultTimeout: 60000,
  });

  // Check if Modal is available
  const isAvailable = await provider.isAvailable();
  console.log('Modal Available:', isAvailable);

  if (!isAvailable) {
    console.error('Modal is not available. Please check your API key and workspace.');
    return;
  }

  // Example 1: Simple Python execution
  console.log('\n--- Example 1: Simple Python Execution ---');
  const pythonResult = await provider.run({
    code: `
import platform
import sys

print(f"Python version: {sys.version}")
print(f"Platform: {platform.platform()}")
print(f"Processor: {platform.processor()}")

# Calculate prime numbers
def is_prime(n):
    if n < 2:
        return False
    for i in range(2, int(n**0.5) + 1):
        if n % i == 0:
            return False
    return True

primes = [n for n in range(100) if is_prime(n)]
print(f"Primes under 100: {primes}")
`,
    language: 'python',
    cpu: 1,
    memory: 512,
    timeout: 30000,
  });

  console.log('Output:', pythonResult.stdout);
  console.log('Exit Code:', pythonResult.exitCode);
  console.log('Duration:', pythonResult.duration, 'ms');
  console.log('Cost: $', pythonResult.cost.toFixed(8));

  // Example 2: Node.js with custom image
  console.log('\n--- Example 2: Node.js Execution ---');
  const nodeResult = await provider.run({
    code: `
console.log('Node.js version:', process.version);
console.log('V8 version:', process.versions.v8);

// Fibonacci sequence generator
function* fibonacci() {
  let [a, b] = [0, 1];
  while (true) {
    yield a;
    [a, b] = [b, a + b];
  }
}

const fib = fibonacci();
const first10 = [];
for (let i = 0; i < 10; i++) {
  first10.push(fib.next().value);
}
console.log('First 10 Fibonacci numbers:', first10);

// Async example
async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  console.log('Starting async operation...');
  await delay(1000);
  console.log('Async operation completed!');
})();
`,
    language: 'javascript',
    cpu: 1,
    memory: 256,
    timeout: 30000,
  });

  console.log('Node.js Output:', nodeResult.stdout);

  // Example 3: Go execution
  console.log('\n--- Example 3: Go Execution ---');
  const goResult = await provider.run({
    code: `
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    fmt.Printf("Go version: %s\\n", runtime.Version())
    fmt.Printf("OS: %s\\n", runtime.GOOS)
    fmt.Printf("Arch: %s\\n", runtime.GOARCH)
    fmt.Printf("NumCPU: %d\\n", runtime.NumCPU())
    
    // Concurrent goroutines example
    ch := make(chan string)
    
    go func() {
        time.Sleep(100 * time.Millisecond)
        ch <- "Hello from goroutine 1"
    }()
    
    go func() {
        time.Sleep(200 * time.Millisecond)
        ch <- "Hello from goroutine 2"
    }()
    
    // Receive from both goroutines
    for i := 0; i < 2; i++ {
        fmt.Println(<-ch)
    }
    
    fmt.Println("All goroutines completed!")
}
`,
    language: 'go',
    cpu: 2,
    memory: 512,
    timeout: 30000,
  });

  console.log('Go Output:', goResult.stdout);

  // Example 4: GPU execution (if available)
  console.log('\n--- Example 4: GPU Execution (Python + PyTorch) ---');
  try {
    const gpuResult = await provider.run({
      code: `
import torch
import numpy as np

print(f"PyTorch version: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")

if torch.cuda.is_available():
    print(f"CUDA device: {torch.cuda.get_device_name(0)}")
    print(f"CUDA capability: {torch.cuda.get_device_capability(0)}")
    
    # Simple GPU computation
    size = 1000
    a = torch.randn(size, size).cuda()
    b = torch.randn(size, size).cuda()
    
    # Matrix multiplication on GPU
    start = torch.cuda.Event(enable_timing=True)
    end = torch.cuda.Event(enable_timing=True)
    
    start.record()
    c = torch.matmul(a, b)
    end.record()
    
    torch.cuda.synchronize()
    
    print(f"Matrix multiplication ({size}x{size}) took {start.elapsed_time(end):.2f} ms on GPU")
else:
    print("GPU not available, running on CPU")
    size = 100
    a = torch.randn(size, size)
    b = torch.randn(size, size)
    c = torch.matmul(a, b)
    print(f"Matrix shape: {c.shape}")
`,
      language: 'python',
      gpu: true,
      gpuType: 'T4',
      memory: 4096,
      timeout: 60000,
    });

    console.log('GPU Output:', gpuResult.stdout);
    console.log('GPU Cost: $', gpuResult.cost.toFixed(6));
  } catch (error) {
    console.log('GPU execution failed (this is normal if GPU is not available):', error);
  }

  // Example 5: Shell commands
  console.log('\n--- Example 5: Shell Commands ---');
  const shellResult = await provider.run({
    code: `
echo "System information:"
uname -a
echo ""
echo "CPU info:"
cat /proc/cpuinfo | grep "model name" | head -1
echo ""
echo "Memory info:"
free -h
echo ""
echo "Disk usage:"
df -h /
`,
    language: 'shell',
    timeout: 10000,
  });

  console.log('Shell Output:', shellResult.stdout);

  // Example 6: Error handling
  console.log('\n--- Example 6: Error Handling ---');
  try {
    const errorResult = await provider.run({
      code: `
def divide_by_zero():
    return 1 / 0

print("This will cause an error:")
result = divide_by_zero()
print(f"Result: {result}")
`,
      language: 'python',
      timeout: 10000,
    });
    
    console.log('Error stderr:', errorResult.stderr);
    console.log('Exit code:', errorResult.exitCode);
  } catch (error) {
    console.error('Execution error:', error);
  }

  // Cost estimation examples
  console.log('\n--- Cost Estimation Examples ---');
  
  const estimates = [
    { spec: { code: 'print("test")', language: 'python' as const, timeout: 5000 }, label: 'Basic 5s Python' },
    { spec: { code: 'print("test")', language: 'python' as const, cpu: 4, timeout: 60000 }, label: '4 CPU 60s' },
    { spec: { code: 'print("test")', language: 'python' as const, gpu: true, gpuType: 'T4' as const, timeout: 30000 }, label: 'T4 GPU 30s' },
    { spec: { code: 'print("test")', language: 'python' as const, gpu: true, gpuType: 'A100' as const, timeout: 30000 }, label: 'A100 GPU 30s' },
  ];

  for (const { spec, label } of estimates) {
    const cost = await provider.estimateCost(spec);
    console.log(`${label}: $${cost.toFixed(6)}`);
  }

  // Cleanup
  await provider.cleanup();
}

// Run the examples
main().catch(console.error);