#!/usr/bin/env node

import { Command } from 'commander';
import { createEdgeAgent } from './factory';
import * as fs from 'fs/promises';
import * as path from 'path';
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

const program = new Command();

program
  .name('sandstorm-edge')
  .description('Sandstorm Edge Agent - Run sandboxes on your infrastructure')
  .version('0.0.1');

program
  .command('start')
  .description('Start the edge agent')
  .option('-k, --api-key <key>', 'Sandstorm API key (or SANDSTORM_API_KEY env var)')
  .option('-u, --cloud-url <url>', 'Sandstorm Cloud API URL', 'https://api.sandstorm.dev')
  .option('-n, --name <name>', 'Agent name')
  .option('-p, --port <port>', 'Listen port', '8080')
  .option('-r, --runtime <runtime>', 'Container runtime (podman or docker)', 'podman')
  .option('--no-rootless', 'Disable rootless mode')
  .option('--max-sandboxes <n>', 'Maximum concurrent sandboxes', '10')
  .option('--max-memory <mb>', 'Maximum memory in MB')
  .option('--max-cpu <cores>', 'Maximum CPU cores')
  .option('--work-dir <path>', 'Working directory')
  .option('--vpc-mode', 'Enable VPC mode (no internet access)')
  .option('--no-network-isolation', 'Disable network isolation')
  .option('-c, --config <file>', 'Load configuration from file')
  .action(async (options) => {
    try {
      // Load config from file if provided
      let config = {};
      if (options.config) {
        const configPath = path.resolve(options.config);
        const configContent = await fs.readFile(configPath, 'utf-8');
        config = JSON.parse(configContent);
      }
      
      // Override with CLI options
      const finalConfig = {
        ...config,
        apiKey: options.apiKey || process.env.SANDSTORM_API_KEY,
        cloudApiUrl: options.cloudUrl,
        agentName: options.name,
        port: parseInt(options.port),
        runtime: options.runtime,
        rootless: options.rootless,
        maxConcurrentSandboxes: options.maxSandboxes ? parseInt(options.maxSandboxes) : undefined,
        maxMemoryMB: options.maxMemory ? parseInt(options.maxMemory) : undefined,
        maxCpuCores: options.maxCpu ? parseInt(options.maxCpu) : undefined,
        workDir: options.workDir,
        vpcMode: options.vpcMode,
        enableNetworkIsolation: options.networkIsolation,
      };
      
      // Validate API key
      if (!finalConfig.apiKey && !options.vpcMode) {
        logger.warn('No API key provided. Running in offline mode.');
      }
      
      // Create and start agent
      logger.info('Starting Sandstorm Edge Agent...');
      const agent = await createEdgeAgent(finalConfig);
      await agent.start();
      
      logger.info('Edge agent is running. Press Ctrl+C to stop.');
      
      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        logger.info('Shutting down...');
        await agent.stop();
        process.exit(0);
      });
      
      process.on('SIGTERM', async () => {
        logger.info('Shutting down...');
        await agent.stop();
        process.exit(0);
      });
    } catch (error) {
      logger.error('Failed to start edge agent:', error);
      process.exit(1);
    }
  });

program
  .command('check')
  .description('Check system requirements and runtime availability')
  .option('-r, --runtime <runtime>', 'Container runtime to check', 'podman')
  .action(async (options) => {
    logger.info('Checking system requirements...');
    
    // Check runtime
    try {
      const { execSync } = require('child_process');
      const version = execSync(`${options.runtime} --version`).toString();
      logger.info(`✓ ${options.runtime} is available: ${version.trim()}`);
    } catch {
      logger.error(`✗ ${options.runtime} is not available`);
      process.exit(1);
    }
    
    // Check rootless support
    if (options.runtime === 'podman') {
      try {
        const uid = process.getuid?.() || 1000;
        const socketPath = `/run/user/${uid}/podman/podman.sock`;
        await fs.access(socketPath);
        logger.info(`✓ Rootless socket found at ${socketPath}`);
      } catch {
        logger.warn('✗ Rootless socket not found (will use podman command directly)');
      }
    }
    
    // Check system resources
    const os = await import('os');
    const totalMemory = Math.floor(os.totalmem() / (1024 * 1024));
    const cpuCores = os.cpus().length;
    
    logger.info(`✓ System resources: ${cpuCores} CPU cores, ${totalMemory} MB memory`);
    
    // Check network
    try {
      const { execSync } = require('child_process');
      execSync('ping -c 1 api.sandstorm.dev > /dev/null 2>&1');
      logger.info('✓ Network connectivity to Sandstorm Cloud');
    } catch {
      logger.warn('✗ Cannot reach Sandstorm Cloud (VPC mode may be required)');
    }
    
    logger.info('System check complete!');
  });

program
  .command('init')
  .description('Initialize edge agent configuration')
  .option('-o, --output <file>', 'Output file', 'sandstorm-edge.json')
  .action(async (options) => {
    const os = await import('os');
    const config = {
      agentName: `edge-${os.hostname()}`,
      apiKey: '<your-api-key>',
      cloudApiUrl: 'https://api.sandstorm.dev',
      runtime: 'podman',
      rootless: true,
      port: 8080,
      maxConcurrentSandboxes: 10,
      enableNetworkIsolation: true,
      vpcMode: false,
    };
    
    await fs.writeFile(options.output, JSON.stringify(config, null, 2));
    logger.info(`Configuration template written to ${options.output}`);
    logger.info('Edit the file and add your API key, then run: sandstorm-edge start -c sandstorm-edge.json');
  });

program.parse();