/**
 * Shared test helpers for Sandstorm integration tests
 */

import type { SandboxResult, ISandboxProvider } from '@sandstorm/core';

/**
 * Validates that a sandbox result has all required properties
 */
export function expectValidResult(result: SandboxResult) {
  // Required properties
  expect(result).toHaveProperty('id');
  expect(result).toHaveProperty('provider');
  expect(result).toHaveProperty('stdout');
  expect(result).toHaveProperty('stderr');
  expect(result).toHaveProperty('exitCode');
  expect(result).toHaveProperty('duration');
  expect(result).toHaveProperty('cost');

  // Type checks
  expect(typeof result.id).toBe('string');
  expect(typeof result.provider).toBe('string');
  expect(typeof result.stdout).toBe('string');
  expect(typeof result.stderr).toBe('string');
  expect(typeof result.exitCode).toBe('number');
  expect(typeof result.duration).toBe('number');
  expect(typeof result.cost).toBe('number');

  // Value checks
  expect(result.id.length).toBeGreaterThan(0);
  expect(result.duration).toBeGreaterThanOrEqual(0);
  expect(result.cost).toBeGreaterThanOrEqual(0);
}

/**
 * Validates successful execution (exitCode 0)
 */
export function expectSuccessfulExecution(result: SandboxResult) {
  expectValidResult(result);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
}

/**
 * Validates failed execution (exitCode !== 0)
 */
export function expectFailedExecution(result: SandboxResult) {
  expectValidResult(result);
  expect(result.exitCode).not.toBe(0);
}

/**
 * Validates that output contains expected text
 */
export function expectOutputContains(result: SandboxResult, text: string) {
  expect(result.stdout).toContain(text);
}

/**
 * Validates that error output contains expected text
 */
export function expectErrorContains(result: SandboxResult, text: string) {
  expect(result.stderr).toContain(text);
}

/**
 * Validates execution duration is within expected range
 */
export function expectDurationInRange(
  result: SandboxResult,
  minMs: number,
  maxMs: number
) {
  expect(result.duration).toBeGreaterThanOrEqual(minMs);
  expect(result.duration).toBeLessThanOrEqual(maxMs);
}

/**
 * Validates cost is within expected range
 */
export function expectCostInRange(
  result: SandboxResult,
  minCost: number,
  maxCost: number
) {
  expect(result.cost).toBeGreaterThanOrEqual(minCost);
  expect(result.cost).toBeLessThanOrEqual(maxCost);
}

/**
 * Waits for a condition with timeout
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 30000,
  intervalMs: number = 1000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await condition();
    if (result) {
      return;
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
}

/**
 * Sleep helper
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Safely cleanup provider (catches and logs errors)
 */
export async function safeCleanup(provider: ISandboxProvider): Promise<void> {
  try {
    await provider.cleanup?.();
  } catch (error) {
    console.error('Cleanup error (non-fatal):', error);
  }
}

/**
 * Check if integration tests should run
 */
export function shouldRunIntegrationTests(): boolean {
  return process.env.RUN_INTEGRATION_TESTS === '1';
}

/**
 * Check if an API key is available
 */
export function hasApiKey(keyName: string): boolean {
  const key = process.env[keyName];
  return !!key && key.length > 0;
}

/**
 * Get API key or throw descriptive error
 */
export function requireApiKey(keyName: string): string {
  const key = process.env[keyName];
  if (!key || key.length === 0) {
    throw new Error(
      `${keyName} environment variable is required for integration tests. ` +
      `Set it in .env or export ${keyName}=your-key-here`
    );
  }
  return key;
}

/**
 * Skip test if API key is not available
 */
export function skipWithoutApiKey(keyName: string): void {
  if (!hasApiKey(keyName)) {
    console.log(`⏭️  Skipping test - ${keyName} not set`);
  }
}

/**
 * Create a test timeout message
 */
export function timeoutMessage(testName: string, timeoutMs: number): string {
  return `${testName} timed out after ${timeoutMs}ms. This may indicate:\n` +
    `  - Provider is slow or unavailable\n` +
    `  - Network issues\n` +
    `  - API rate limiting\n` +
    `  - Test timeout too short`;
}

/**
 * Measure execution time of a function
 */
export async function measureTime<T>(
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = Date.now();
  const result = await fn();
  const duration = Date.now() - start;
  return { result, duration };
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Generate a random test ID
 */
export function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Check if running in CI environment
 */
export function isCI(): boolean {
  return process.env.CI === 'true' || process.env.CI === '1';
}

/**
 * Get appropriate timeout for environment
 */
export function getTestTimeout(defaultMs: number = 30000): number {
  // CI environments often need longer timeouts
  return isCI() ? defaultMs * 2 : defaultMs;
}

/**
 * Cost tracking helper for integration tests
 */
export class CostTracker {
  private costs: number[] = [];
  private readonly maxTotalCost: number;

  constructor(maxTotalCost: number = 1.0) {
    this.maxTotalCost = maxTotalCost;
  }

  track(cost: number): void {
    this.costs.push(cost);

    const total = this.getTotalCost();
    if (total > this.maxTotalCost) {
      console.warn(
        `⚠️  Total test cost ($${total.toFixed(4)}) exceeds maximum ($${this.maxTotalCost})`
      );
    }
  }

  getTotalCost(): number {
    return this.costs.reduce((sum, cost) => sum + cost, 0);
  }

  getAverageCost(): number {
    return this.costs.length > 0
      ? this.getTotalCost() / this.costs.length
      : 0;
  }

  report(): void {
    console.log('\n💰 Cost Summary:');
    console.log(`  Total: $${this.getTotalCost().toFixed(4)}`);
    console.log(`  Average: $${this.getAverageCost().toFixed(6)}`);
    console.log(`  Tests: ${this.costs.length}`);
  }
}

/**
 * Global test expect function (from bun:test)
 */
declare global {
  function expect(value: any): any;
}
