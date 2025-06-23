use super::*;
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;
use tracing::{error, info, warn};

/// Kata Containers runtime implementation for strong isolation
pub struct KataRuntime {
    /// Path to kata-runtime binary
    kata_bin: PathBuf,
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

impl KataRuntime {
    /// Create a new Kata runtime
    pub fn new(kata_bin: PathBuf, base_dir: PathBuf) -> Result<Self> {
        // Verify binary exists
        if !kata_bin.exists() {
            anyhow::bail!("kata-runtime binary not found at {:?}", kata_bin);
        }

        // Create directories
        std::fs::create_dir_all(&base_dir)
            .context("Failed to create base directory")?;
        
        let runtime_root = base_dir.join("runtime");
        std::fs::create_dir_all(&runtime_root)
            .context("Failed to create runtime root directory")?;

        Ok(Self {
            kata_bin,
            base_dir,
            runtime_root,
            sandboxes: RwLock::new(HashMap::new()),
        })
    }

    /// Create OCI runtime spec with Kata-specific annotations
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
            serde_json::json!({
                "destination": "/dev/pts",
                "type": "devpts",
                "source": "devpts",
                "options": ["nosuid", "noexec", "newinstance", "ptmxmode=0666", "mode=0620"]
            }),
            serde_json::json!({
                "destination": "/dev/shm",
                "type": "tmpfs",
                "source": "shm",
                "options": ["nosuid", "noexec", "nodev", "mode=1777", "size=65536k"]
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

        // Kata-specific annotations
        let mut annotations = HashMap::new();
        
        // Configure VM resources
        if let Some(cpu_limit) = config.cpu_limit {
            annotations.insert(
                "io.katacontainers.config.hypervisor.default_vcpus".to_string(),
                cpu_limit.ceil().to_string(),
            );
        }
        
        if let Some(memory_limit) = config.memory_limit {
            let memory_mb = memory_limit / (1024 * 1024);
            annotations.insert(
                "io.katacontainers.config.hypervisor.default_memory".to_string(),
                memory_mb.to_string(),
            );
        }

        // Enable sandbox sharing for better performance
        annotations.insert(
            "io.katacontainers.config.runtime.enable_sandbox_sharing".to_string(),
            "true".to_string(),
        );

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
                    "bounding": ["CAP_CHOWN", "CAP_DAC_OVERRIDE", "CAP_FSETID", "CAP_FOWNER", 
                                "CAP_MKNOD", "CAP_NET_RAW", "CAP_SETGID", "CAP_SETUID", 
                                "CAP_SETFCAP", "CAP_SETPCAP", "CAP_NET_BIND_SERVICE", 
                                "CAP_SYS_CHROOT", "CAP_KILL", "CAP_AUDIT_WRITE"],
                    "effective": ["CAP_CHOWN", "CAP_DAC_OVERRIDE", "CAP_FSETID", "CAP_FOWNER", 
                                 "CAP_MKNOD", "CAP_NET_RAW", "CAP_SETGID", "CAP_SETUID", 
                                 "CAP_SETFCAP", "CAP_SETPCAP", "CAP_NET_BIND_SERVICE", 
                                 "CAP_SYS_CHROOT", "CAP_KILL", "CAP_AUDIT_WRITE"],
                    "permitted": ["CAP_CHOWN", "CAP_DAC_OVERRIDE", "CAP_FSETID", "CAP_FOWNER", 
                                 "CAP_MKNOD", "CAP_NET_RAW", "CAP_SETGID", "CAP_SETUID", 
                                 "CAP_SETFCAP", "CAP_SETPCAP", "CAP_NET_BIND_SERVICE", 
                                 "CAP_SYS_CHROOT", "CAP_KILL", "CAP_AUDIT_WRITE"]
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
            "hostname": format!("kata-{}", config.id),
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
                    {"type": "mount"},
                    {"type": "cgroup"}
                ]
            },
            "annotations": annotations
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

        // Create essential files
        std::fs::write(rootfs_path.join("etc/passwd"), "root:x:0:0:root:/root:/bin/sh\nuser:x:1000:1000:user:/home/user:/bin/sh\n")?;
        std::fs::write(rootfs_path.join("etc/group"), "root:x:0:\nuser:x:1000:\n")?;

        Ok(bundle_path)
    }
}

#[async_trait]
impl SandboxRuntime for KataRuntime {
    fn runtime_type(&self) -> RuntimeType {
        RuntimeType::Kata
    }

    fn supports_isolation_level(&self, level: IsolationLevel) -> bool {
        // Kata provides strong isolation through lightweight VMs
        matches!(level, IsolationLevel::Strong | IsolationLevel::Maximum)
    }

    async fn create(&self, config: &SandboxConfig) -> Result<Uuid> {
        let sandbox_id = config.id;
        let container_id = format!("kata-{}", sandbox_id);

        // Create container bundle
        let bundle_path = self.create_bundle(config).await?;

        // Create container using kata-runtime
        let mut cmd = Command::new(&self.kata_bin);
        cmd.args([
            "--root", self.runtime_root.to_str().unwrap(),
            "create",
            "--bundle", bundle_path.to_str().unwrap(),
            &container_id,
        ]);

        cmd.env("KATA_RUNTIME_LOG_LEVEL", "debug");
        cmd.stderr(Stdio::piped());
        
        let output = cmd.output().await.context("Failed to create Kata container")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to create container: {}", stderr);
        }

        // Start the container
        let mut cmd = Command::new(&self.kata_bin);
        cmd.args([
            "--root", self.runtime_root.to_str().unwrap(),
            "start",
            &container_id,
        ]);

        let output = cmd.output().await.context("Failed to start Kata container")?;
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

        info!("Created Kata sandbox {}", sandbox_id);
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
        let mut cmd = Command::new(&self.kata_bin);
        cmd.args([
            "--root", self.runtime_root.to_str().unwrap(),
            "exec",
        ]);

        // Add environment variables
        if let Some(env) = environment {
            for (key, value) in env {
                cmd.arg("-e").arg(format!("{}={}", key, value));
            }
        }

        // Add container ID and command
        cmd.arg(&info.container_id);
        cmd.args(&command);

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let output = cmd.output().await.context("Failed to execute command in container")?;
        let duration_ms = start_time.elapsed().as_millis() as u64;

        // Get resource usage from VM metrics
        let resource_usage = self.get_resource_usage(&info.container_id).await
            .unwrap_or_else(|_| ResourceUsage {
                cpu_usage_seconds: duration_ms as f64 / 1000.0,
                memory_usage_bytes: 0,
                network_rx_bytes: 0,
                network_tx_bytes: 0,
            });

        Ok(SandboxResult {
            id: sandbox_id,
            exit_code: output.status.code().unwrap_or(-1),
            stdout: output.stdout,
            stderr: output.stderr,
            duration_ms,
            resource_usage,
        })
    }

    async fn destroy(&self, sandbox_id: Uuid) -> Result<()> {
        let mut sandboxes = self.sandboxes.write().await;
        
        if let Some(info) = sandboxes.remove(&sandbox_id) {
            // Stop the container
            let mut cmd = Command::new(&self.kata_bin);
            cmd.args([
                "--root", self.runtime_root.to_str().unwrap(),
                "kill",
                &info.container_id,
                "KILL",
            ]);
            cmd.output().await.ok();

            // Delete the container
            let mut cmd = Command::new(&self.kata_bin);
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

            info!("Destroyed Kata sandbox {}", sandbox_id);
        }

        Ok(())
    }

    async fn snapshot(&self, sandbox_id: Uuid) -> Result<SandboxSnapshot> {
        let sandboxes = self.sandboxes.read().await;
        let info = sandboxes.get(&sandbox_id)
            .ok_or_else(|| anyhow::anyhow!("Sandbox {} not found", sandbox_id))?;

        // Kata doesn't support live snapshots out of the box
        // We would need to implement VM snapshot functionality
        warn!("Kata snapshot not fully implemented, creating metadata snapshot only");

        let snapshot = SandboxSnapshot {
            id: Uuid::new_v4(),
            sandbox_id,
            runtime_type: RuntimeType::Kata,
            timestamp: chrono::Utc::now(),
            filesystem_state: Vec::new(), // Would need VM snapshot
            memory_state: None, // Would need VM memory snapshot
            metadata: HashMap::from([
                ("container_id".to_string(), serde_json::json!(info.container_id)),
                ("bundle_path".to_string(), serde_json::json!(info.bundle_path.to_str())),
            ]),
        };

        info!("Created snapshot for Kata sandbox {}", sandbox_id);
        Ok(snapshot)
    }

    async fn resume(&self, snapshot: &SandboxSnapshot) -> Result<Uuid> {
        // Kata doesn't support live restore out of the box
        // We would need to implement VM restore functionality
        warn!("Kata resume not fully implemented");
        
        let new_sandbox_id = Uuid::new_v4();
        info!("Would resume Kata sandbox {} from snapshot {}", new_sandbox_id, snapshot.id);
        Ok(new_sandbox_id)
    }

    async fn status(&self, sandbox_id: Uuid) -> Result<SandboxStatus> {
        let sandboxes = self.sandboxes.read().await;
        let info = sandboxes.get(&sandbox_id)
            .ok_or_else(|| anyhow::anyhow!("Sandbox {} not found", sandbox_id))?;

        // Get container state
        let mut cmd = Command::new(&self.kata_bin);
        cmd.args([
            "--root", self.runtime_root.to_str().unwrap(),
            "state",
            &info.container_id,
        ]);

        let output = cmd.output().await.context("Failed to get container state")?;
        
        let state = if output.status.success() {
            let state_json: serde_json::Value = serde_json::from_slice(&output.stdout)
                .context("Failed to parse container state")?;

            match state_json["status"].as_str() {
                Some("running") => SandboxState::Running,
                Some("paused") => SandboxState::Paused,
                Some("stopped") => SandboxState::Stopped,
                _ => SandboxState::Failed,
            }
        } else {
            SandboxState::Failed
        };

        let resource_usage = self.get_resource_usage(&info.container_id).await
            .unwrap_or_else(|_| ResourceUsage {
                cpu_usage_seconds: 0.0,
                memory_usage_bytes: 0,
                network_rx_bytes: 0,
                network_tx_bytes: 0,
            });

        Ok(SandboxStatus {
            id: sandbox_id,
            state,
            created_at: info.created_at,
            started_at: info.started_at,
            finished_at: None,
            exit_code: None,
            resource_usage,
        })
    }

    async fn logs(&self, sandbox_id: Uuid, _follow: bool) -> Result<Box<dyn tokio::io::AsyncRead + Send + Unpin>> {
        let sandboxes = self.sandboxes.read().await;
        let info = sandboxes.get(&sandbox_id)
            .ok_or_else(|| anyhow::anyhow!("Sandbox {} not found", sandbox_id))?;

        // Get container logs directory
        let log_dir = self.runtime_root.join("containers").join(&info.container_id);
        let log_file = log_dir.join("console.log");

        if log_file.exists() {
            let file = tokio::fs::File::open(log_file).await?;
            Ok(Box::new(file))
        } else {
            // Return empty reader if no logs yet
            let empty = tokio::io::empty();
            Ok(Box::new(empty))
        }
    }
}

impl KataRuntime {
    /// Get resource usage from Kata metrics
    async fn get_resource_usage(&self, _container_id: &str) -> Result<ResourceUsage> {
        // In a real implementation, we would query Kata metrics API
        // or use the kata-monitor tool to get VM resource usage
        
        // For now, return placeholder values
        Ok(ResourceUsage {
            cpu_usage_seconds: 0.0,
            memory_usage_bytes: 0,
            network_rx_bytes: 0,
            network_tx_bytes: 0,
        })
    }
}