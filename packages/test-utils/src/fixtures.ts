/**
 * Shared test fixtures for Sandstorm tests
 * These provide consistent, realistic test data across all adapter tests
 */

import type { SandboxSpec, SandboxResult } from '@sandstorm/core';

/**
 * Basic sandbox specifications for common scenarios
 */
export const fixtures = {
  specs: {
    /**
     * Minimal Python hello world - fast and cheap
     */
    pythonHello: {
      code: 'print("Hello from test!")',
      language: 'python',
      timeout: 10000,
      isolationLevel: 'standard',
    } as SandboxSpec,

    /**
     * Python with calculation - tests actual execution
     */
    pythonMath: {
      code: `
import math
result = math.sqrt(16) + math.pow(2, 3)
print(f"Result: {result}")
      `.trim(),
      language: 'python',
      timeout: 10000,
      isolationLevel: 'standard',
    } as SandboxSpec,

    /**
     * Python with package installation
     */
    pythonWithPackages: {
      code: `
import json
data = {"message": "Test with packages", "status": "success"}
print(json.dumps(data, indent=2))
      `.trim(),
      language: 'python',
      requirements: ['requests'],
      timeout: 30000,
      isolationLevel: 'standard',
    } as SandboxSpec,

    /**
     * JavaScript hello world
     */
    javascriptHello: {
      code: 'console.log("Hello from JavaScript!");',
      language: 'javascript',
      timeout: 10000,
      isolationLevel: 'standard',
    } as SandboxSpec,

    /**
     * JavaScript with calculation
     */
    javascriptMath: {
      code: `
const result = Math.sqrt(16) + Math.pow(2, 3);
console.log(\`Result: \${result}\`);
      `.trim(),
      language: 'javascript',
      timeout: 10000,
      isolationLevel: 'standard',
    } as SandboxSpec,

    /**
     * TypeScript code
     */
    typescriptHello: {
      code: `
const greeting: string = "Hello from TypeScript!";
console.log(greeting);
      `.trim(),
      language: 'typescript',
      timeout: 10000,
      isolationLevel: 'standard',
    } as SandboxSpec,

    /**
     * Code that writes to filesystem
     */
    pythonWithFiles: {
      code: `
with open('/tmp/test.txt', 'w') as f:
    f.write('Test content')

with open('/tmp/test.txt', 'r') as f:
    content = f.read()
    print(f"File content: {content}")
      `.trim(),
      language: 'python',
      timeout: 10000,
      isolationLevel: 'standard',
    } as SandboxSpec,

    /**
     * Code with environment variables
     */
    pythonWithEnv: {
      code: `
import os
api_key = os.environ.get('TEST_API_KEY', 'not-set')
env = os.environ.get('TEST_ENV', 'not-set')
print(f"API Key: {api_key}")
print(f"Environment: {env}")
      `.trim(),
      language: 'python',
      environment: {
        TEST_API_KEY: 'test-key-123',
        TEST_ENV: 'testing',
      },
      timeout: 10000,
      isolationLevel: 'standard',
    } as SandboxSpec,

    /**
     * Code that times out (for timeout testing)
     */
    pythonTimeout: {
      code: `
import time
print("Starting long operation...")
time.sleep(30)  # Sleep longer than timeout
print("This should never print")
      `.trim(),
      language: 'python',
      timeout: 5000, // 5 seconds - should timeout
      isolationLevel: 'standard',
    } as SandboxSpec,

    /**
     * Code that errors
     */
    pythonError: {
      code: `
# This will raise an error
undefined_variable = some_undefined_variable
print("This should never print")
      `.trim(),
      language: 'python',
      timeout: 10000,
      isolationLevel: 'standard',
    } as SandboxSpec,

    /**
     * Code that uses high memory (for resource testing)
     */
    pythonHighMemory: {
      code: `
# Allocate ~100MB of memory
data = 'x' * (100 * 1024 * 1024)
print(f"Allocated {len(data)} bytes")
      `.trim(),
      language: 'python',
      memory: 256, // 256MB limit
      timeout: 15000,
      isolationLevel: 'standard',
    } as SandboxSpec,

    /**
     * Code with custom files
     */
    pythonWithInputFiles: {
      code: `
with open('/workspace/input.txt', 'r') as f:
    content = f.read()
    print(f"Input file content: {content}")

with open('/workspace/output.txt', 'w') as f:
    f.write(content.upper())
    print("Output file written")
      `.trim(),
      language: 'python',
      files: {
        '/workspace/input.txt': 'hello from input file',
      },
      timeout: 10000,
      isolationLevel: 'standard',
    } as SandboxSpec,

    /**
     * Ruby hello world
     */
    rubyHello: {
      code: 'puts "Hello from Ruby!"',
      language: 'ruby',
      timeout: 10000,
      isolationLevel: 'standard',
    } as SandboxSpec,

    /**
     * Shell script
     */
    shellHello: {
      code: `
#!/bin/bash
echo "Hello from Shell!"
echo "Current directory: $(pwd)"
echo "Date: $(date)"
      `.trim(),
      language: 'shell',
      timeout: 10000,
      isolationLevel: 'standard',
    } as SandboxSpec,

    /**
     * Minimal spec for cost testing
     */
    minimalForCost: {
      code: 'print("cost test")',
      language: 'python',
      timeout: 5000,
      memory: 128,
      cpu: 0.5,
      isolationLevel: 'standard',
    } as SandboxSpec,

    /**
     * GPU spec (for providers that support it)
     */
    pythonGpu: {
      code: `
# Simulate GPU workload
import time
print("Running GPU simulation...")
time.sleep(1)
print("GPU work complete")
      `.trim(),
      language: 'python',
      gpu: true,
      gpuType: 'T4',
      timeout: 15000,
      isolationLevel: 'standard',
    } as SandboxSpec,
  },
};

/**
 * Helper to create a custom spec based on a fixture
 */
export function createSpec(
  base: SandboxSpec,
  overrides: Partial<SandboxSpec>
): SandboxSpec {
  return { ...base, ...overrides };
}

/**
 * Expected outputs for validation
 */
export const expectedOutputs = {
  pythonHello: 'Hello from test!',
  pythonMath: 'Result: 12.0',
  javascriptHello: 'Hello from JavaScript!',
  javascriptMath: 'Result: 12',
  typescriptHello: 'Hello from TypeScript!',
  pythonWithFiles: 'File content: Test content',
  pythonWithEnv: 'API Key: test-key-123',
  rubyHello: 'Hello from Ruby!',
  shellHello: 'Hello from Shell!',
};

/**
 * Mock successful result for testing
 */
export function createMockResult(
  overrides: Partial<SandboxResult> = {}
): SandboxResult {
  return {
    id: 'test-sandbox-123',
    provider: 'e2b',
    stdout: 'Test output',
    stderr: '',
    exitCode: 0,
    duration: 1500,
    cost: 0.001,
    files: {},
    logs: [],
    metrics: {
      cpuUsage: 25.5,
      memoryUsage: 128,
    },
    ...overrides,
  };
}
