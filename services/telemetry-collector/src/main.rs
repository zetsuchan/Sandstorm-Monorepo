use anyhow::Result;
use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::{info, Level};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod config;
mod db;
mod error;
mod handlers;
mod models;
mod metrics;

use crate::config::Config;
use crate::db::Database;
use crate::metrics::Metrics;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub config: Config,
    pub metrics: Metrics,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "telemetry_collector=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Load configuration
    let config = Config::load()?;
    info!("Loaded configuration");

    // Initialize database
    let db = Database::new(&config.database_url).await?;
    db.run_migrations().await?;
    info!("Connected to database and ran migrations");

    // Initialize metrics
    let metrics = Metrics::new();

    // Create app state
    let state = AppState {
        db,
        config: config.clone(),
        metrics,
    };

    // Build application
    let app = Router::new()
        // Health check
        .route("/health", get(handlers::health::health_check))
        
        // Telemetry endpoints
        .route("/api/telemetry/sandbox-run", post(handlers::telemetry::track_sandbox_run))
        .route("/api/telemetry/training-data", get(handlers::telemetry::get_training_data))
        .route("/api/telemetry/training-data", post(handlers::telemetry::submit_training_data))
        
        // Provider statistics
        .route("/api/telemetry/provider-stats/:provider", get(handlers::telemetry::get_provider_stats))
        
        // Model performance tracking
        .route("/api/telemetry/predictions", post(handlers::telemetry::track_prediction))
        .route("/api/telemetry/model-performance/:version", get(handlers::telemetry::get_model_performance))
        
        // Metrics endpoint for Prometheus
        .route("/metrics", get(handlers::metrics::metrics_handler))
        
        // Add middleware
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Start server
    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    info!("Starting telemetry collector on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}