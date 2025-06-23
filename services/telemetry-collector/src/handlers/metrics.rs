use axum::{extract::State, http::StatusCode};

use crate::AppState;

pub async fn metrics_handler(State(state): State<AppState>) -> Result<String, StatusCode> {
    Ok(state.metrics.export())
}