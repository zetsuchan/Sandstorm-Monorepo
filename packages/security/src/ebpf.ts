import { EventEmitter } from 'eventemitter3';
import { spawn, ChildProcess } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import pino from 'pino';
import { IEbpfMonitor } from './interfaces';
import { MonitoringConfig } from './types';

interface EbpfProgram {
  id: string;
  path: string;
  attachPoint: string;
  process?: ChildProcess;
}

export class EbpfMonitor extends EventEmitter implements IEbpfMonitor {
  private logger = pino({ name: 'ebpf-monitor' });
  private config?: MonitoringConfig['ebpf'];
  private programs = new Map<string, EbpfProgram>();
  private maps = new Map<string, any>();

  async initialize(config: MonitoringConfig['ebpf']): Promise<void> {
    this.config = config;
    if (!config?.enabled) {
      this.logger.info('eBPF monitoring disabled');
      return;
    }

    // Load default programs if specified
    if (config.programs) {
      for (const programPath of config.programs) {
        const attachPoint = this.inferAttachPoint(programPath);
        await this.attachProgram(programPath, attachPoint);
      }
    }

    // Initialize maps
    if (config.maps) {
      for (const [name, config] of Object.entries(config.maps)) {
        this.maps.set(name, config);
      }
    }
  }

  async attachProgram(programPath: string, attachPoint: string): Promise<void> {
    const id = `${programPath}_${attachPoint}_${Date.now()}`;
    
    try {
      // Compile eBPF program if needed
      const compiledPath = await this.compileProgram(programPath);
      
      // Attach using bpftool or custom loader
      const process = spawn('bpftool', [
        'prog', 'load',
        compiledPath,
        '/sys/fs/bpf/' + id,
        'type', this.getProgType(attachPoint),
        'attach', attachPoint,
      ]);

      process.on('error', (error) => {
        this.logger.error({ error, programPath }, 'Failed to attach eBPF program');
      });

      process.stdout?.on('data', (data) => {
        this.processEbpfOutput(id, data);
      });

      this.programs.set(id, {
        id,
        path: programPath,
        attachPoint,
        process,
      });

      this.logger.info({ id, programPath, attachPoint }, 'Attached eBPF program');
    } catch (error) {
      this.logger.error({ error, programPath, attachPoint }, 'Failed to attach eBPF program');
      throw error;
    }
  }

  async detachProgram(programId: string): Promise<void> {
    const program = this.programs.get(programId);
    if (!program) {
      throw new Error(`Program ${programId} not found`);
    }

    // Detach using bpftool
    const detachProcess = spawn('bpftool', [
      'prog', 'detach',
      '/sys/fs/bpf/' + programId,
    ]);

    await new Promise((resolve, reject) => {
      detachProcess.on('exit', (code) => {
        if (code === 0) {
          resolve(undefined);
        } else {
          reject(new Error(`Failed to detach program: exit code ${code}`));
        }
      });
    });

    if (program.process) {
      program.process.kill('SIGTERM');
    }

    this.programs.delete(programId);
    this.logger.info({ programId }, 'Detached eBPF program');
  }

  async readMap(mapName: string): Promise<any> {
    const mapPath = `/sys/fs/bpf/${mapName}`;
    
    return new Promise((resolve, reject) => {
      const process = spawn('bpftool', [
        'map', 'dump',
        'name', mapName,
        '-j', // JSON output
      ]);

      let output = '';
      process.stdout?.on('data', (data) => {
        output += data.toString();
      });

      process.on('exit', (code) => {
        if (code === 0) {
          try {
            resolve(JSON.parse(output));
          } catch (error) {
            reject(error);
          }
        } else {
          reject(new Error(`Failed to read map: exit code ${code}`));
        }
      });
    });
  }

  onTrace(callback: (trace: any) => void): void {
    this.on('trace', callback);
  }

  async getLoadedPrograms(): Promise<string[]> {
    return Array.from(this.programs.keys());
  }

  private async compileProgram(programPath: string): Promise<string> {
    // Check if it's already compiled
    if (programPath.endsWith('.o')) {
      return programPath;
    }

    // Compile C to eBPF bytecode
    const outputPath = join(tmpdir(), `ebpf_${Date.now()}.o`);
    
    const compileProcess = spawn('clang', [
      '-O2',
      '-target', 'bpf',
      '-c', programPath,
      '-o', outputPath,
    ]);

    await new Promise((resolve, reject) => {
      compileProcess.on('exit', (code) => {
        if (code === 0) {
          resolve(undefined);
        } else {
          reject(new Error(`Compilation failed: exit code ${code}`));
        }
      });
    });

    return outputPath;
  }

  private inferAttachPoint(programPath: string): string {
    // Infer attach point from program name or content
    const filename = programPath.split('/').pop() || '';
    
    if (filename.includes('syscall')) {
      return 'tracepoint/syscalls/sys_enter_open';
    } else if (filename.includes('network')) {
      return 'xdp';
    } else if (filename.includes('process')) {
      return 'tracepoint/sched/sched_process_exec';
    }
    
    return 'kprobe/__x64_sys_open';
  }

  private getProgType(attachPoint: string): string {
    if (attachPoint.startsWith('tracepoint/')) {
      return 'tracepoint';
    } else if (attachPoint === 'xdp') {
      return 'xdp';
    } else if (attachPoint.startsWith('kprobe/')) {
      return 'kprobe';
    }
    return 'raw_tracepoint';
  }

  private processEbpfOutput(programId: string, data: Buffer): void {
    try {
      const trace = JSON.parse(data.toString());
      this.emit('trace', {
        programId,
        timestamp: new Date().toISOString(),
        ...trace,
      });
    } catch {
      // Not JSON, emit raw
      this.emit('trace', {
        programId,
        timestamp: new Date().toISOString(),
        raw: data.toString(),
      });
    }
  }
}

// Example eBPF program for file access monitoring
export const FILE_ACCESS_MONITOR = `
#include <linux/bpf.h>
#include <linux/ptrace.h>
#include <linux/sched.h>

struct file_access_event {
    u32 pid;
    u32 uid;
    char filename[256];
    u64 timestamp;
};

BPF_PERF_OUTPUT(events);

int trace_open(struct pt_regs *ctx, const char __user *filename, int flags) {
    struct file_access_event event = {};
    
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.timestamp = bpf_ktime_get_ns();
    
    bpf_probe_read_user_str(&event.filename, sizeof(event.filename), filename);
    
    events.perf_submit(ctx, &event, sizeof(event));
    
    return 0;
}
`;

// Example eBPF program for network monitoring
export const NETWORK_MONITOR = `
#include <linux/bpf.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/tcp.h>

struct network_event {
    u32 src_ip;
    u32 dst_ip;
    u16 src_port;
    u16 dst_port;
    u64 bytes;
};

BPF_HASH(flows, struct network_event, u64);

int xdp_monitor(struct xdp_md *ctx) {
    void *data_end = (void *)(long)ctx->data_end;
    void *data = (void *)(long)ctx->data;
    
    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end)
        return XDP_PASS;
    
    if (eth->h_proto != htons(ETH_P_IP))
        return XDP_PASS;
    
    struct iphdr *ip = (void *)(eth + 1);
    if ((void *)(ip + 1) > data_end)
        return XDP_PASS;
    
    if (ip->protocol != IPPROTO_TCP)
        return XDP_PASS;
    
    struct tcphdr *tcp = (void *)ip + (ip->ihl * 4);
    if ((void *)(tcp + 1) > data_end)
        return XDP_PASS;
    
    struct network_event flow = {
        .src_ip = ip->saddr,
        .dst_ip = ip->daddr,
        .src_port = tcp->source,
        .dst_port = tcp->dest,
        .bytes = data_end - data,
    };
    
    u64 *count = flows.lookup(&flow);
    if (count) {
        __sync_fetch_and_add(count, flow.bytes);
    } else {
        flows.update(&flow, &flow.bytes);
    }
    
    return XDP_PASS;
}
`;