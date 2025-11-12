/**
 * E2B Provider Unit Tests
 *
 * These tests validate pure logic without making real API calls.
 * They run fast and have no external dependencies.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { E2BProvider } from '../provider';
import { fixtures } from '@sandstorm/test-utils';

describe('E2B Provider - Unit Tests', () => {
  let provider: E2BProvider;

  beforeEach(() => {
    provider = new E2BProvider({
      apiKey: 'test-key',
      defaultTimeout: 120000,
    });
  });

  describe('configuration', () => {
    it('should initialize with valid config', () => {
      const provider = new E2BProvider({
        apiKey: 'test-api-key',
        defaultTimeout: 60000,
        maxRetries: 5,
      });

      expect(provider).toBeDefined();
      expect(provider.name).toBe('e2b');
    });

    it('should use default timeout if not provided', () => {
      const provider = new E2BProvider({
        apiKey: 'test-key',
      });

      expect(provider).toBeDefined();
    });

    it('should throw on empty API key', () => {
      expect(() => {
        new E2BProvider({
          apiKey: '',
        });
      }).toThrow();
    });

    it('should throw on invalid timeout', () => {
      expect(() => {
        new E2BProvider({
          apiKey: 'test-key',
          defaultTimeout: -1000,
        });
      }).toThrow();
    });
  });

  describe('cost estimation', () => {
    it('should calculate base cost correctly', async () => {
      const cost = await provider.estimateCost({
        ...fixtures.specs.pythonHello,
        timeout: 10000, // 10 seconds
      });

      // Base rate: $0.00014/sec * 10 seconds = $0.0014
      expect(cost).toBeCloseTo(0.0014, 4);
    });

    it('should calculate cost for 1 minute execution', async () => {
      const cost = await provider.estimateCost({
        ...fixtures.specs.pythonHello,
        timeout: 60000, // 1 minute = 60 seconds
      });

      // $0.00014/sec * 60 seconds = $0.0084
      expect(cost).toBeCloseTo(0.0084, 4);
    });

    it('should apply GPU multiplier', async () => {
      const cpuCost = await provider.estimateCost({
        ...fixtures.specs.pythonHello,
        timeout: 10000,
        gpu: false,
      });

      const gpuCost = await provider.estimateCost({
        ...fixtures.specs.pythonHello,
        timeout: 10000,
        gpu: true,
      });

      // GPU should be 10x more expensive
      expect(gpuCost).toBeCloseTo(cpuCost * 10, 4);
    });

    it('should apply high memory multiplier', async () => {
      const normalCost = await provider.estimateCost({
        ...fixtures.specs.pythonHello,
        timeout: 10000,
        memory: 2048, // 2GB
      });

      const highMemoryCost = await provider.estimateCost({
        ...fixtures.specs.pythonHello,
        timeout: 10000,
        memory: 8192, // 8GB
      });

      // High memory should cost more
      expect(highMemoryCost).toBeGreaterThan(normalCost);
    });

    it('should apply stateful session multiplier', async () => {
      const statelessCost = await provider.estimateCost({
        ...fixtures.specs.pythonHello,
        timeout: 10000,
        stateful: false,
      });

      const statefulCost = await provider.estimateCost({
        ...fixtures.specs.pythonHello,
        timeout: 10000,
        stateful: true,
      });

      // Stateful should be 1.2x more expensive
      expect(statefulCost).toBeCloseTo(statelessCost * 1.2, 4);
    });

    it('should handle combined multipliers', async () => {
      const cost = await provider.estimateCost({
        ...fixtures.specs.pythonHello,
        timeout: 10000,
        gpu: true, // 10x
        memory: 8192, // 1.5x
        stateful: true, // 1.2x
      });

      // Base: $0.0014
      // With GPU (10x): $0.014
      // With high memory (1.5x): $0.021
      // With stateful (1.2x): $0.0252
      expect(cost).toBeCloseTo(0.0252, 3);
    });
  });

  describe('latency estimation', () => {
    it('should estimate base latency', async () => {
      const latency = await provider.estimateLatency(fixtures.specs.pythonHello);

      expect(latency).toBe(150); // Base latency
    });

    it('should add latency for package installation', async () => {
      const noPackages = await provider.estimateLatency({
        ...fixtures.specs.pythonHello,
        requirements: [],
      });

      const onePackage = await provider.estimateLatency({
        ...fixtures.specs.pythonHello,
        requirements: ['requests'],
      });

      const threePackages = await provider.estimateLatency({
        ...fixtures.specs.pythonHello,
        requirements: ['requests', 'numpy', 'pandas'],
      });

      expect(onePackage).toBe(noPackages + 500); // +500ms per package
      expect(threePackages).toBe(noPackages + 1500); // +1500ms for 3 packages
    });

    it('should add latency for stateful sessions', async () => {
      const stateless = await provider.estimateLatency({
        ...fixtures.specs.pythonHello,
        stateful: false,
      });

      const stateful = await provider.estimateLatency({
        ...fixtures.specs.pythonHello,
        stateful: true,
      });

      expect(stateful).toBe(stateless + 100);
    });
  });

  describe('language mapping', () => {
    it('should map Python correctly', async () => {
      const mapper = (provider as any).mapLanguage.bind(provider);
      expect(mapper('python')).toBe('python');
    });

    it('should map JavaScript correctly', async () => {
      const mapper = (provider as any).mapLanguage.bind(provider);
      expect(mapper('javascript')).toBe('js');
    });

    it('should map TypeScript to JavaScript', async () => {
      const mapper = (provider as any).mapLanguage.bind(provider);
      expect(mapper('typescript')).toBe('js');
    });

    it('should map Ruby correctly', async () => {
      const mapper = (provider as any).mapLanguage.bind(provider);
      expect(mapper('ruby')).toBe('ruby');
    });

    it('should map C++ correctly', async () => {
      const mapper = (provider as any).mapLanguage.bind(provider);
      expect(mapper('cpp')).toBe('cpp');
    });

    it('should map shell to bash', async () => {
      const mapper = (provider as any).mapLanguage.bind(provider);
      expect(mapper('shell')).toBe('bash');
    });

    it('should fallback unsupported languages to Python', async () => {
      const mapper = (provider as any).mapLanguage.bind(provider);
      expect(mapper('go')).toBe('python');
      expect(mapper('rust')).toBe('python');
      expect(mapper('java')).toBe('python');
    });
  });

  describe('error wrapping', () => {
    it('should wrap rate limit errors', () => {
      const wrapError = (provider as any).wrapError.bind(provider);
      const error = new Error('API rate limit exceeded');
      const wrapped = wrapError(error);

      expect(wrapped.message).toContain('E2B rate limit exceeded');
    });

    it('should wrap quota errors', () => {
      const wrapError = (provider as any).wrapError.bind(provider);
      const error = new Error('Monthly quota exceeded');
      const wrapped = wrapError(error);

      expect(wrapped.message).toContain('E2B quota exceeded');
    });

    it('should wrap timeout errors', () => {
      const wrapError = (provider as any).wrapError.bind(provider);
      const error = new Error('Execution timeout after 30s');
      const wrapped = wrapError(error);

      expect(wrapped.message).toContain('E2B execution timeout');
    });

    it('should preserve original error for unknown errors', () => {
      const wrapError = (provider as any).wrapError.bind(provider);
      const error = new Error('Unknown error occurred');
      const wrapped = wrapError(error);

      expect(wrapped.message).toBe('Unknown error occurred');
    });

    it('should handle non-Error objects', () => {
      const wrapError = (provider as any).wrapError.bind(provider);
      const error = 'string error';
      const wrapped = wrapError(error);

      expect(wrapped.message).toContain('E2B error: string error');
    });
  });

  describe('file hashing', () => {
    it('should generate consistent hash for same files', () => {
      const hashFiles = (provider as any).hashFiles.bind(provider);
      const files = ['file1.txt', 'file2.txt', 'file3.txt'];

      const hash1 = hashFiles(files);
      const hash2 = hashFiles(files);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different files', () => {
      const hashFiles = (provider as any).hashFiles.bind(provider);

      const hash1 = hashFiles(['file1.txt', 'file2.txt']);
      const hash2 = hashFiles(['file1.txt', 'file3.txt']);

      expect(hash1).not.toBe(hash2);
    });

    it('should sort files before hashing', () => {
      const hashFiles = (provider as any).hashFiles.bind(provider);

      const hash1 = hashFiles(['a.txt', 'b.txt', 'c.txt']);
      const hash2 = hashFiles(['c.txt', 'a.txt', 'b.txt']);

      // Should be same because files are sorted
      expect(hash1).toBe(hash2);
    });
  });
});
