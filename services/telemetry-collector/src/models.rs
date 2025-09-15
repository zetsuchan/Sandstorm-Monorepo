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
    pub cpu_percent: Option<f64>,
    pub memory_mb: Option<f64>,
    pub network_rx_bytes: Option<i64>,
    pub network_tx_bytes: Option<i64>,
    pub agent_id: Option<String>,
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
    #[serde(default)]
    pub cpu_percent: Option<f64>,
    #[serde(default)]
    pub memory_mb: Option<f64>,
    #[serde(default)]
    pub network_rx_bytes: Option<i64>,
    #[serde(default)]
    pub network_tx_bytes: Option<i64>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub timestamp: Option<DateTime<Utc>>,
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeAgentRunSummary {
    pub sandbox_id: String,
    pub provider: String,
    pub language: String,
    pub duration_ms: i64,
    pub exit_code: i32,
    pub cpu_percent: Option<f64>,
    pub memory_mb: Option<f64>,
    pub network_rx_bytes: Option<i64>,
    pub network_tx_bytes: Option<i64>,
    pub finished_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeAgentOverview {
    pub agent_id: String,
    pub agent_name: Option<String>,
    pub status: String,
    pub version: String,
    pub queue_depth: i32,
    pub running: i32,
    pub completed: i32,
    pub failed: i32,
    pub cpu_percent: Option<f64>,
    pub memory_percent: Option<f64>,
    pub last_heartbeat: DateTime<Utc>,
    pub public_endpoint: Option<String>,
    #[serde(default)]
    pub sandbox_run: Option<EdgeAgentRunSummary>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeAgentStatusDto {
    pub agent_id: String,
    #[serde(default)]
    pub agent_name: Option<String>,
    pub status: String,
    pub version: String,
    pub uptime: i64,
    pub last_health_check: DateTime<Utc>,
    pub runtime: serde_json::Value,
    pub resources: serde_json::Value,
    pub sandboxes: serde_json::Value,
    pub connectivity: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeAgentMetricsDto {
    pub timestamp: DateTime<Utc>,
    pub agent_id: String,
    pub queue_depth: i64,
    pub running: i64,
    pub completed: i64,
    pub failed: i64,
    pub system: serde_json::Value,
    #[serde(default)]
    pub sandbox_run: Option<serde_json::Value>,
    #[serde(default)]
    pub errors_last_window: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeAgentLogDto {
    pub timestamp: DateTime<Utc>,
    pub level: String,
    pub message: String,
    #[serde(default)]
    pub context: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeStatusBatchRequest {
    pub items: Vec<EdgeAgentStatusDto>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeMetricsBatchRequest {
    pub items: Vec<EdgeAgentMetricsDto>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeLogBatchRequest {
    pub items: Vec<EdgeAgentLogDto>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct EdgeAgentStatusRecord {
    pub agent_id: String,
    pub agent_name: Option<String>,
    pub status: String,
    pub version: String,
    pub queue_depth: i32,
    pub running: i32,
    pub completed: i32,
    pub failed: i32,
    pub cpu_percent: Option<f64>,
    pub memory_percent: Option<f64>,
    pub last_heartbeat: DateTime<Utc>,
    pub public_endpoint: Option<String>,
    pub payload: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct EdgeAgentMetricsRecord {
    pub id: Uuid,
    pub agent_id: String,
    pub recorded_at: DateTime<Utc>,
    pub payload: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct EdgeAgentRunRecord {
    pub id: Uuid,
    pub agent_id: String,
    pub sandbox_id: String,
    pub provider: String,
    pub language: String,
    pub duration_ms: i64,
    pub exit_code: i32,
    pub cpu_percent: Option<f64>,
    pub memory_mb: Option<f64>,
    pub network_rx_bytes: Option<i64>,
    pub network_tx_bytes: Option<i64>,
    pub finished_at: DateTime<Utc>,
}
