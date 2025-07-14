import { describe, it, expect, beforeEach } from 'bun:test';
import { AppleContainersProvider } from '../provider';
import { AppleContainersConfig } from '../config';
import { SandboxSpec } from '@sandstorm/core';

describe('AppleContainersProvider', () => {
  let provider: AppleContainersProvider;
  let config: AppleContainersConfig;

  beforeEach(() => {
    config = {
      defaultTimeout: 30000,
      maxMemoryGB: 4,
      maxCpuCores: 4,
      enableRosetta: true,
      containerPath: 'container',
    };
    provider = new AppleContainersProvider(config);
  });

  describe('isAvailable', () => {
    it('should check if container CLI is available', async () => {
      const available = await provider.isAvailable();
      // This will be false unless actually running on macOS with container installed
      expect(typeof available).toBe('boolean');
    });
  });

  describe('estimateCost', () => {
    it('should calculate cost based on resources', async () => {
      const spec: SandboxSpec = {
        code: 'print("test")',
        language: 'python',
        cpu: 2,
        memory: 2048,
        timeout: 60000, // 1 minute
        isolationLevel: 'standard',
      };

      const cost = await provider.estimateCost(spec);
      // Base rate 0.005 * 2 CPU * (1 + 2GB * 0.2) * 1 minute
      expect(cost).toBeCloseTo(0.014, 3);
    });

    it('should throw error for GPU requests', async () => {
      const spec: SandboxSpec = {
        code: 'print("test")',
        language: 'python',
        gpu: true,
        isolationLevel: 'standard',
      };

      await expect(provider.estimateCost(spec)).rejects.toThrow(
        'GPU acceleration is not supported'
      );
    });
  });

  describe('estimateLatency', () => {
    it('should estimate sub-second latency for simple containers', async () => {
      const spec: SandboxSpec = {
        code: 'print("test")',
        language: 'python',
        isolationLevel: 'standard',
      };

      const latency = await provider.estimateLatency(spec);
      expect(latency).toBeLessThan(1000);
      expect(latency).toBeGreaterThan(0);
    });

    it('should add latency for custom images', async () => {
      const spec: SandboxSpec = {
        code: 'print("test")',
        language: 'python',
        containerImage: 'custom/image:latest',
        isolationLevel: 'standard',
      };

      const latency = await provider.estimateLatency(spec);
      expect(latency).toBeGreaterThan(2000);
    });
  });

  describe('language support', () => {
    it('should map languages to correct images', () => {
      const getImage = (provider as any).getImageForLanguage.bind(provider);
      
      expect(getImage('python')).toBe('docker.io/python:3.11-slim');
      expect(getImage('javascript')).toBe('docker.io/node:20-slim');
      expect(getImage('typescript')).toBe('docker.io/node:20-slim');
      expect(getImage('go')).toBe('docker.io/golang:1.21-alpine');
      expect(getImage('rust')).toBe('docker.io/rust:1.75-slim');
      expect(getImage('java')).toBe('docker.io/eclipse-temurin:21-jre');
      expect(getImage('cpp')).toBe('docker.io/gcc:13');
      expect(getImage('csharp')).toBe('docker.io/mcr.microsoft.com/dotnet/sdk:8.0');
      expect(getImage('php')).toBe('docker.io/php:8.3-cli');
      expect(getImage('ruby')).toBe('docker.io/ruby:3.3-slim');
      expect(getImage('shell')).toBe('docker.io/alpine:latest');
    });

    it('should use custom image when provided', () => {
      const getImage = (provider as any).getImageForLanguage.bind(provider);
      
      expect(getImage('python', 'custom/python:latest')).toBe('custom/python:latest');
    });
  });

  describe('file extensions', () => {
    it('should return correct file extensions for languages', () => {
      const getExtension = (provider as any).getFileExtension.bind(provider);
      
      expect(getExtension('python')).toBe('.py');
      expect(getExtension('javascript')).toBe('.js');
      expect(getExtension('typescript')).toBe('.ts');
      expect(getExtension('go')).toBe('.go');
      expect(getExtension('rust')).toBe('.rs');
      expect(getExtension('java')).toBe('.java');
      expect(getExtension('cpp')).toBe('.cpp');
      expect(getExtension('csharp')).toBe('.cs');
      expect(getExtension('php')).toBe('.php');
      expect(getExtension('ruby')).toBe('.rb');
      expect(getExtension('shell')).toBe('.sh');
    });
  });

  // Integration tests - only run if container is actually available
  describe.if(process.env.RUN_INTEGRATION_TESTS)('integration tests', () => {
    it('should run Python code in Apple Container', async () => {
      const isAvailable = await provider.isAvailable();
      if (!isAvailable) {
        console.log('Skipping integration test - Apple Containers not available');
        return;
      }

      const spec: SandboxSpec = {
        code: 'print("Hello from Apple Containers!")',
        language: 'python',
        isolationLevel: 'standard',
      };

      const result = await provider.run(spec);
      expect(result.stdout).toContain('Hello from Apple Containers!');
      expect(result.exitCode).toBe(0);
      expect(result.provider).toBe('apple-containers');
    }, 30000);
  });

  describe('cleanup', () => {
    it('should clean up active sandboxes', async () => {
      // This just tests that cleanup doesn't throw
      await expect(provider.cleanup()).resolves.toBeUndefined();
    });
  });

  describe('unsupported operations', () => {
    it('should throw for snapshot operations', async () => {
      await expect(provider.snapshot('test-id')).rejects.toThrow(
        'Snapshots are not yet supported'
      );
      
      await expect(provider.restore('test-id')).rejects.toThrow(
        'Snapshot restore is not yet supported'
      );
    });
  });

  describe('quota', () => {
    it('should return local quota information', async () => {
      const quota = await provider.getQuota();
      expect(quota.used).toBe(0);
      expect(quota.limit).toBe(100);
    });
  });
});