import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { EdgeAgent } from '../agent';
import { EdgeAgentConfig } from '../types';
import { createSandstormEdge } from '@sandstorm/sdk';

describe('Edge Agent Integration', () => {
  let agent: EdgeAgent;
  let config: EdgeAgentConfig;
  
  beforeAll(async () => {
    config = {
      agentName: 'test-integration-agent',
      apiKey: 'test-key',
      runtime: 'podman',
      rootless: true,
      listenPort: 8081, // Use different port to avoid conflicts
      listenHost: '127.0.0.1',
      maxConcurrentSandboxes: 2,
      maxMemoryMB: 1024,
      maxCpuCores: 1,
      workDir: '/tmp/sandstorm-integration-test',
      tempDir: '/tmp/sandstorm-integration-test/tmp',
      telemetryInterval: 30000,
      metricsRetention: 86400,
      enableNetworkIsolation: true,
      vpcMode: false,
    };
    
    agent = new EdgeAgent(config);
  });

  afterAll(async () => {
    if (agent) {
      await agent.stop();
    }
  });

  it.if(process.env.RUN_INTEGRATION_TESTS)(
    'should start agent and handle requests',
    async () => {
      // Start the agent
      await agent.start();
      
      // Wait a moment for startup
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check that it's available
      const available = await agent.isAvailable();
      expect(available).toBe(true);
      
      // Run a simple sandbox
      const result = await agent.run({
        code: 'print("Integration test successful!")',
        language: 'python',
        memory: 256,
        cpu: 0.5,
        timeout: 10000,
      });
      
      expect(result.stdout).toContain('Integration test successful!');
      expect(result.exitCode).toBe(0);
      expect(result.provider).toBe('edge');
    },
    60000
  );

  it.if(process.env.RUN_INTEGRATION_TESTS)(
    'should work with SDK edge mode',
    async () => {
      // Start the agent if not already running
      if (!agent) {
        agent = new EdgeAgent(config);
        await agent.start();
      }
      
      // Create SDK client
      const sandstorm = createSandstormEdge({
        edgeAgents: [{
          agentUrl: `http://127.0.0.1:${config.listenPort}`,
        }],
        preferEdge: true,
      });
      
      // Connect to edge agents
      await sandstorm.connectEdgeAgents();
      
      // Run sandbox via SDK
      const result = await sandstorm.run({
        code: `
import json
import os

data = {
    "message": "SDK integration test",
    "pid": os.getpid(),
    "working_dir": os.getcwd()
}

print(json.dumps(data, indent=2))
`,
        language: 'python',
      });
      
      expect(result.stdout).toContain('SDK integration test');
      expect(result.exitCode).toBe(0);
      
      // Check agent status
      const statuses = await sandstorm.getEdgeAgentsStatus();
      expect(statuses).toHaveLength(1);
      expect(statuses[0].agentId).toBeDefined();
      expect(statuses[0].status).toBe('running');
    },
    60000
  );
});