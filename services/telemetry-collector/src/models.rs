use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct SandboxRun {
    pub id: Uuid,
    pub sandbox_id: String,
    pub provider: String,
    pub language: String,
    pub exit_code: i32,
    pub duration_ms: i64,
    pub cost: f64,
    pub cpu_requested: Option<f64>,
    pub memory_requested: Option<i32>,
    pub has_gpu: bool,
    pub timeout_ms: Option<i64>,
    pub success: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SandboxRunRequest {
    pub sandbox_id: String,
    pub provider: String,
    pub language: String,
    pub exit_code: i32,
    pub duration_ms: i64,
    pub cost: f64,
    pub cpu_requested: Option<f64>,
    pub memory_requested: Option<i32>,
    pub has_gpu: bool,
    pub timeout_ms: Option<i64>,
    pub spec: serde_json::Value,
    pub result: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct TrainingData {
    pub id: Uuid,
    pub features: serde_json::Value,
    pub actual_cost: f64,
    pub actual_latency: f64,
    pub success: bool,
    pub provider: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrainingDataRequest {
    pub sandbox_result: serde_json::Value,
    pub features: serde_json::Value,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Prediction {
    pub id: Uuid,
    pub provider: String,
    pub predicted_cost: f64,
    pub predicted_latency: f64,
    pub confidence: f64,
    pub model_version: String,
    pub actual_cost: Option<f64>,
    pub actual_latency: Option<f64>,
    pub actual_success: Option<bool>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PredictionRequest {
    pub prediction: PredictionData,
    pub actual: Option<ActualData>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PredictionData {
    pub provider: String,
    pub predicted_cost: f64,
    pub predicted_latency: f64,
    pub confidence: f64,
    pub model_version: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActualData {
    pub cost: f64,
    pub latency: f64,
    pub success: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderStats {
    pub avg_latency: f64,
    pub avg_cost: f64,
    pub success_rate: f64,
    pub total_runs: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelPerformance {
    pub total_predictions: i64,
    pub avg_cost_error: f64,
    pub avg_latency_error: f64,
    pub provider_accuracy: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TimeRange {
    pub start: DateTime<Utc>,
    pub end: Option<DateTime<Utc>>,
}