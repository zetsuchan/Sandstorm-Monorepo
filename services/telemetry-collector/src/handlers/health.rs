use axum::{extract::State, http::StatusCode, Json};
use serde_json::json;

use crate::AppState;

pub async fn health_check(State(state): State<AppState>) -> Result<Json<serde_json::Value>, StatusCode> {
    // Check database connection
    match sqlx::query("SELECT 1").execute(state.db.pool()).await {
        Ok(_) => Ok(Json(json!({
            "status": "healthy",
            "database": "connected"
        }))),
        Err(_) => Err(StatusCode::SERVICE_UNAVAILABLE),
    }
}