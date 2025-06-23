use anyhow::Result;
use axum::{
    extract::{Query, State, WebSocketUpgrade},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tokio::time::interval;
use tower_http::cors::CorsLayer;
use tracing::{error, info, warn};
use uuid::Uuid;

mod config;
mod ebpf;
mod events;
mod falco;
mod metrics;
mod models;
mod policies;
mod quarantine;
mod storage;
mod websocket;

use crate::{
    config::Config,
    ebpf::EbpfMonitor,
    events::{EventAggregator, SecurityEvent},
    falco::FalcoIntegration,
    metrics::MetricsCollector,
    models::*,
    policies::PolicyEngine,
    quarantine::QuarantineManager,
    storage::EventStore,
    websocket::WebSocketManager,
};

#[derive(Clone)]
struct AppState {
    config: Arc<Config>,
    event_store: Arc<EventStore>,
    policy_engine: Arc<PolicyEngine>,
    quarantine_manager: Arc<QuarantineManager>,
    metrics_collector: Arc<MetricsCollector>,
    ws_manager: Arc<WebSocketManager>,
    event_aggregator: Arc<EventAggregator>,
    sandbox_monitors: Arc<DashMap<String, SandboxMonitor>>,
}

struct SandboxMonitor {
    sandbox_id: String,
    provider: String,
    start_time: chrono::DateTime<chrono::Utc>,
    ebpf_monitor: Option<EbpfMonitor>,
    falco_integration: Option<FalcoIntegration>,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter("security_monitor=debug,tower_http=debug")
        .init();

    // Load configuration
    let config = Arc::new(Config::from_env()?);
    info!("Loaded configuration");

    // Initialize storage
    let event_store = Arc::new(EventStore::new(&config.database_url).await?);
    event_store.run_migrations().await?;
    info!("Initialized event store");

    // Initialize components
    let policy_engine = Arc::new(PolicyEngine::new());
    let quarantine_manager = Arc::new(QuarantineManager::new());
    let metrics_collector = Arc::new(MetricsCollector::new());
    let ws_manager = Arc::new(WebSocketManager::new());
    let event_aggregator = Arc::new(EventAggregator::new());
    let sandbox_monitors = Arc::new(DashMap::new());

    // Load default policies
    policy_engine.load_default_policies().await?;

    let state = AppState {
        config: config.clone(),
        event_store,
        policy_engine,
        quarantine_manager,
        metrics_collector,
        ws_manager,
        event_aggregator,
        sandbox_monitors,
    };

    // Start background tasks
    tokio::spawn(metrics_task(state.clone()));
    tokio::spawn(aggregation_task(state.clone()));
    tokio::spawn(cleanup_task(state.clone()));

    // Build router
    let app = Router::new()
        // Event endpoints
        .route("/api/events", post(capture_event))
        .route("/api/events", get(list_events))
        .route("/api/events/aggregate", get(aggregate_events))
        
        // Policy endpoints
        .route("/api/policies", post(create_policy))
        .route("/api/policies", get(list_policies))
        .route("/api/policies/:id", get(get_policy))
        .route("/api/policies/:id", put(update_policy))
        .route("/api/policies/:id", delete(delete_policy))
        
        // Quarantine endpoints
        .route("/api/quarantine", post(quarantine_sandbox))
        .route("/api/quarantine/:id/release", post(release_quarantine))
        .route("/api/quarantine", get(list_quarantines))
        
        // Monitoring endpoints
        .route("/api/monitor/sandbox/:id/start", post(start_monitoring))
        .route("/api/monitor/sandbox/:id/stop", post(stop_monitoring))
        .route("/api/monitor/sandbox/:id/status", get(monitoring_status))
        
        // Dashboard endpoints
        .route("/api/dashboard/metrics", get(get_metrics))
        .route("/api/dashboard/alerts", get(get_alerts))
        .route("/api/dashboard/ws", get(websocket_handler))
        
        // Health check
        .route("/health", get(health_check))
        
        // Metrics endpoint
        .route("/metrics", get(prometheus_metrics))
        
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    info!("Starting security monitor on {}", addr);

    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await?;

    Ok(())
}

// Event handlers
async fn capture_event(
    State(state): State<AppState>,
    Json(event): Json<SecurityEvent>,
) -> Result<Json<EventResponse>, AppError> {
    // Store event
    let event_id = state.event_store.store_event(&event).await?;
    
    // Update metrics
    state.metrics_collector.record_event(&event);
    
    // Evaluate policies
    let evaluation = state.policy_engine.evaluate(&event).await?;
    
    // Take action based on policy
    match evaluation.action.as_str() {
        "quarantine" => {
            let record = state.quarantine_manager.quarantine(
                &event.sandbox_id,
                &evaluation.reason,
                &event,
            ).await?;
            
            warn!(
                sandbox_id = %event.sandbox_id,
                quarantine_id = %record.id,
                "Sandbox quarantined"
            );
        }
        "alert" => {
            state.ws_manager.broadcast_alert(Alert {
                id: Uuid::new_v4().to_string(),
                severity: event.severity.clone(),
                message: event.message.clone(),
                timestamp: chrono::Utc::now(),
                sandbox_id: Some(event.sandbox_id.clone()),
                acknowledged: false,
            }).await;
        }
        _ => {}
    }
    
    // Broadcast event to dashboard
    state.ws_manager.broadcast_event(&event).await;
    
    Ok(Json(EventResponse {
        event_id,
        action_taken: evaluation.action,
        matched_rules: evaluation.matched_rules,
    }))
}

async fn list_events(
    State(state): State<AppState>,
    Query(params): Query<EventQuery>,
) -> Result<Json<Vec<SecurityEvent>>, AppError> {
    let events = state.event_store.list_events(params).await?;
    Ok(Json(events))
}

async fn aggregate_events(
    State(state): State<AppState>,
    Query(params): Query<AggregationQuery>,
) -> Result<Json<AggregationResult>, AppError> {
    let events = state.event_store.list_events(EventQuery {
        start_time: params.start_time,
        end_time: params.end_time,
        ..Default::default()
    }).await?;
    
    let result = state.event_aggregator.aggregate(
        &events,
        params.window_ms.unwrap_or(60000),
    ).await?;
    
    Ok(Json(result))
}

// Policy handlers
async fn create_policy(
    State(state): State<AppState>,
    Json(policy): Json<SecurityPolicy>,
) -> Result<Json<PolicyResponse>, AppError> {
    let policy_id = state.policy_engine.add_policy(policy).await?;
    Ok(Json(PolicyResponse { policy_id }))
}

async fn list_policies(
    State(state): State<AppState>,
) -> Result<Json<Vec<SecurityPolicy>>, AppError> {
    let policies = state.policy_engine.list_policies().await?;
    Ok(Json(policies))
}

async fn get_policy(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<SecurityPolicy>, AppError> {
    let policy = state.policy_engine.get_policy(&id).await?
        .ok_or(AppError::NotFound("Policy not found".to_string()))?;
    Ok(Json(policy))
}

async fn update_policy(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(policy): Json<SecurityPolicy>,
) -> Result<Json<PolicyResponse>, AppError> {
    state.policy_engine.update_policy(&id, policy).await?;
    Ok(Json(PolicyResponse { policy_id: id }))
}

async fn delete_policy(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<(), AppError> {
    state.policy_engine.remove_policy(&id).await?;
    Ok(())
}

// Quarantine handlers
async fn quarantine_sandbox(
    State(state): State<AppState>,
    Json(request): Json<QuarantineRequest>,
) -> Result<Json<QuarantineRecord>, AppError> {
    let record = state.quarantine_manager.quarantine(
        &request.sandbox_id,
        &request.reason,
        &request.triggering_event,
    ).await?;
    
    Ok(Json(record))
}

async fn release_quarantine(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<(), AppError> {
    state.quarantine_manager.release(&id).await?;
    Ok(())
}

async fn list_quarantines(
    State(state): State<AppState>,
) -> Result<Json<Vec<QuarantineRecord>>, AppError> {
    let records = state.quarantine_manager.list_active().await?;
    Ok(Json(records))
}

// Monitoring handlers
async fn start_monitoring(
    State(state): State<AppState>,
    axum::extract::Path(sandbox_id): axum::extract::Path<String>,
    Json(request): Json<MonitoringRequest>,
) -> Result<Json<MonitoringResponse>, AppError> {
    let mut monitor = SandboxMonitor {
        sandbox_id: sandbox_id.clone(),
        provider: request.provider,
        start_time: chrono::Utc::now(),
        ebpf_monitor: None,
        falco_integration: None,
    };
    
    // Initialize eBPF monitoring if enabled
    if state.config.ebpf_enabled {
        let ebpf = EbpfMonitor::new(&sandbox_id)?;
        ebpf.attach_programs().await?;
        monitor.ebpf_monitor = Some(ebpf);
    }
    
    // Initialize Falco integration if enabled
    if state.config.falco_enabled {
        let falco = FalcoIntegration::new(&sandbox_id, &state.config.falco_rules_path)?;
        falco.start().await?;
        monitor.falco_integration = Some(falco);
    }
    
    state.sandbox_monitors.insert(sandbox_id.clone(), monitor);
    
    Ok(Json(MonitoringResponse {
        sandbox_id,
        status: "monitoring".to_string(),
        monitors_active: vec![
            if state.config.ebpf_enabled { Some("ebpf") } else { None },
            if state.config.falco_enabled { Some("falco") } else { None },
        ].into_iter().flatten().map(String::from).collect(),
    }))
}

async fn stop_monitoring(
    State(state): State<AppState>,
    axum::extract::Path(sandbox_id): axum::extract::Path<String>,
) -> Result<(), AppError> {
    if let Some((_, mut monitor)) = state.sandbox_monitors.remove(&sandbox_id) {
        if let Some(ebpf) = monitor.ebpf_monitor.take() {
            ebpf.detach_programs().await?;
        }
        
        if let Some(falco) = monitor.falco_integration.take() {
            falco.stop().await?;
        }
    }
    
    Ok(())
}

async fn monitoring_status(
    State(state): State<AppState>,
    axum::extract::Path(sandbox_id): axum::extract::Path<String>,
) -> Result<Json<MonitoringStatus>, AppError> {
    let monitor = state.sandbox_monitors.get(&sandbox_id)
        .ok_or(AppError::NotFound("Monitor not found".to_string()))?;
    
    Ok(Json(MonitoringStatus {
        sandbox_id: monitor.sandbox_id.clone(),
        provider: monitor.provider.clone(),
        start_time: monitor.start_time,
        uptime_seconds: chrono::Utc::now()
            .signed_duration_since(monitor.start_time)
            .num_seconds() as u64,
        ebpf_active: monitor.ebpf_monitor.is_some(),
        falco_active: monitor.falco_integration.is_some(),
    }))
}

// Dashboard handlers
async fn get_metrics(
    State(state): State<AppState>,
    Query(params): Query<MetricsQuery>,
) -> Result<Json<DashboardMetrics>, AppError> {
    let metrics = state.metrics_collector.get_dashboard_metrics(
        params.time_range,
        params.granularity,
    ).await?;
    
    Ok(Json(metrics))
}

async fn get_alerts(
    State(state): State<AppState>,
    Query(params): Query<AlertQuery>,
) -> Result<Json<Vec<Alert>>, AppError> {
    let alerts = state.event_store.list_alerts(params).await?;
    Ok(Json(alerts))
}

async fn websocket_handler(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| websocket::handle_connection(socket, state.ws_manager))
}

async fn health_check() -> &'static str {
    "OK"
}

async fn prometheus_metrics(
    State(state): State<AppState>,
) -> Result<String, AppError> {
    Ok(state.metrics_collector.export_prometheus())
}

// Background tasks
async fn metrics_task(state: AppState) {
    let mut interval = interval(Duration::from_secs(60));
    
    loop {
        interval.tick().await;
        
        if let Err(e) = state.metrics_collector.collect_system_metrics().await {
            error!("Failed to collect system metrics: {}", e);
        }
    }
}

async fn aggregation_task(state: AppState) {
    let mut interval = interval(Duration::from_secs(300)); // 5 minutes
    
    loop {
        interval.tick().await;
        
        info!("Running event aggregation");
        
        match state.event_store.aggregate_old_events().await {
            Ok(count) => info!("Aggregated {} events", count),
            Err(e) => error!("Failed to aggregate events: {}", e),
        }
    }
}

async fn cleanup_task(state: AppState) {
    let mut interval = interval(Duration::from_secs(3600)); // 1 hour
    
    loop {
        interval.tick().await;
        
        info!("Running cleanup task");
        
        // Clean up old events
        match state.event_store.cleanup_old_events(30).await {
            Ok(count) => info!("Cleaned up {} old events", count),
            Err(e) => error!("Failed to cleanup events: {}", e),
        }
        
        // Check for stale sandbox monitors
        let stale_threshold = chrono::Utc::now() - chrono::Duration::hours(24);
        let mut to_remove = Vec::new();
        
        for entry in state.sandbox_monitors.iter() {
            if entry.value().start_time < stale_threshold {
                to_remove.push(entry.key().clone());
            }
        }
        
        for sandbox_id in to_remove {
            warn!("Removing stale monitor for sandbox {}", sandbox_id);
            state.sandbox_monitors.remove(&sandbox_id);
        }
    }
}

// Error handling
#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),
    
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    
    #[error("Internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match self {
            AppError::NotFound(msg) => (
                axum::http::StatusCode::NOT_FOUND,
                msg,
            ),
            AppError::Database(e) => (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {}", e),
            ),
            AppError::Internal(e) => (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {}", e),
            ),
        };
        
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}