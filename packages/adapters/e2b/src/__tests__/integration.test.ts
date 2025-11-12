/**
 * E2B Provider Integration Tests
 *
 * These tests use the REAL E2B API to validate actual behavior.
 *
 * Prerequisites:
 * - E2B_API_KEY environment variable must be set
 * - RUN_INTEGRATION_TESTS=1 must be set
 *
 * Usage:
 *   E2B_API_KEY=your-key RUN_INTEGRATION_TESTS=1 bun test
 *
 * Note: These tests will incur small costs (~$0.01 total)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { E2BProvider } from '../provider';
import {
  fixtures,
  expectedOutputs,
  expectValidResult,
  expectSuccessfulExecution,
  expectFailedExecution,
  expectOutputContains,
  expectDurationInRange,
  expectCostInRange,
  safeCleanup,
  requireApiKey,
  hasApiKey,
  getTestTimeout,
  CostTracker,
  sleep,
} from '@sandstorm/test-utils';

// Only run if integration tests are enabled AND E2B_API_KEY is set
const shouldRun = process.env.RUN_INTEGRATION_TESTS === '1' && hasApiKey('E2B_API_KEY');

describe.if(shouldRun)('E2B Provider - Integration Tests', () => {
  let provider: E2BProvider;
  let costTracker: CostTracker;

  beforeAll(() => {
    const apiKey = requireApiKey('E2B_API_KEY');

    provider = new E2BProvider({
      apiKey,
      defaultTimeout: 120000,
      maxRetries: 3,
    });

    // Track costs to ensure we don't overspend in tests
    costTracker = new CostTracker(0.10); // Max $0.10 for all tests

    console.log('\n🧪 Starting E2B integration tests...');
    console.log('⚠️  These tests use real API calls and will incur small costs');
  });

  afterAll(async () => {
    await safeCleanup(provider);
    costTracker.report();
    console.log('✅ E2B integration tests complete\n');
  });

  afterEach(async () => {
    // Clean up after each test
    await safeCleanup(provider);
    // Small delay to avoid rate limits
    await sleep(500);
  });

  describe('provider availability', () => {
    it(
      'should check availability and return true with valid API key',
      async () => {
        const available = await provider.isAvailable();
        expect(available).toBe(true);
      },
      getTestTimeout(15000)
    );
  });

  describe('basic execution', () => {
    it(
      'should execute simple Python hello world',
      async () => {
        const result = await provider.run(fixtures.specs.pythonHello);

        expectSuccessfulExecution(result);
        expectOutputContains(result, expectedOutputs.pythonHello);
        expect(result.provider).toBe('e2b');
        expectDurationInRange(result, 0, 30000);
        expectCostInRange(result, 0, 0.01);

        costTracker.track(result.cost);
      },
      getTestTimeout(30000)
    );

    it(
      'should execute Python code with calculations',
      async () => {
        const result = await provider.run(fixtures.specs.pythonMath);

        expectSuccessfulExecution(result);
        expectOutputContains(result, expectedOutputs.pythonMath);
        expect(result.provider).toBe('e2b');

        costTracker.track(result.cost);
      },
      getTestTimeout(30000)
    );

    it(
      'should execute JavaScript code',
      async () => {
        const result = await provider.run(fixtures.specs.javascriptHello);

        expectSuccessfulExecution(result);
        expectOutputContains(result, expectedOutputs.javascriptHello);
        expect(result.provider).toBe('e2b');

        costTracker.track(result.cost);
      },
      getTestTimeout(30000)
    );

    it(
      'should execute TypeScript code',
      async () => {
        const result = await provider.run(fixtures.specs.typescriptHello);

        expectSuccessfulExecution(result);
        expectOutputContains(result, expectedOutputs.typescriptHello);
        expect(result.provider).toBe('e2b');

        costTracker.track(result.cost);
      },
      getTestTimeout(30000)
    );

    it(
      'should execute Ruby code',
      async () => {
        const result = await provider.run(fixtures.specs.rubyHello);

        expectSuccessfulExecution(result);
        expectOutputContains(result, expectedOutputs.rubyHello);
        expect(result.provider).toBe('e2b');

        costTracker.track(result.cost);
      },
      getTestTimeout(30000)
    );

    it(
      'should execute shell commands',
      async () => {
        const result = await provider.run(fixtures.specs.shellHello);

        expectSuccessfulExecution(result);
        expectOutputContains(result, expectedOutputs.shellHello);
        expect(result.provider).toBe('e2b');

        costTracker.track(result.cost);
      },
      getTestTimeout(30000)
    );
  });

  describe('package installation', () => {
    it(
      'should install and use Python packages',
      async () => {
        const result = await provider.run(fixtures.specs.pythonWithPackages);

        expectSuccessfulExecution(result);
        expectOutputContains(result, 'Test with packages');
        expectOutputContains(result, 'success');

        costTracker.track(result.cost);
      },
      getTestTimeout(60000) // Longer timeout for package installation
    );
  });

  describe('filesystem operations', () => {
    it(
      'should read and write files',
      async () => {
        const result = await provider.run(fixtures.specs.pythonWithFiles);

        expectSuccessfulExecution(result);
        expectOutputContains(result, expectedOutputs.pythonWithFiles);

        costTracker.track(result.cost);
      },
      getTestTimeout(30000)
    );

    it(
      'should handle input files',
      async () => {
        const result = await provider.run(fixtures.specs.pythonWithInputFiles);

        expectSuccessfulExecution(result);
        expectOutputContains(result, 'Input file content: hello from input file');
        expectOutputContains(result, 'Output file written');

        costTracker.track(result.cost);
      },
      getTestTimeout(30000)
    );
  });

  describe('environment variables', () => {
    it(
      'should set and read environment variables',
      async () => {
        const result = await provider.run(fixtures.specs.pythonWithEnv);

        expectSuccessfulExecution(result);
        expectOutputContains(result, expectedOutputs.pythonWithEnv);
        expectOutputContains(result, 'Environment: testing');

        costTracker.track(result.cost);
      },
      getTestTimeout(30000)
    );
  });

  describe('error handling', () => {
    it(
      'should handle Python runtime errors',
      async () => {
        const result = await provider.run(fixtures.specs.pythonError);

        expectFailedExecution(result);
        expect(result.exitCode).not.toBe(0);
        // stderr should contain error information
        expect(result.stderr.length).toBeGreaterThan(0);

        costTracker.track(result.cost);
      },
      getTestTimeout(30000)
    );

    it(
      'should handle timeout errors',
      async () => {
        try {
          const result = await provider.run(fixtures.specs.pythonTimeout);

          // If it completes, it should either:
          // 1. Have been killed (exitCode !== 0)
          // 2. Have an error about timeout
          if (result.exitCode === 0) {
            // Sometimes the provider kills it gracefully
            expectOutputContains(result, 'Starting long operation');
          } else {
            expectFailedExecution(result);
          }

          costTracker.track(result.cost);
        } catch (error) {
          // It's also acceptable to throw an error on timeout
          expect(error).toBeDefined();
          expect((error as Error).message.toLowerCase()).toContain('timeout');
        }
      },
      getTestTimeout(15000) // Should timeout before this
    );
  });

  describe('resource management', () => {
    it(
      'should handle memory-intensive operations',
      async () => {
        const result = await provider.run(fixtures.specs.pythonHighMemory);

        expectValidResult(result);
        // May succeed or fail depending on memory limits
        if (result.exitCode === 0) {
          expectOutputContains(result, 'Allocated');
        }

        costTracker.track(result.cost);
      },
      getTestTimeout(30000)
    );

    it(
      'should track execution metrics',
      async () => {
        const result = await provider.run(fixtures.specs.pythonHello);

        expectSuccessfulExecution(result);
        expect(result.metrics).toBeDefined();

        if (result.metrics) {
          // CPU and memory usage should be tracked
          expect(typeof result.metrics.cpuUsage).toBe('number');
          expect(typeof result.metrics.memoryUsage).toBe('number');
        }

        costTracker.track(result.cost);
      },
      getTestTimeout(30000)
    );
  });

  describe('cost estimation', () => {
    it('should estimate cost for simple execution', async () => {
      const cost = await provider.estimateCost(fixtures.specs.pythonHello);

      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(0.01); // Should be very cheap
    });

    it('should estimate higher cost for longer execution', async () => {
      const shortCost = await provider.estimateCost({
        ...fixtures.specs.pythonHello,
        timeout: 10000, // 10 seconds
      });

      const longCost = await provider.estimateCost({
        ...fixtures.specs.pythonHello,
        timeout: 60000, // 60 seconds
      });

      expect(longCost).toBeGreaterThan(shortCost);
    });

    it('should estimate higher cost for GPU workloads', async () => {
      const cpuCost = await provider.estimateCost(fixtures.specs.pythonHello);
      const gpuCost = await provider.estimateCost({
        ...fixtures.specs.pythonHello,
        gpu: true,
      });

      expect(gpuCost).toBeGreaterThan(cpuCost);
      expect(gpuCost).toBeGreaterThanOrEqual(cpuCost * 5); // GPU is much more expensive
    });
  });

  describe('latency estimation', () => {
    it('should estimate latency for simple execution', async () => {
      const latency = await provider.estimateLatency(fixtures.specs.pythonHello);

      expect(latency).toBeGreaterThan(0);
      expect(latency).toBeLessThan(5000); // E2B is fast
    });

    it('should estimate higher latency with package installation', async () => {
      const noPackagesLatency = await provider.estimateLatency(
        fixtures.specs.pythonHello
      );

      const withPackagesLatency = await provider.estimateLatency(
        fixtures.specs.pythonWithPackages
      );

      expect(withPackagesLatency).toBeGreaterThan(noPackagesLatency);
    });
  });

  describe('quota management', () => {
    it('should return quota information', async () => {
      const quota = await provider.getQuota();

      expect(quota).toHaveProperty('used');
      expect(quota).toHaveProperty('limit');
      expect(typeof quota.used).toBe('number');
      expect(typeof quota.limit).toBe('number');
      expect(quota.used).toBeGreaterThanOrEqual(0);
      expect(quota.limit).toBeGreaterThan(0);
    });
  });

  describe('concurrent execution', () => {
    it(
      'should handle multiple sandboxes concurrently',
      async () => {
        const specs = [
          fixtures.specs.pythonHello,
          fixtures.specs.javascriptHello,
          fixtures.specs.pythonMath,
        ];

        // Run all in parallel
        const results = await Promise.all(
          specs.map(spec => provider.run(spec))
        );

        // All should succeed
        expect(results).toHaveLength(3);
        results.forEach(result => {
          expectSuccessfulExecution(result);
          costTracker.track(result.cost);
        });
      },
      getTestTimeout(45000)
    );
  });

  describe('cleanup', () => {
    it('should cleanup without errors', async () => {
      // Run a sandbox
      await provider.run(fixtures.specs.pythonHello);

      // Cleanup should not throw
      await expect(provider.cleanup()).resolves.toBeUndefined();
    });
  });
});

// Show helpful message if tests are skipped
if (!shouldRun) {
  describe.skip('E2B Provider - Integration Tests', () => {
    it('skipped - see instructions', () => {
      console.log('\n⏭️  E2B integration tests skipped');
      console.log('To run these tests:');
      console.log('  1. Get an E2B API key from https://e2b.dev');
      console.log('  2. Set environment variables:');
      console.log('     export E2B_API_KEY=your-key-here');
      console.log('     export RUN_INTEGRATION_TESTS=1');
      console.log('  3. Run: bun test');
      console.log('\nNote: Integration tests will incur small API costs (~$0.01)\n');
    });
  });
}
