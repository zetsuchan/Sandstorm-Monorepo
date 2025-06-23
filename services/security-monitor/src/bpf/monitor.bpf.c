#include <linux/bpf.h>
#include <linux/ptrace.h>
#include <linux/sched.h>
#include <linux/fs.h>
#include <linux/uaccess.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

// Event types
#define EVENT_FILE_ACCESS 1
#define EVENT_PROCESS_SPAWN 2
#define EVENT_NETWORK_ACTIVITY 3
#define EVENT_PRIVILEGE_ESCALATION 4

// Event structure
struct security_event {
    __u32 event_type;
    __u32 pid;
    __u32 uid;
    __u32 gid;
    __u64 timestamp;
    char comm[16];
    char filename[256];
    __u32 flags;
    __u32 mode;
};

// Maps
struct {
    __uint(type, BPF_MAP_TYPE_PERF_EVENT_ARRAY);
    __uint(key_size, sizeof(__u32));
    __uint(value_size, sizeof(__u32));
} events SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __uint(key_size, sizeof(__u32));
    __uint(value_size, sizeof(__u64));
} process_start_times SEC(".maps");

// Helper function to get current task
static inline struct task_struct *get_current_task() {
    return (struct task_struct *)bpf_get_current_task();
}

// File access monitoring
SEC("tracepoint/syscalls/sys_enter_openat")
int trace_openat(struct trace_event_raw_sys_enter *ctx) {
    struct security_event event = {};
    
    // Get current process info
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    event.pid = pid_tgid >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.gid = (bpf_get_current_uid_gid() >> 32) & 0xFFFFFFFF;
    event.timestamp = bpf_ktime_get_ns();
    event.event_type = EVENT_FILE_ACCESS;
    
    // Get process name
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    
    // Get filename from syscall arguments
    char *filename = (char *)ctx->args[1];
    bpf_probe_read_user_str(&event.filename, sizeof(event.filename), filename);
    
    // Get flags and mode
    event.flags = (__u32)ctx->args[2];
    event.mode = (__u32)ctx->args[3];
    
    // Send event to userspace
    bpf_perf_event_output(ctx, &events, BPF_F_CURRENT_CPU, &event, sizeof(event));
    
    return 0;
}

// Process execution monitoring
SEC("tracepoint/sched/sched_process_exec")
int trace_process_exec(struct trace_event_raw_sched_process_exec *ctx) {
    struct security_event event = {};
    
    // Get current process info
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    event.pid = pid_tgid >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.gid = (bpf_get_current_uid_gid() >> 32) & 0xFFFFFFFF;
    event.timestamp = bpf_ktime_get_ns();
    event.event_type = EVENT_PROCESS_SPAWN;
    
    // Get process name
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    
    // Get filename from exec
    bpf_probe_read_kernel_str(&event.filename, sizeof(event.filename), ctx->filename);
    
    // Store process start time
    bpf_map_update_elem(&process_start_times, &event.pid, &event.timestamp, BPF_ANY);
    
    // Send event to userspace
    bpf_perf_event_output(ctx, &events, BPF_F_CURRENT_CPU, &event, sizeof(event));
    
    return 0;
}

// Privilege escalation monitoring (setuid/setgid)
SEC("tracepoint/syscalls/sys_enter_setuid")
int trace_setuid(struct trace_event_raw_sys_enter *ctx) {
    struct security_event event = {};
    
    // Get current process info
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    event.pid = pid_tgid >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.gid = (bpf_get_current_uid_gid() >> 32) & 0xFFFFFFFF;
    event.timestamp = bpf_ktime_get_ns();
    event.event_type = EVENT_PRIVILEGE_ESCALATION;
    
    // Get process name
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    
    // Get new uid from syscall argument
    __u32 new_uid = (__u32)ctx->args[0];
    
    // Only trigger if trying to escalate to root or changing from non-root
    if (new_uid == 0 || (event.uid != 0 && new_uid != event.uid)) {
        // Send event to userspace
        bpf_perf_event_output(ctx, &events, BPF_F_CURRENT_CPU, &event, sizeof(event));
    }
    
    return 0;
}

// Network monitoring (simplified - would need more comprehensive implementation)
SEC("kprobe/tcp_v4_connect")
int trace_tcp_connect(struct pt_regs *ctx) {
    struct security_event event = {};
    
    // Get current process info
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    event.pid = pid_tgid >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.gid = (bpf_get_current_uid_gid() >> 32) & 0xFFFFFFFF;
    event.timestamp = bpf_ktime_get_ns();
    event.event_type = EVENT_NETWORK_ACTIVITY;
    
    // Get process name
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    
    // Send event to userspace
    bpf_perf_event_output(ctx, &events, BPF_F_CURRENT_CPU, &event, sizeof(event));
    
    return 0;
}

// License
char _license[] SEC("license") = "GPL";