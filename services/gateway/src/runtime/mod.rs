use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;
use async_trait::async_trait;

pub mod firecracker;
pub mod gvisor;
pub mod kata;
pub mod test;

/// Isolation level for sandbox execution
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IsolationLevel {
    /// Standard isolation using namespaces and cgroups
    Standard,
    /// Strong isolation using lightweight VMs or secure containers
    Strong,
    /// Maximum isolation using full VMs with hardware virtualization
    Maximum,
}

/// Runtime type identifier
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeType {
    Firecracker,
    Gvisor,
    Kata,
}

/// Sandbox configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    pub id: Uuid,
    pub image: String,
    pub command: Vec<String>,
    pub environment: HashMap<String, String>,
    pub cpu_limit: Option<f64>,
    pub memory_limit: Option<u64>, // bytes
    pub timeout: Option<u64>,       // milliseconds
    pub isolation_level: IsolationLevel,
    pub runtime_preference: Option<RuntimeType>,
    pub working_dir: Option<String>,
    pub mounts: Vec<Mount>,
}

/// Mount configuration for sandbox
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mount {
    pub source: String,
    pub destination: String,
    pub read_only: bool,
}

/// Sandbox execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxResult {
    pub id: Uuid,
    pub exit_code: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub duration_ms: u64,
    pub resource_usage: ResourceUsage,
}

/// Resource usage statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceUsage {
    pub cpu_usage_seconds: f64,
    pub memory_usage_bytes: u64,
    pub network_rx_bytes: u64,
    pub network_tx_bytes: u64,
}

/// Sandbox snapshot for stateful operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxSnapshot {
    pub id: Uuid,
    pub sandbox_id: Uuid,
    pub runtime_type: RuntimeType,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub filesystem_state: Vec<u8>,
    pub memory_state: Option<Vec<u8>>,
    pub metadata: HashMap<String, serde_json::Value>,
}

/// The main trait that all sandbox runtimes must implement
#[async_trait]
pub trait SandboxRuntime: Send + Sync {
    /// Get the runtime type identifier
    fn runtime_type(&self) -> RuntimeType;

    /// Check if the runtime supports the given isolation level
    fn supports_isolation_level(&self, level: IsolationLevel) -> bool;

    /// Create and start a new sandbox
    async fn create(&self, config: &SandboxConfig) -> Result<Uuid>;

    /// Execute a command in an existing sandbox
    async fn exec(
        &self,
        sandbox_id: Uuid,
        command: Vec<String>,
        environment: Option<HashMap<String, String>>,
    ) -> Result<SandboxResult>;

    /// Stop and remove a sandbox
    async fn destroy(&self, sandbox_id: Uuid) -> Result<()>;

    /// Create a snapshot of the sandbox state
    async fn snapshot(&self, sandbox_id: Uuid) -> Result<SandboxSnapshot>;

    /// Resume a sandbox from a snapshot
    async fn resume(&self, snapshot: &SandboxSnapshot) -> Result<Uuid>;

    /// Get sandbox status
    async fn status(&self, sandbox_id: Uuid) -> Result<SandboxStatus>;

    /// Stream logs from a sandbox
    async fn logs(&self, sandbox_id: Uuid, follow: bool) -> Result<Box<dyn tokio::io::AsyncRead + Send + Unpin>>;
}

/// Sandbox status information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxStatus {
    pub id: Uuid,
    pub state: SandboxState,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub finished_at: Option<chrono::DateTime<chrono::Utc>>,
    pub exit_code: Option<i32>,
    pub resource_usage: ResourceUsage,
}

/// Sandbox state
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SandboxState {
    Creating,
    Running,
    Paused,
    Stopped,
    Failed,
}

/// Runtime registry for managing available runtimes
pub struct RuntimeRegistry {
    runtimes: RwLock<HashMap<RuntimeType, Arc<dyn SandboxRuntime>>>,
}

impl std::fmt::Debug for RuntimeRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RuntimeRegistry")
            .field("runtimes", &"<runtime collection>")
            .finish()
    }
}

impl RuntimeRegistry {
    /// Create a new runtime registry
    pub fn new() -> Self {
        Self {
            runtimes: RwLock::new(HashMap::new()),
        }
    }

    /// Register a runtime implementation
    pub async fn register(&self, runtime: Arc<dyn SandboxRuntime>) -> Result<()> {
        let runtime_type = runtime.runtime_type();
        let mut runtimes = self.runtimes.write().await;
        
        if runtimes.contains_key(&runtime_type) {
            anyhow::bail!("Runtime {:?} is already registered", runtime_type);
        }
        
        runtimes.insert(runtime_type, runtime);
        Ok(())
    }

    /// Get a runtime by type
    pub async fn get(&self, runtime_type: RuntimeType) -> Result<Arc<dyn SandboxRuntime>> {
        let runtimes = self.runtimes.read().await;
        runtimes
            .get(&runtime_type)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Runtime {:?} not found", runtime_type))
    }

    /// Select the best runtime for the given isolation level
    pub async fn select_runtime(
        &self,
        isolation_level: IsolationLevel,
        preference: Option<RuntimeType>,
    ) -> Result<Arc<dyn SandboxRuntime>> {
        let runtimes = self.runtimes.read().await;

        // If a preference is specified and the runtime supports the isolation level, use it
        if let Some(preferred) = preference {
            if let Some(runtime) = runtimes.get(&preferred) {
                if runtime.supports_isolation_level(isolation_level) {
                    return Ok(runtime.clone());
                }
            }
        }

        // Otherwise, select based on isolation level
        let runtime_type = match isolation_level {
            IsolationLevel::Standard => RuntimeType::Gvisor,
            IsolationLevel::Strong => RuntimeType::Kata,
            IsolationLevel::Maximum => RuntimeType::Firecracker,
        };

        runtimes
            .get(&runtime_type)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("No suitable runtime found for isolation level {:?}", isolation_level))
    }

    /// List all registered runtimes
    pub async fn list(&self) -> Vec<RuntimeType> {
        let runtimes = self.runtimes.read().await;
        runtimes.keys().copied().collect()
    }
}

impl Default for RuntimeRegistry {
    fn default() -> Self {
        Self::new()
    }
}