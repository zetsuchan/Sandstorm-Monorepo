use anyhow::Context;
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{Response, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
};
use thiserror::Error;
use tokio::{fs, io::AsyncWriteExt, sync::RwLock};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    vault: Arc<SnapshotVault>,
}

#[derive(Debug, Error)]
enum VaultError {
    #[error("snapshot not found")]
    NotFound,
    #[error("invalid request: {0}")]
    Invalid(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl IntoResponse for VaultError {
    fn into_response(self) -> axum::response::Response {
        match &self {
            VaultError::NotFound => (StatusCode::NOT_FOUND, self.to_string()).into_response(),
            VaultError::Invalid(_) => (StatusCode::BAD_REQUEST, self.to_string()).into_response(),
            VaultError::Io(_) | VaultError::Other(_) => {
                error!(error = ?self, "snapshot vault error");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SnapshotMetadata {
    id: Uuid,
    sandbox_id: String,
    provider: String,
    filesystem_hash: String,
    memory_hash: Option<String>,
    size_bytes: u64,
    created_at: DateTime<Utc>,
    metadata: serde_json::Value,
    has_blob: bool,
}

#[derive(Debug, Deserialize)]
struct CreateSnapshotRequest {
    sandbox_id: String,
    provider: String,
    filesystem_hash: String,
    memory_hash: Option<String>,
    size_bytes: Option<u64>,
    metadata: Option<serde_json::Value>,
    data: Option<String>, // base64 encoded blob
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    sandbox_id: Option<String>,
    provider: Option<String>,
}

struct SnapshotVault {
    root: PathBuf,
    index: RwLock<HashMap<Uuid, SnapshotMetadata>>,
}

impl SnapshotVault {
    async fn new<P: AsRef<Path>>(root: P) -> anyhow::Result<Self> {
        let root = root.as_ref().to_path_buf();
        fs::create_dir_all(&root).await?;
        let index = Self::load_index(&root).await?;
        Ok(Self {
            root,
            index: RwLock::new(index),
        })
    }

    async fn load_index(root: &Path) -> anyhow::Result<HashMap<Uuid, SnapshotMetadata>> {
        let mut entries = HashMap::new();
        let mut dir = fs::read_dir(root).await?;

        while let Some(item) = dir.next_entry().await? {
            let path = item.path();
            if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
                let contents = fs::read(&path).await?;
                let metadata: SnapshotMetadata = serde_json::from_slice(&contents)?;
                entries.insert(metadata.id, metadata);
            }
        }

        Ok(entries)
    }

    async fn store(&self, request: CreateSnapshotRequest) -> anyhow::Result<SnapshotMetadata> {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let blob_path = self.root.join(format!("{}.blob", id));
        let meta_path = self.root.join(format!("{}.json", id));

        let mut size_bytes = request.size_bytes.unwrap_or(0);
        let mut has_blob = false;

        if let Some(blob) = request.data {
            let data = base64::decode(blob).context("failed to decode snapshot data")?;
            let mut file = fs::File::create(&blob_path).await?;
            file.write_all(&data).await?;
            size_bytes = data.len() as u64;
            has_blob = true;
        }

        let metadata = SnapshotMetadata {
            id,
            sandbox_id: request.sandbox_id,
            provider: request.provider,
            filesystem_hash: request.filesystem_hash,
            memory_hash: request.memory_hash,
            size_bytes,
            created_at: now,
            metadata: request.metadata.unwrap_or_else(|| serde_json::json!({})),
            has_blob,
        };

        let serialized = serde_json::to_vec_pretty(&metadata)?;
        fs::write(&meta_path, serialized).await?;

        self.index.write().await.insert(id, metadata.clone());

        Ok(metadata)
    }

    async fn list(&self, query: &ListQuery) -> Vec<SnapshotMetadata> {
        let index = self.index.read().await;
        index
            .values()
            .filter(|meta| {
                if let Some(sandbox_id) = &query.sandbox_id {
                    if &meta.sandbox_id != sandbox_id {
                        return false;
                    }
                }
                if let Some(provider) = &query.provider {
                    if &meta.provider != provider {
                        return false;
                    }
                }
                true
            })
            .cloned()
            .collect()
    }

    async fn get(&self, id: Uuid) -> Option<SnapshotMetadata> {
        self.index.read().await.get(&id).cloned()
    }

    async fn delete(&self, id: Uuid) -> anyhow::Result<()> {
        let meta_path = self.root.join(format!("{}.json", id));
        let blob_path = self.root.join(format!("{}.blob", id));

        let mut index = self.index.write().await;
        if index.remove(&id).is_none() {
            return Err(VaultError::NotFound.into());
        }

        if fs::metadata(&meta_path).await.is_ok() {
            fs::remove_file(meta_path).await?;
        }
        if fs::metadata(&blob_path).await.is_ok() {
            fs::remove_file(blob_path).await?;
        }

        Ok(())
    }

    async fn get_blob(&self, id: Uuid) -> Result<Vec<u8>, VaultError> {
        let meta = self.get(id).await.ok_or(VaultError::NotFound)?;
        if !meta.has_blob {
            return Err(VaultError::Invalid("snapshot has no blob".into()));
        }
        let data = fs::read(self.root.join(format!("{}.blob", id))).await?;
        Ok(data)
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "snapshot_vault=info,tower_http=info".into()),
        )
        .with(
            tracing_subscriber::fmt::layer()
                .with_target(false)
                .with_ansi(false),
        )
        .init();

    let storage_root =
        std::env::var("SNAPSHOT_VAULT_PATH").unwrap_or_else(|_| "./data/snapshots".to_string());
    let vault = Arc::new(SnapshotVault::new(storage_root).await?);

    let state = AppState { vault };

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/snapshots", post(create_snapshot).get(list_snapshots))
        .route(
            "/v1/snapshots/:id",
            get(get_snapshot).delete(delete_snapshot),
        )
        .route("/v1/snapshots/:id/data", get(download_snapshot))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let port: u16 = std::env::var("SNAPSHOT_VAULT_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8082);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("snapshot vault listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok" }))
}

async fn create_snapshot(
    State(state): State<AppState>,
    Json(payload): Json<CreateSnapshotRequest>,
) -> Result<Json<SnapshotMetadata>, VaultError> {
    let metadata = state.vault.store(payload).await.map_err(VaultError::from)?;
    Ok(Json(metadata))
}

async fn list_snapshots(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<SnapshotMetadata>>, VaultError> {
    let metas = state.vault.list(&query).await;
    Ok(Json(metas))
}

async fn get_snapshot(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<SnapshotMetadata>, VaultError> {
    let meta = state.vault.get(id).await.ok_or(VaultError::NotFound)?;
    Ok(Json(meta))
}

async fn download_snapshot(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Response<Body>, VaultError> {
    let bytes = state.vault.get_blob(id).await?;
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/octet-stream")
        .body(Body::from(bytes))
        .unwrap())
}

async fn delete_snapshot(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, VaultError> {
    state.vault.delete(id).await.map_err(VaultError::from)?;
    Ok(StatusCode::NO_CONTENT)
}
