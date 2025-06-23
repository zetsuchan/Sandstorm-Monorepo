use super::*;
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;
use tracing::{error, info};

/// gVisor (runsc) runtime implementation for standard isolation
pub struct GvisorRuntime {
    /// Path to runsc binary
    runsc_bin: PathBuf,
    /// Base directory for container storage
    base_dir: PathBuf,
    /// Runtime root directory
    runtime_root: PathBuf,
    /// Active sandboxes
    sandboxes: RwLock<HashMap<Uuid, SandboxInfo>>,
}

#[derive(Debug, Clone)]
struct SandboxInfo {
    container_id: String,
    bundle_path: PathBuf,
    state: SandboxState,
    config: SandboxConfig,
    created_at: chrono::DateTime<chrono::Utc>,
    started_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl GvisorRuntime {
    /// Create a new gVisor runtime
    pub fn new(runsc_bin: PathBuf, base_dir: PathBuf) -> Result<Self> {
        // Verify binary exists
        if !runsc_bin.exists() {
            anyhow::bail!("runsc binary not found at {:?}", runsc_bin);
        }

        // Create directories
        std::fs::create_dir_all(&base_dir)
            .context("Failed to create base directory")?;
        
        let runtime_root = base_dir.join("runtime");
        std::fs::create_dir_all(&runtime_root)
            .context("Failed to create runtime root directory")?;

        Ok(Self {
            runsc_bin,
            base_dir,
            runtime_root,
            sandboxes: RwLock::new(HashMap::new()),
        })
    }

    /// Create OCI runtime spec
    async fn create_oci_spec(&self, config: &SandboxConfig) -> Result<serde_json::Value> {
        let mut env = vec![
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin".to_string(),
            "TERM=xterm".to_string(),
        ];

        for (key, value) in &config.environment {
            env.push(format!("{}={}", key, value));
        }

        let cpu_quota = config.cpu_limit.map(|cpu| (cpu * 100000.0) as i64);
        let memory_limit = config.memory_limit.map(|mem| mem as i64);

        let mut mounts = vec![
            serde_json::json!({
                "destination": "/proc",
                "type": "proc",
                "source": "proc"
            }),
            serde_json::json!({
                "destination": "/dev",
                "type": "tmpfs",
                "source": "tmpfs",
                "options": ["nosuid", "strictatime", "mode=755", "size=65536k"]
            }),
            serde_json::json!({
                "destination": "/sys",
                "type": "sysfs",
                "source": "sysfs",
                "options": ["nosuid", "noexec", "nodev", "ro"]
            }),
        ];

        // Add custom mounts
        for mount in &config.mounts {
            mounts.push(serde_json::json!({
                "destination": mount.destination,
                "source": mount.source,
                "options": if mount.read_only { vec!["ro"] } else { vec!["rw"] }
            }));
        }

        Ok(serde_json::json!({
            "ociVersion": "1.0.2",
            "process": {
                "terminal": false,
                "user": {
                    "uid": 1000,
                    "gid": 1000
                },
                "args": config.command,
                "env": env,
                "cwd": config.working_dir.as_deref().unwrap_or("/"),
                "capabilities": {
                    "bounding": ["CAP_AUDIT_WRITE", "CAP_KILL", "CAP_NET_BIND_SERVICE"],
                    "effective": ["CAP_AUDIT_WRITE", "CAP_KILL", "CAP_NET_BIND_SERVICE"],
                    "inheritable": ["CAP_AUDIT_WRITE", "CAP_KILL", "CAP_NET_BIND_SERVICE"],
                    "permitted": ["CAP_AUDIT_WRITE", "CAP_KILL", "CAP_NET_BIND_SERVICE"],
                    "ambient": ["CAP_AUDIT_WRITE", "CAP_KILL", "CAP_NET_BIND_SERVICE"]
                },
                "rlimits": [{
                    "type": "RLIMIT_NOFILE",
                    "hard": 1024,
                    "soft": 1024
                }],
                "noNewPrivileges": true
            },
            "root": {
                "path": "rootfs",
                "readonly": false
            },
            "hostname": format!("sandbox-{}", config.id),
            "mounts": mounts,
            "linux": {
                "resources": {
                    "devices": [{
                        "allow": false,
                        "access": "rwm"
                    }],
                    "cpu": {
                        "quota": cpu_quota,
                        "period": 100000
                    },
                    "memory": {
                        "limit": memory_limit
                    }
                },
                "namespaces": [
                    {"type": "pid"},
                    {"type": "network"},
                    {"type": "ipc"},
                    {"type": "uts"},
                    {"type": "mount"}
                ],
                "seccomp": {
                    "defaultAction": "SCMP_ACT_ERRNO",
                    "architectures": ["SCMP_ARCH_X86_64"],
                    "syscalls": [{
                        "names": [
                            "accept", "accept4", "access", "arch_prctl", "bind", "brk",
                            "capget", "capset", "clone", "close", "connect", "dup", "dup2",
                            "epoll_create", "epoll_create1", "epoll_ctl", "epoll_wait",
                            "execve", "exit", "exit_group", "fcntl", "fstat", "futex",
                            "getcwd", "getdents", "getdents64", "getegid", "geteuid",
                            "getgid", "getpgrp", "getpid", "getppid", "getrlimit",
                            "getsockname", "getsockopt", "gettid", "getuid", "ioctl",
                            "lseek", "madvise", "mmap", "mprotect", "munmap", "nanosleep",
                            "open", "openat", "pipe", "pipe2", "poll", "pread64", "prlimit64",
                            "pwrite64", "read", "readv", "recvfrom", "recvmsg", "rt_sigaction",
                            "rt_sigprocmask", "rt_sigreturn", "sched_getaffinity", "sched_yield",
                            "sendmsg", "sendto", "set_robust_list", "set_tid_address",
                            "setsockopt", "sigaltstack", "socket", "stat", "statfs", "sysinfo",
                            "tgkill", "uname", "unlink", "wait4", "write", "writev"
                        ],
                        "action": "SCMP_ACT_ALLOW"
                    }]
                }
            }
        }))
    }

    /// Create container bundle
    async fn create_bundle(&self, config: &SandboxConfig) -> Result<PathBuf> {
        let bundle_path = self.base_dir.join(config.id.to_string());
        let rootfs_path = bundle_path.join("rootfs");

        // Create bundle directory structure
        std::fs::create_dir_all(&bundle_path)?;
        std::fs::create_dir_all(&rootfs_path)?;

        // Create OCI spec
        let spec = self.create_oci_spec(config).await?;
        let spec_path = bundle_path.join("config.json");
        std::fs::write(&spec_path, serde_json::to_string_pretty(&spec)?)?;

        // Extract rootfs from image (simplified - in reality would use proper OCI image handling)
        // For now, create a minimal rootfs
        let dirs = ["bin", "dev", "etc", "home", "lib", "lib64", "proc", "root", "sys", "tmp", "usr", "var"];
        for dir in dirs {
            std::fs::create_dir_all(rootfs_path.join(dir))?;
        }

        Ok(bundle_path)
    }
}

#[async_trait]
impl SandboxRuntime for GvisorRuntime {
    fn runtime_type(&self) -> RuntimeType {
        RuntimeType::Gvisor
    }

    fn supports_isolation_level(&self, level: IsolationLevel) -> bool {
        // gVisor provides standard to strong isolation through kernel syscall interception
        matches!(level, IsolationLevel::Standard | IsolationLevel::Strong)
    }

    async fn create(&self, config: &SandboxConfig) -> Result<Uuid> {
        let sandbox_id = config.id;
        let container_id = format!("gvisor-{}", sandbox_id);

        // Create container bundle
        let bundle_path = self.create_bundle(config).await?;

        // Create container using runsc
        let mut cmd = Command::new(&self.runsc_bin);
        cmd.args([
            "--root", self.runtime_root.to_str().unwrap(),
            "create",
            "--bundle", bundle_path.to_str().unwrap(),
            &container_id,
        ]);

        cmd.stderr(Stdio::piped());
        let output = cmd.output().await.context("Failed to create gVisor container")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to create container: {}", stderr);
        }

        // Start the container
        let mut cmd = Command::new(&self.runsc_bin);
        cmd.args([
            "--root", self.runtime_root.to_str().unwrap(),
            "start",
            &container_id,
        ]);

        let output = cmd.output().await.context("Failed to start gVisor container")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to start container: {}", stderr);
        }

        // Store sandbox info
        let info = SandboxInfo {
            container_id,
            bundle_path,
            state: SandboxState::Running,
            config: config.clone(),
            created_at: chrono::Utc::now(),
            started_at: Some(chrono::Utc::now()),
        };

        let mut sandboxes = self.sandboxes.write().await;
        sandboxes.insert(sandbox_id, info);

        info!("Created gVisor sandbox {}", sandbox_id);
        Ok(sandbox_id)
    }

    async fn exec(
        &self,
        sandbox_id: Uuid,
        command: Vec<String>,
        environment: Option<HashMap<String, String>>,
    ) -> Result<SandboxResult> {
        let sandboxes = self.sandboxes.read().await;
        let info = sandboxes.get(&sandbox_id)
            .ok_or_else(|| anyhow::anyhow!("Sandbox {} not found", sandbox_id))?;

        if info.state != SandboxState::Running {
            anyhow::bail!("Sandbox {} is not running", sandbox_id);
        }

        let start_time = std::time::Instant::now();

        // Execute command in container
        let mut cmd = Command::new(&self.runsc_bin);
        cmd.args([
            "--root", self.runtime_root.to_str().unwrap(),
            "exec",
            &info.container_id,
        ]);

        // Add environment variables
        if let Some(env) = environment {
            for (key, value) in env {
                cmd.arg("-e").arg(format!("{}={}", key, value));
            }
        }

        // Add command
        cmd.args(&command);

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let output = cmd.output().await.context("Failed to execute command in container")?;
        let duration_ms = start_time.elapsed().as_millis() as u64;

        Ok(SandboxResult {
            id: sandbox_id,
            exit_code: output.status.code().unwrap_or(-1),
            stdout: output.stdout,
            stderr: output.stderr,
            duration_ms,
            resource_usage: ResourceUsage {
                cpu_usage_seconds: duration_ms as f64 / 1000.0,
                memory_usage_bytes: 0, // Would need to query cgroups
                network_rx_bytes: 0,
                network_tx_bytes: 0,
            },
        })
    }

    async fn destroy(&self, sandbox_id: Uuid) -> Result<()> {
        let mut sandboxes = self.sandboxes.write().await;
        
        if let Some(info) = sandboxes.remove(&sandbox_id) {
            // Kill the container
            let mut cmd = Command::new(&self.runsc_bin);
            cmd.args([
                "--root", self.runtime_root.to_str().unwrap(),
                "kill",
                &info.container_id,
                "KILL",
            ]);
            cmd.output().await.ok();

            // Delete the container
            let mut cmd = Command::new(&self.runsc_bin);
            cmd.args([
                "--root", self.runtime_root.to_str().unwrap(),
                "delete",
                &info.container_id,
            ]);
            cmd.output().await.ok();

            // Remove bundle directory
            if let Err(e) = tokio::fs::remove_dir_all(&info.bundle_path).await {
                error!("Failed to remove bundle directory: {}", e);
            }

            info!("Destroyed gVisor sandbox {}", sandbox_id);
        }

        Ok(())
    }

    async fn snapshot(&self, sandbox_id: Uuid) -> Result<SandboxSnapshot> {
        let sandboxes = self.sandboxes.read().await;
        let info = sandboxes.get(&sandbox_id)
            .ok_or_else(|| anyhow::anyhow!("Sandbox {} not found", sandbox_id))?;

        // Pause the container
        let mut cmd = Command::new(&self.runsc_bin);
        cmd.args([
            "--root", self.runtime_root.to_str().unwrap(),
            "pause",
            &info.container_id,
        ]);
        cmd.output().await.context("Failed to pause container")?;

        // Create checkpoint
        let checkpoint_dir = self.base_dir.join("checkpoints").join(sandbox_id.to_string());
        std::fs::create_dir_all(&checkpoint_dir)?;

        let mut cmd = Command::new(&self.runsc_bin);
        cmd.args([
            "--root", self.runtime_root.to_str().unwrap(),
            "checkpoint",
            "--image-path", checkpoint_dir.to_str().unwrap(),
            &info.container_id,
        ]);

        let output = cmd.output().await.context("Failed to checkpoint container")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to checkpoint: {}", stderr);
        }

        let snapshot = SandboxSnapshot {
            id: Uuid::new_v4(),
            sandbox_id,
            runtime_type: RuntimeType::Gvisor,
            timestamp: chrono::Utc::now(),
            filesystem_state: Vec::new(), // Would read from checkpoint
            memory_state: Some(Vec::new()), // Would read from checkpoint
            metadata: HashMap::from([
                ("checkpoint_path".to_string(), serde_json::json!(checkpoint_dir.to_str())),
            ]),
        };

        info!("Created snapshot for gVisor sandbox {}", sandbox_id);
        Ok(snapshot)
    }

    async fn resume(&self, snapshot: &SandboxSnapshot) -> Result<Uuid> {
        // Create new sandbox ID
        let new_sandbox_id = Uuid::new_v4();
        let container_id = format!("gvisor-{}", new_sandbox_id);

        // Get checkpoint path from metadata
        let checkpoint_path = snapshot.metadata.get("checkpoint_path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing checkpoint path in snapshot metadata"))?;

        // Restore from checkpoint
        let mut cmd = Command::new(&self.runsc_bin);
        cmd.args([
            "--root", self.runtime_root.to_str().unwrap(),
            "restore",
            "--image-path", checkpoint_path,
            "--bundle", self.base_dir.join(new_sandbox_id.to_string()).to_str().unwrap(),
            &container_id,
        ]);

        let output = cmd.output().await.context("Failed to restore container")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to restore: {}", stderr);
        }

        info!("Resumed gVisor sandbox {} from snapshot {}", new_sandbox_id, snapshot.id);
        Ok(new_sandbox_id)
    }

    async fn status(&self, sandbox_id: Uuid) -> Result<SandboxStatus> {
        let sandboxes = self.sandboxes.read().await;
        let info = sandboxes.get(&sandbox_id)
            .ok_or_else(|| anyhow::anyhow!("Sandbox {} not found", sandbox_id))?;

        // Get container state
        let mut cmd = Command::new(&self.runsc_bin);
        cmd.args([
            "--root", self.runtime_root.to_str().unwrap(),
            "state",
            &info.container_id,
        ]);

        let output = cmd.output().await.context("Failed to get container state")?;
        let state_json: serde_json::Value = serde_json::from_slice(&output.stdout)
            .context("Failed to parse container state")?;

        let state = match state_json["status"].as_str() {
            Some("running") => SandboxState::Running,
            Some("paused") => SandboxState::Paused,
            Some("stopped") => SandboxState::Stopped,
            _ => SandboxState::Failed,
        };

        Ok(SandboxStatus {
            id: sandbox_id,
            state,
            created_at: info.created_at,
            started_at: info.started_at,
            finished_at: None,
            exit_code: None,
            resource_usage: ResourceUsage {
                cpu_usage_seconds: 0.0,
                memory_usage_bytes: 0,
                network_rx_bytes: 0,
                network_tx_bytes: 0,
            },
        })
    }

    async fn logs(&self, sandbox_id: Uuid, follow: bool) -> Result<Box<dyn tokio::io::AsyncRead + Send + Unpin>> {
        let sandboxes = self.sandboxes.read().await;
        let info = sandboxes.get(&sandbox_id)
            .ok_or_else(|| anyhow::anyhow!("Sandbox {} not found", sandbox_id))?;

        // Get logs using runsc
        let mut cmd = Command::new(&self.runsc_bin);
        cmd.args([
            "--root", self.runtime_root.to_str().unwrap(),
            "logs",
        ]);

        if follow {
            cmd.arg("-f");
        }

        cmd.arg(&info.container_id);
        cmd.stdout(Stdio::piped());

        let child = cmd.spawn().context("Failed to get container logs")?;
        let stdout = child.stdout.ok_or_else(|| anyhow::anyhow!("Failed to capture stdout"))?;

        Ok(Box::new(stdout))
    }
}