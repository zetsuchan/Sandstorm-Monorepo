import { describe, it, expect, beforeAll } from 'vitest';
import { PodmanAdapter } from '../adapters/podman';
import { EdgeAgentConfig } from '../types';

describe('PodmanAdapter', () => {
  let adapter: PodmanAdapter;
  let config: EdgeAgentConfig;

  beforeAll(() => {
    adapter = new PodmanAdapter({ rootless: true });
    config = {
      agentName: 'test-agent',
      apiKey: 'test-key',
      runtime: 'podman',
      rootless: true,
      listenPort: 8080,
      listenHost: '0.0.0.0',
      maxConcurrentSandboxes: 10,
      maxMemoryMB: 512,
      maxCpuCores: 1,
      workDir: '/tmp/sandstorm-test',
      tempDir: '/tmp/sandstorm-test/tmp',
      telemetryInterval: 30000,
      metricsRetention: 86400,
      enableNetworkIsolation: true,
      vpcMode: false,
    };
  });

  it('should check if podman is available', async () => {
    const available = await adapter.isAvailable();
    // This will depend on whether podman is actually installed
    expect(typeof available).toBe('boolean');
  });

  it('should get correct image for language', () => {
    const getImage = (adapter as any).getImage.bind(adapter);
    
    expect(getImage('python')).toBe('docker.io/python:3.11-slim');
    expect(getImage('javascript')).toBe('docker.io/node:20-slim');
    expect(getImage('typescript')).toBe('docker.io/node:20-slim');
    expect(getImage('go')).toBe('docker.io/golang:1.21-alpine');
    expect(getImage('rust')).toBe('docker.io/rust:1.75-slim');
    expect(getImage('unknown')).toBe('docker.io/alpine:latest');
  });

  it('should get correct filename for language', () => {
    const getFileName = (adapter as any).getFileName.bind(adapter);
    
    expect(getFileName('python')).toBe('main.py');
    expect(getFileName('javascript')).toBe('main.js');
    expect(getFileName('typescript')).toBe('main.ts');
    expect(getFileName('go')).toBe('main.go');
    expect(getFileName('rust')).toBe('main.rs');
    expect(getFileName('java')).toBe('Main.java');
    expect(getFileName('cpp')).toBe('main.cpp');
    expect(getFileName('shell')).toBe('main.sh');
  });

  it('should parse memory strings correctly', () => {
    const parseMemory = (adapter as any).parseMemory.bind(adapter);
    
    expect(parseMemory('1024MB')).toBe(1024);
    expect(parseMemory('2GB')).toBe(2048);
    expect(parseMemory('512MiB')).toBe(512);
    expect(parseMemory('1.5GB')).toBe(1536);
    expect(parseMemory('invalid')).toBe(0);
  });

  // Integration test - only run if podman is available
  it.skipIf(!process.env.RUN_INTEGRATION_TESTS)(
    'should run a simple python sandbox',
    async () => {
      const result = await adapter.runSandbox({
        code: 'print("Hello from test!")',
        language: 'python',
        memory: 256,
        cpu: 0.5,
        timeout: 10000,
      }, config);

      expect(result.stdout).toContain('Hello from test!');
      expect(result.exitCode).toBe(0);
      expect(result.provider).toBe('custom');
    },
    30000
  );
});