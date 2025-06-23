import { NodeSSH } from 'node-ssh';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import {
  ISandboxProvider,
  SandboxProvider,
  SandboxSpec,
  SandboxResult,
  SandboxSnapshot,
  BareMetalNode,
} from '@sandstorm/core';
import { BootcBuilder } from '@sandstorm/bootc-builder';
import { BareMetalConfig, NodeProvisioningOptions, NodeSnapshot } from './types';

export class BareMetalProvider implements ISandboxProvider {
  readonly name: SandboxProvider = 'bare-metal';
  private config: BareMetalConfig;
  private bootcBuilder: BootcBuilder;
  private ssh: NodeSSH;
  private activeNodes: Map<string, BareMetalNode>;

  constructor(config: BareMetalConfig) {
    this.config = config;
    this.bootcBuilder = new BootcBuilder();
    this.ssh = new NodeSSH();
    this.activeNodes = new Map();
    
    // Initialize nodes from config
    config.nodes.forEach(node => {
      this.activeNodes.set(node.id, node);
    });
  }

  async isAvailable(): Promise<boolean> {
    // Check if we have any available nodes
    const availableNodes = Array.from(this.activeNodes.values())
      .filter(node => node.status === 'available');
    
    return availableNodes.length > 0;
  }

  async estimateCost(spec: SandboxSpec): Promise<number> {
    // Bare metal typically has fixed costs
    // Estimate based on resource requirements
    const baseCost = 0.50; // Base cost per hour
    const cpuCost = (spec.cpu || 1) * 0.10;
    const memoryCost = ((spec.memory || 512) / 1024) * 0.05;
    const gpuCost = spec.gpu ? 2.00 : 0;
    
    return baseCost + cpuCost + memoryCost + gpuCost;
  }

  async estimateLatency(spec: SandboxSpec): Promise<number> {
    // Bare metal has higher initial provisioning time
    // but lower runtime latency
    const provisioningTime = spec.bootcHash ? 30000 : 120000; // 30s if pre-built, 2min otherwise
    const executionTime = 100; // Very low execution overhead
    
    return provisioningTime + executionTime;
  }

  async run(spec: SandboxSpec): Promise<SandboxResult> {
    const startTime = Date.now();
    const sandboxId = uuidv4();
    
    try {
      // Find an available node that meets requirements
      const node = await this.selectNode(spec);
      if (!node) {
        throw new Error('No available nodes meet the requirements');
      }
      
      // Update node status
      node.status = 'provisioning';
      this.activeNodes.set(node.id, node);
      
      // Build or retrieve bootc image
      let bootcHash = spec.bootcHash;
      if (!bootcHash && spec.dockerfile) {
        const buildResult = await this.bootcBuilder.buildImage({
          baseImage: 'quay.io/fedora/fedora-bootc:40',
          dockerfile: spec.dockerfile,
          packages: spec.requirements,
          bootType: 'efi',
        });
        bootcHash = buildResult.imageHash;
        
        // Push to registry
        await this.bootcBuilder.pushImage(bootcHash, this.config.bootcRegistry);
      }
      
      if (!bootcHash) {
        throw new Error('No bootc image specified and no Dockerfile provided');
      }
      
      // Provision the node with bootc image
      await this.provisionNode({
        nodeId: node.id,
        bootcHash,
      });
      
      // Update node status
      node.status = 'running';
      node.bootcHash = bootcHash;
      this.activeNodes.set(node.id, node);
      
      // Execute the code on the node
      const result = await this.executeOnNode(node, spec);
      
      // Calculate costs
      const duration = Date.now() - startTime;
      const cost = await this.estimateCost(spec) * (duration / 3600000); // Convert to hourly rate
      
      return {
        id: sandboxId,
        provider: this.name,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration,
        cost,
        files: result.files,
        metrics: {
          cpuUsage: result.cpuUsage,
          memoryUsage: result.memoryUsage,
          gpuUsage: spec.gpu ? result.gpuUsage : undefined,
        },
      };
    } catch (error) {
      // Ensure node is marked as available again on error
      const nodes = Array.from(this.activeNodes.values());
      const provisioningNode = nodes.find(n => n.status === 'provisioning');
      if (provisioningNode) {
        provisioningNode.status = 'available';
        this.activeNodes.set(provisioningNode.id, provisioningNode);
      }
      
      throw error;
    }
  }

  async snapshot(sandboxId: string): Promise<SandboxSnapshot> {
    // Find the node running this sandbox
    const node = await this.findNodeBySandbox(sandboxId);
    if (!node) {
      throw new Error(`No node found running sandbox ${sandboxId}`);
    }
    
    // Connect to the node
    await this.connectToNode(node);
    
    // Create filesystem snapshot
    const snapshotId = uuidv4();
    const timestamp = new Date().toISOString();
    
    // Create a filesystem snapshot using LVM or btrfs
    const fsSnapshot = await this.createFilesystemSnapshot(node, snapshotId);
    
    // Optionally capture memory state (if supported)
    let memoryHash: string | undefined;
    if (await this.supportsMemorySnapshot(node)) {
      memoryHash = await this.createMemorySnapshot(node, snapshotId);
    }
    
    // Calculate snapshot size
    const size = await this.getSnapshotSize(node, snapshotId);
    
    return {
      id: snapshotId,
      sandboxId,
      provider: this.name,
      timestamp,
      filesystemHash: fsSnapshot,
      memoryHash,
      size,
      metadata: {
        nodeId: node.id,
        bootcHash: node.bootcHash,
      },
    };
  }

  async restore(snapshotId: string): Promise<string> {
    // Load snapshot metadata
    const snapshot = await this.loadSnapshotMetadata(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    
    // Find an available node
    const node = await this.selectNode({
      code: '',
      language: 'shell',
      cpu: snapshot.metadata.cpu,
      memory: snapshot.metadata.memory,
      gpu: snapshot.metadata.gpu,
    });
    
    if (!node) {
      throw new Error('No available nodes for restore');
    }
    
    // Provision node with the same bootc image
    await this.provisionNode({
      nodeId: node.id,
      bootcHash: snapshot.metadata.bootcHash,
    });
    
    // Restore filesystem snapshot
    await this.restoreFilesystemSnapshot(node, snapshot);
    
    // Restore memory snapshot if available
    if (snapshot.memorySnapshot) {
      await this.restoreMemorySnapshot(node, snapshot);
    }
    
    const newSandboxId = uuidv4();
    return newSandboxId;
  }

  async getQuota(): Promise<{ used: number; limit: number }> {
    const totalNodes = this.activeNodes.size;
    const usedNodes = Array.from(this.activeNodes.values())
      .filter(node => node.status === 'running').length;
    
    return {
      used: usedNodes,
      limit: totalNodes,
    };
  }

  private async selectNode(spec: SandboxSpec): Promise<BareMetalNode | null> {
    const availableNodes = Array.from(this.activeNodes.values())
      .filter(node => node.status === 'available');
    
    // Filter by requirements
    const suitableNodes = availableNodes.filter(node => {
      if (spec.cpu && node.specs.cpu < spec.cpu) return false;
      if (spec.memory && node.specs.memory < spec.memory) return false;
      if (spec.gpu && !node.specs.gpu) return false;
      if (spec.gpuType && node.specs.gpuType !== spec.gpuType) return false;
      return true;
    });
    
    // Return the first suitable node
    return suitableNodes[0] || null;
  }

  private async provisionNode(options: NodeProvisioningOptions): Promise<void> {
    const node = this.activeNodes.get(options.nodeId);
    if (!node) {
      throw new Error(`Node ${options.nodeId} not found`);
    }
    
    // Generate iPXE boot script
    const bootScript = this.generateIPXEScript(options.bootcHash);
    
    // Configure node to boot from iPXE
    await this.configureNodeBoot(node, bootScript);
    
    // Reboot the node
    await this.rebootNode(node);
    
    // Wait for node to come online
    await this.waitForNode(node);
  }

  private async executeOnNode(
    node: BareMetalNode,
    spec: SandboxSpec
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    files?: Record<string, string>;
    cpuUsage?: number;
    memoryUsage?: number;
    gpuUsage?: number;
  }> {
    // Connect to the node
    await this.connectToNode(node);
    
    // Create temporary directory
    const workDir = `/tmp/sandstorm-${Date.now()}`;
    await this.ssh.execCommand(`mkdir -p ${workDir}`);
    
    // Write code to file
    const codeFile = `${workDir}/code.${this.getFileExtension(spec.language)}`;
    await this.ssh.execCommand(`cat > ${codeFile}`, {
      stdin: spec.code,
    });
    
    // Write any additional files
    if (spec.files) {
      for (const [path, content] of Object.entries(spec.files)) {
        const fullPath = `${workDir}/${path}`;
        await this.ssh.execCommand(`mkdir -p $(dirname ${fullPath})`);
        await this.ssh.execCommand(`cat > ${fullPath}`, {
          stdin: content,
        });
      }
    }
    
    // Set environment variables
    let envVars = '';
    if (spec.environment) {
      envVars = Object.entries(spec.environment)
        .map(([key, value]) => `export ${key}="${value}"`)
        .join('; ') + '; ';
    }
    
    // Execute the code
    const command = this.getExecutionCommand(spec.language, codeFile);
    const timeout = spec.timeout || 300000; // Default 5 minutes
    
    const startTime = Date.now();
    const result = await this.ssh.execCommand(
      `${envVars}timeout ${Math.ceil(timeout / 1000)} ${command}`,
      {
        cwd: workDir,
      }
    );
    const executionTime = Date.now() - startTime;
    
    // Collect metrics
    const metrics = await this.collectMetrics(node);
    
    // Collect output files if stateful
    let files: Record<string, string> | undefined;
    if (spec.stateful) {
      files = await this.collectOutputFiles(workDir);
    }
    
    // Cleanup
    await this.ssh.execCommand(`rm -rf ${workDir}`);
    
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code || 0,
      files,
      cpuUsage: metrics.cpu,
      memoryUsage: metrics.memory,
      gpuUsage: metrics.gpu,
    };
  }

  private async connectToNode(node: BareMetalNode): Promise<void> {
    await this.ssh.connect({
      host: node.ipAddress,
      username: this.config.sshConfig.username,
      privateKey: this.config.sshConfig.privateKey,
      password: this.config.sshConfig.password,
      port: this.config.sshConfig.port || 22,
    });
  }

  private generateIPXEScript(bootcHash: string): string {
    return `#!ipxe
kernel ${this.config.bootcRegistry}/sandstorm/bootc-${bootcHash}/kernel
initrd ${this.config.bootcRegistry}/sandstorm/bootc-${bootcHash}/initrd
imgargs kernel root=live:${this.config.bootcRegistry}/sandstorm/bootc-${bootcHash}/rootfs.img
boot`;
  }

  private async configureNodeBoot(node: BareMetalNode, bootScript: string): Promise<void> {
    // This would typically involve IPMI/Redfish API calls
    // For now, we'll simulate it
    console.log(`Configuring node ${node.id} to boot from iPXE`);
  }

  private async rebootNode(node: BareMetalNode): Promise<void> {
    // Use IPMI or Redfish to reboot
    console.log(`Rebooting node ${node.id}`);
  }

  private async waitForNode(node: BareMetalNode): Promise<void> {
    // Wait for node to come online
    const maxAttempts = 60;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        await this.ssh.connect({
          host: node.ipAddress,
          username: this.config.sshConfig.username,
          privateKey: this.config.sshConfig.privateKey,
          password: this.config.sshConfig.password,
          port: this.config.sshConfig.port || 22,
          readyTimeout: 5000,
        });
        await this.ssh.dispose();
        return;
      } catch (error) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    throw new Error(`Node ${node.id} failed to come online`);
  }

  private getFileExtension(language: string): string {
    const extensions: Record<string, string> = {
      python: 'py',
      javascript: 'js',
      typescript: 'ts',
      go: 'go',
      rust: 'rs',
      java: 'java',
      cpp: 'cpp',
      shell: 'sh',
    };
    return extensions[language] || 'txt';
  }

  private getExecutionCommand(language: string, codeFile: string): string {
    const commands: Record<string, string> = {
      python: `python3 ${codeFile}`,
      javascript: `node ${codeFile}`,
      typescript: `npx ts-node ${codeFile}`,
      go: `go run ${codeFile}`,
      rust: `rustc ${codeFile} -o /tmp/rust_binary && /tmp/rust_binary`,
      java: `javac ${codeFile} && java ${codeFile.replace('.java', '')}`,
      cpp: `g++ ${codeFile} -o /tmp/cpp_binary && /tmp/cpp_binary`,
      shell: `bash ${codeFile}`,
    };
    return commands[language] || `cat ${codeFile}`;
  }

  private async collectMetrics(node: BareMetalNode): Promise<{
    cpu: number;
    memory: number;
    gpu?: number;
  }> {
    // Collect CPU usage
    const cpuResult = await this.ssh.execCommand(
      "top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1"
    );
    const cpu = parseFloat(cpuResult.stdout) || 0;
    
    // Collect memory usage
    const memResult = await this.ssh.execCommand(
      "free -m | awk 'NR==2{printf \"%.2f\", $3*100/$2}'"
    );
    const memory = parseFloat(memResult.stdout) || 0;
    
    // Collect GPU usage if applicable
    let gpu: number | undefined;
    if (node.specs.gpu) {
      const gpuResult = await this.ssh.execCommand(
        "nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null || echo '0'"
      );
      gpu = parseFloat(gpuResult.stdout) || 0;
    }
    
    return { cpu, memory, gpu };
  }

  private async collectOutputFiles(workDir: string): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    
    // List all files in the work directory
    const result = await this.ssh.execCommand(`find ${workDir} -type f`);
    const filePaths = result.stdout.split('\n').filter(path => path.trim());
    
    // Read each file
    for (const filePath of filePaths) {
      const relativePath = filePath.replace(`${workDir}/`, '');
      const content = await this.ssh.execCommand(`cat ${filePath}`);
      files[relativePath] = content.stdout;
    }
    
    return files;
  }

  private async findNodeBySandbox(sandboxId: string): Promise<BareMetalNode | null> {
    // In a real implementation, this would query a database
    // For now, return the first running node
    const runningNodes = Array.from(this.activeNodes.values())
      .filter(node => node.status === 'running');
    return runningNodes[0] || null;
  }

  private async createFilesystemSnapshot(node: BareMetalNode, snapshotId: string): Promise<string> {
    // Create LVM snapshot
    await this.ssh.execCommand(
      `lvcreate -L10G -s -n snapshot-${snapshotId} /dev/vg0/root`
    );
    
    // Calculate hash
    const hashResult = await this.ssh.execCommand(
      `sha256sum /dev/vg0/snapshot-${snapshotId} | awk '{print $1}'`
    );
    
    return hashResult.stdout.trim();
  }

  private async supportsMemorySnapshot(node: BareMetalNode): Promise<boolean> {
    // Check if CRIU is installed
    const result = await this.ssh.execCommand('which criu');
    return result.code === 0;
  }

  private async createMemorySnapshot(node: BareMetalNode, snapshotId: string): Promise<string> {
    // Use CRIU to create memory snapshot
    const snapshotDir = `${this.config.snapshotStoragePath}/${snapshotId}`;
    await this.ssh.execCommand(`mkdir -p ${snapshotDir}`);
    await this.ssh.execCommand(
      `criu dump -t 1 -D ${snapshotDir} --shell-job`
    );
    
    // Calculate hash
    const hashResult = await this.ssh.execCommand(
      `find ${snapshotDir} -type f -exec sha256sum {} \\; | sha256sum | awk '{print $1}'`
    );
    
    return hashResult.stdout.trim();
  }

  private async getSnapshotSize(node: BareMetalNode, snapshotId: string): Promise<number> {
    // Get LVM snapshot size
    const result = await this.ssh.execCommand(
      `lvs --noheadings -o size /dev/vg0/snapshot-${snapshotId} | awk '{print $1}'`
    );
    
    // Convert to bytes (assuming output is in GB)
    const sizeStr = result.stdout.trim();
    const size = parseFloat(sizeStr) * 1024 * 1024 * 1024;
    
    return size;
  }

  private async loadSnapshotMetadata(snapshotId: string): Promise<NodeSnapshot | null> {
    // In a real implementation, this would load from a database
    // For now, return a mock
    return null;
  }

  private async restoreFilesystemSnapshot(node: BareMetalNode, snapshot: NodeSnapshot): Promise<void> {
    // Restore LVM snapshot
    console.log(`Restoring filesystem snapshot ${snapshot.filesystemSnapshot} to node ${node.id}`);
  }

  private async restoreMemorySnapshot(node: BareMetalNode, snapshot: NodeSnapshot): Promise<void> {
    // Restore CRIU snapshot
    console.log(`Restoring memory snapshot to node ${node.id}`);
  }
}