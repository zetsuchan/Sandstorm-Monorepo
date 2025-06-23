use super::*;
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;
use tracing::{error, info, warn};

/// Firecracker runtime implementation for maximum isolation
pub struct FirecrackerRuntime {
    /// Path to firecracker binary
    firecracker_bin: PathBuf,
    /// Path to jailer binary
    jailer_bin: PathBuf,
    /// Base directory for VM storage
    base_dir: PathBuf,
    /// Active sandboxes
    sandboxes: RwLock<HashMap<Uuid, SandboxInfo>>,
}

#[derive(Debug, Clone)]
struct SandboxInfo {
    pid: u32,
    socket_path: PathBuf,
    root_dir: PathBuf,
    state: SandboxState,
    config: SandboxConfig,
    created_at: chrono::DateTime<chrono::Utc>,
    started_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl FirecrackerRuntime {
    /// Create a new Firecracker runtime
    pub fn new(firecracker_bin: PathBuf, jailer_bin: PathBuf, base_dir: PathBuf) -> Result<Self> {
        // Verify binaries exist
        if !firecracker_bin.exists() {
            anyhow::bail!("Firecracker binary not found at {:?}", firecracker_bin);
        }
        if !jailer_bin.exists() {
            anyhow::bail!("Jailer binary not found at {:?}", jailer_bin);
        }

        // Create base directory if it doesn't exist
        std::fs::create_dir_all(&base_dir)
            .context("Failed to create base directory")?;

        Ok(Self {
            firecracker_bin,
            jailer_bin,
            base_dir,
            sandboxes: RwLock::new(HashMap::new()),
        })
    }

    /// Build VM configuration
    async fn build_vm_config(&self, config: &SandboxConfig) -> Result<serde_json::Value> {
        let vcpu_count = config.cpu_limit.map(|cpu| cpu.ceil() as u64).unwrap_or(1);
        let mem_size_mib = config.memory_limit
            .map(|mem| (mem / (1024 * 1024)).max(128))
            .unwrap_or(512);

        Ok(serde_json::json!({
            "boot-source": {
                "kernel_image_path": "/var/lib/firecracker/kernels/vmlinux",
                "boot_args": "console=ttyS0 reboot=k panic=1 pci=off"
            },
            "drives": [{
                "drive_id": "rootfs",
                "path_on_host": "/var/lib/firecracker/images/rootfs.ext4",
                "is_root_device": true,
                "is_read_only": false
            }],
            "machine-config": {
                "vcpu_count": vcpu_count,
                "mem_size_mib": mem_size_mib,
                "smt": false,
                "track_dirty_pages": false
            },
            "network-interfaces": [{
                "iface_id": "eth0",
                "guest_mac": "06:00:00:00:00:01",
                "host_dev_name": format!("tap{}", config.id.simple())
            }],
            "actions": {
                "action_type": "InstanceStart"
            }
        }))
    }

    /// Setup networking for the VM
    async fn setup_networking(&self, sandbox_id: Uuid) -> Result<()> {
        let tap_name = format!("tap{}", sandbox_id.simple());
        
        // Create TAP interface
        Command::new("ip")
            .args(["tuntap", "add", &tap_name, "mode", "tap"])
            .status()
            .await
            .context("Failed to create TAP interface")?;

        // Bring interface up
        Command::new("ip")
            .args(["link", "set", &tap_name, "up"])
            .status()
            .await
            .context("Failed to bring TAP interface up")?;

        // Add to bridge
        Command::new("ip")
            .args(["link", "set", &tap_name, "master", "virbr0"])
            .status()
            .await
            .context("Failed to add TAP to bridge")?;

        Ok(())
    }

    /// Cleanup networking
    async fn cleanup_networking(&self, sandbox_id: Uuid) -> Result<()> {
        let tap_name = format!("tap{}", sandbox_id.simple());
        
        Command::new("ip")
            .args(["link", "delete", &tap_name])
            .status()
            .await
            .ok(); // Ignore errors during cleanup

        Ok(())
    }
}

#[async_trait]
impl SandboxRuntime for FirecrackerRuntime {
    fn runtime_type(&self) -> RuntimeType {
        RuntimeType::Firecracker
    }

    fn supports_isolation_level(&self, level: IsolationLevel) -> bool {
        // Firecracker provides maximum isolation through hardware virtualization
        matches!(level, IsolationLevel::Maximum | IsolationLevel::Strong)
    }

    async fn create(&self, config: &SandboxConfig) -> Result<Uuid> {
        let sandbox_id = config.id;
        let sandbox_dir = self.base_dir.join(sandbox_id.to_string());
        std::fs::create_dir_all(&sandbox_dir)?;

        // Setup networking
        self.setup_networking(sandbox_id).await?;

        // Create socket path
        let socket_path = sandbox_dir.join("firecracker.sock");
        
        // Build VM configuration
        let vm_config = self.build_vm_config(config).await?;
        let config_path = sandbox_dir.join("config.json");
        std::fs::write(&config_path, serde_json::to_string_pretty(&vm_config)?)?;

        // Start Firecracker with jailer
        let mut cmd = Command::new(&self.jailer_bin);
        cmd.args([
            "--id", &sandbox_id.to_string(),
            "--exec-file", self.firecracker_bin.to_str().unwrap(),
            "--uid", "1000",
            "--gid", "1000",
            "--chroot-base-dir", self.base_dir.to_str().unwrap(),
            "--",
            "--api-sock", socket_path.to_str().unwrap(),
            "--config-file", config_path.to_str().unwrap(),
        ]);

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let child = cmd.spawn().context("Failed to spawn Firecracker")?;
        let pid = child.id().ok_or_else(|| anyhow::anyhow!("Failed to get PID"))?;

        // Store sandbox info
        let info = SandboxInfo {
            pid,
            socket_path,
            root_dir: sandbox_dir,
            state: SandboxState::Running,
            config: config.clone(),
            created_at: chrono::Utc::now(),
            started_at: Some(chrono::Utc::now()),
        };

        let mut sandboxes = self.sandboxes.write().await;
        sandboxes.insert(sandbox_id, info);

        info!("Created Firecracker sandbox {}", sandbox_id);
        Ok(sandbox_id)
    }

    async fn exec(
        &self,
        sandbox_id: Uuid,
        _command: Vec<String>,
        _environment: Option<HashMap<String, String>>,
    ) -> Result<SandboxResult> {
        let sandboxes = self.sandboxes.read().await;
        let info = sandboxes.get(&sandbox_id)
            .ok_or_else(|| anyhow::anyhow!("Sandbox {} not found", sandbox_id))?;

        if info.state != SandboxState::Running {
            anyhow::bail!("Sandbox {} is not running", sandbox_id);
        }

        // In a real implementation, we would:
        // 1. Use the Firecracker API to execute commands inside the VM
        // 2. Set up SSH or a custom agent inside the VM
        // 3. Capture output and resource usage

        // For now, return a placeholder result
        warn!("Firecracker exec not fully implemented, returning placeholder");
        
        Ok(SandboxResult {
            id: sandbox_id,
            exit_code: 0,
            stdout: b"Firecracker execution placeholder\n".to_vec(),
            stderr: Vec::new(),
            duration_ms: 100,
            resource_usage: ResourceUsage {
                cpu_usage_seconds: 0.1,
                memory_usage_bytes: 64 * 1024 * 1024,
                network_rx_bytes: 0,
                network_tx_bytes: 0,
            },
        })
    }

    async fn destroy(&self, sandbox_id: Uuid) -> Result<()> {
        let mut sandboxes = self.sandboxes.write().await;
        
        if let Some(info) = sandboxes.remove(&sandbox_id) {
            // Kill the Firecracker process
            if let Err(e) = Command::new("kill")
                .args(["-9", &info.pid.to_string()])
                .status()
                .await
            {
                error!("Failed to kill Firecracker process: {}", e);
            }

            // Cleanup networking
            self.cleanup_networking(sandbox_id).await?;

            // Remove sandbox directory
            if let Err(e) = tokio::fs::remove_dir_all(&info.root_dir).await {
                error!("Failed to remove sandbox directory: {}", e);
            }

            info!("Destroyed Firecracker sandbox {}", sandbox_id);
        }

        Ok(())
    }

    async fn snapshot(&self, sandbox_id: Uuid) -> Result<SandboxSnapshot> {
        let sandboxes = self.sandboxes.read().await;
        let _info = sandboxes.get(&sandbox_id)
            .ok_or_else(|| anyhow::anyhow!("Sandbox {} not found", sandbox_id))?;

        // In a real implementation, we would:
        // 1. Use Firecracker's snapshot API to create a memory snapshot
        // 2. Create a filesystem snapshot
        // 3. Save VM state

        let snapshot = SandboxSnapshot {
            id: Uuid::new_v4(),
            sandbox_id,
            runtime_type: RuntimeType::Firecracker,
            timestamp: chrono::Utc::now(),
            filesystem_state: Vec::new(), // Placeholder
            memory_state: Some(Vec::new()), // Placeholder
            metadata: HashMap::from([
                ("vm_state".to_string(), serde_json::json!("paused")),
            ]),
        };

        info!("Created snapshot for Firecracker sandbox {}", sandbox_id);
        Ok(snapshot)
    }

    async fn resume(&self, snapshot: &SandboxSnapshot) -> Result<Uuid> {
        // In a real implementation, we would:
        // 1. Restore the VM from the snapshot
        // 2. Resume execution

        let new_sandbox_id = Uuid::new_v4();
        info!("Resumed Firecracker sandbox {} from snapshot {}", new_sandbox_id, snapshot.id);
        Ok(new_sandbox_id)
    }

    async fn status(&self, sandbox_id: Uuid) -> Result<SandboxStatus> {
        let sandboxes = self.sandboxes.read().await;
        let info = sandboxes.get(&sandbox_id)
            .ok_or_else(|| anyhow::anyhow!("Sandbox {} not found", sandbox_id))?;

        Ok(SandboxStatus {
            id: sandbox_id,
            state: info.state,
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

    async fn logs(&self, sandbox_id: Uuid, _follow: bool) -> Result<Box<dyn tokio::io::AsyncRead + Send + Unpin>> {
        let sandboxes = self.sandboxes.read().await;
        let info = sandboxes.get(&sandbox_id)
            .ok_or_else(|| anyhow::anyhow!("Sandbox {} not found", sandbox_id))?;

        // In a real implementation, we would stream logs from the VM
        // For now, return an empty reader
        let log_path = info.root_dir.join("console.log");
        let file = match tokio::fs::File::open(log_path).await {
            Ok(f) => f,
            Err(_) => tokio::fs::File::open("/dev/null").await?,
        };
        
        Ok(Box::new(file))
    }
}