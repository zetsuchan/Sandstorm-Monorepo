// SPDX-License-Identifier: MIT
// Copyright (c) 2025 Sandstorm Contributors

#![recursion_limit = "256"]

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing::{info, error};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use uuid::Uuid;

mod runtime;
use runtime::{
    firecracker::FirecrackerRuntime,
    gvisor::GvisorRuntime,
    kata::KataRuntime,
    IsolationLevel, RuntimeRegistry, RuntimeType, SandboxConfig, Mount,
};

#[derive(Debug, Clone)]
struct AppState {
    runtime_registry: Arc<RuntimeRegistry>,
}

#[derive(Debug, Serialize, Deserialize)]
struct HealthResponse {
    status: String,
    version: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct RunSandboxRequest {
    code: String,
    language: String,
    isolation_level: IsolationLevel,
    runtime_preference: Option<RuntimeType>,
    cpu_limit: Option<f64>,
    memory_limit: Option<u64>,
    timeout: Option<u64>,
    environment: Option<std::collections::HashMap<String, String>>,
    mounts: Option<Vec<MountRequest>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct MountRequest {
    source: String,
    destination: String,
    read_only: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct RunSandboxResponse {
    sandbox_id: Uuid,
    status: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "sandstorm_gateway=debug,tower_http=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Initialize runtime registry
    let registry = Arc::new(RuntimeRegistry::new());
    
    // Initialize and register runtimes based on available binaries
    if let Err(e) = initialize_runtimes(&registry).await {
        error!("Failed to initialize runtimes: {}", e);
        std::process::exit(1);
    }

    let state = AppState {
        runtime_registry: registry,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/sandboxes/run", post(run_sandbox))
        .route("/v1/sandboxes/:id/exec", post(exec_sandbox))
        .route("/v1/sandboxes/:id/status", get(sandbox_status))
        .route("/v1/sandboxes/:id", delete(destroy_sandbox))
        .route("/v1/sandboxes/:id/snapshot", post(snapshot_sandbox))
        .route("/v1/sandboxes/resume", post(resume_sandbox))
        .route("/v1/runtimes", get(list_runtimes))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    info!("Sandstorm Gateway listening on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn initialize_runtimes(registry: &Arc<RuntimeRegistry>) -> anyhow::Result<()> {
    // Try to initialize gVisor runtime
    let runsc_paths = vec![
        PathBuf::from("/usr/local/bin/runsc"),
        PathBuf::from("/usr/bin/runsc"),
        PathBuf::from("./bin/runsc"),
    ];
    
    for path in runsc_paths {
        if path.exists() {
            match GvisorRuntime::new(path.clone(), PathBuf::from("/var/lib/sandstorm/gvisor")) {
                Ok(runtime) => {
                    registry.register(Arc::new(runtime)).await?;
                    info!("Registered gVisor runtime");
                    break;
                }
                Err(e) => {
                    error!("Failed to initialize gVisor runtime: {}", e);
                }
            }
        }
    }

    // Try to initialize Kata runtime
    let kata_paths = vec![
        PathBuf::from("/usr/local/bin/kata-runtime"),
        PathBuf::from("/usr/bin/kata-runtime"),
        PathBuf::from("./bin/kata-runtime"),
    ];
    
    for path in kata_paths {
        if path.exists() {
            match KataRuntime::new(path.clone(), PathBuf::from("/var/lib/sandstorm/kata")) {
                Ok(runtime) => {
                    registry.register(Arc::new(runtime)).await?;
                    info!("Registered Kata runtime");
                    break;
                }
                Err(e) => {
                    error!("Failed to initialize Kata runtime: {}", e);
                }
            }
        }
    }

    // Try to initialize Firecracker runtime
    let firecracker_paths = vec![
        PathBuf::from("/usr/local/bin/firecracker"),
        PathBuf::from("/usr/bin/firecracker"),
        PathBuf::from("./bin/firecracker"),
    ];
    
    let jailer_paths = vec![
        PathBuf::from("/usr/local/bin/jailer"),
        PathBuf::from("/usr/bin/jailer"),
        PathBuf::from("./bin/jailer"),
    ];
    
    for fc_path in firecracker_paths {
        if fc_path.exists() {
            for jailer_path in &jailer_paths {
                if jailer_path.exists() {
                    match FirecrackerRuntime::new(
                        fc_path.clone(),
                        jailer_path.clone(),
                        PathBuf::from("/var/lib/sandstorm/firecracker")
                    ) {
                        Ok(runtime) => {
                            registry.register(Arc::new(runtime)).await?;
                            info!("Registered Firecracker runtime");
                            break;
                        }
                        Err(e) => {
                            error!("Failed to initialize Firecracker runtime: {}", e);
                        }
                    }
                }
            }
        }
    }

    // Check if at least one runtime is registered
    let runtimes = registry.list().await;
    if runtimes.is_empty() {
        anyhow::bail!("No runtimes could be initialized. Please install at least one runtime (gVisor, Kata, or Firecracker)");
    }

    info!("Initialized {} runtime(s)", runtimes.len());
    Ok(())
}

async fn health() -> impl IntoResponse {
    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

async fn run_sandbox(
    State(state): State<AppState>,
    Json(req): Json<RunSandboxRequest>,
) -> Result<Json<RunSandboxResponse>, StatusCode> {
    // Select appropriate runtime based on isolation level and preference
    let runtime = state.runtime_registry
        .select_runtime(req.isolation_level, req.runtime_preference)
        .await
        .map_err(|e| {
            error!("Failed to select runtime: {}", e);
            StatusCode::SERVICE_UNAVAILABLE
        })?;

    // Build sandbox configuration
    let config = SandboxConfig {
        id: Uuid::new_v4(),
        image: format!("sandstorm/{}", req.language),
        command: vec![get_language_command(&req.language), req.code.clone()],
        environment: req.environment.unwrap_or_default(),
        cpu_limit: req.cpu_limit,
        memory_limit: req.memory_limit,
        timeout: req.timeout,
        isolation_level: req.isolation_level,
        runtime_preference: req.runtime_preference,
        working_dir: Some("/workspace".to_string()),
        mounts: req.mounts.unwrap_or_default().into_iter()
            .map(|m| Mount {
                source: m.source,
                destination: m.destination,
                read_only: m.read_only,
            })
            .collect(),
    };

    // Create and start sandbox
    let sandbox_id = runtime.create(&config).await.map_err(|e| {
        error!("Failed to create sandbox: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(RunSandboxResponse {
        sandbox_id,
        status: "running".to_string(),
    }))
}

#[derive(Debug, Serialize, Deserialize)]
struct ExecRequest {
    command: Vec<String>,
    environment: Option<std::collections::HashMap<String, String>>,
}

async fn exec_sandbox(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
    Json(req): Json<ExecRequest>,
) -> Result<Json<runtime::SandboxResult>, StatusCode> {
    // Find which runtime has this sandbox
    for runtime_type in state.runtime_registry.list().await {
        if let Ok(runtime) = state.runtime_registry.get(runtime_type).await {
            match runtime.exec(id, req.command.clone(), req.environment.clone()).await {
                Ok(result) => return Ok(Json(result)),
                Err(e) => {
                    error!("Failed to exec in sandbox {}: {}", id, e);
                }
            }
        }
    }
    
    Err(StatusCode::NOT_FOUND)
}

async fn sandbox_status(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<Json<runtime::SandboxStatus>, StatusCode> {
    // Find which runtime has this sandbox
    for runtime_type in state.runtime_registry.list().await {
        if let Ok(runtime) = state.runtime_registry.get(runtime_type).await {
            match runtime.status(id).await {
                Ok(status) => return Ok(Json(status)),
                Err(e) => {
                    error!("Failed to get status for sandbox {}: {}", id, e);
                }
            }
        }
    }
    
    Err(StatusCode::NOT_FOUND)
}

async fn destroy_sandbox(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    // Find which runtime has this sandbox
    for runtime_type in state.runtime_registry.list().await {
        if let Ok(runtime) = state.runtime_registry.get(runtime_type).await {
            match runtime.destroy(id).await {
                Ok(_) => return Ok(StatusCode::NO_CONTENT),
                Err(e) => {
                    error!("Failed to destroy sandbox {}: {}", id, e);
                }
            }
        }
    }
    
    Err(StatusCode::NOT_FOUND)
}

async fn snapshot_sandbox(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<Json<runtime::SandboxSnapshot>, StatusCode> {
    // Find which runtime has this sandbox
    for runtime_type in state.runtime_registry.list().await {
        if let Ok(runtime) = state.runtime_registry.get(runtime_type).await {
            match runtime.snapshot(id).await {
                Ok(snapshot) => return Ok(Json(snapshot)),
                Err(e) => {
                    error!("Failed to snapshot sandbox {}: {}", id, e);
                }
            }
        }
    }
    
    Err(StatusCode::NOT_FOUND)
}

#[derive(Debug, Serialize, Deserialize)]
struct ResumeRequest {
    snapshot: runtime::SandboxSnapshot,
}

#[derive(Debug, Serialize, Deserialize)]
struct ResumeResponse {
    sandbox_id: Uuid,
}

async fn resume_sandbox(
    State(state): State<AppState>,
    Json(req): Json<ResumeRequest>,
) -> Result<Json<ResumeResponse>, StatusCode> {
    let runtime = state.runtime_registry
        .get(req.snapshot.runtime_type)
        .await
        .map_err(|e| {
            error!("Failed to get runtime: {}", e);
            StatusCode::SERVICE_UNAVAILABLE
        })?;

    let sandbox_id = runtime.resume(&req.snapshot).await.map_err(|e| {
        error!("Failed to resume sandbox: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(ResumeResponse { sandbox_id }))
}

#[derive(Debug, Serialize, Deserialize)]
struct ListRuntimesResponse {
    runtimes: Vec<RuntimeInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RuntimeInfo {
    runtime_type: RuntimeType,
    supported_isolation_levels: Vec<IsolationLevel>,
}

async fn list_runtimes(State(state): State<AppState>) -> Json<ListRuntimesResponse> {
    let mut runtimes = Vec::new();
    
    for runtime_type in state.runtime_registry.list().await {
        let supported_isolation_levels = match runtime_type {
            RuntimeType::Gvisor => vec![IsolationLevel::Standard, IsolationLevel::Strong],
            RuntimeType::Kata => vec![IsolationLevel::Strong, IsolationLevel::Maximum],
            RuntimeType::Firecracker => vec![IsolationLevel::Maximum, IsolationLevel::Strong],
        };
        
        runtimes.push(RuntimeInfo {
            runtime_type,
            supported_isolation_levels,
        });
    }
    
    Json(ListRuntimesResponse { runtimes })
}

fn get_language_command(language: &str) -> String {
    match language {
        "python" => "python3",
        "javascript" | "typescript" => "node",
        "go" => "go run",
        "rust" => "cargo run",
        "java" => "java",
        "cpp" => "./a.out",
        "shell" => "sh",
        _ => "sh",
    }.to_string()
}

use axum::routing::delete;