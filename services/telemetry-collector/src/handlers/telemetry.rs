use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use tracing::error;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::*,
    AppState,
};

#[derive(Deserialize)]
pub struct TrainingDataQuery {
    start: DateTime<Utc>,
    limit: Option<i64>,
}

pub async fn track_sandbox_run(
    State(state): State<AppState>,
    Json(request): Json<SandboxRunRequest>,
) -> AppResult<Json<SandboxRun>> {
    let timestamp = request.timestamp.unwrap_or_else(Utc::now);
    let sandbox_run = SandboxRun {
        id: Uuid::new_v4(),
        sandbox_id: request.sandbox_id,
        provider: request.provider.clone(),
        language: request.language.clone(),
        exit_code: request.exit_code,
        duration_ms: request.duration_ms,
        cost: request.cost,
        cpu_requested: request.cpu_requested,
        memory_requested: request.memory_requested,
        has_gpu: request.has_gpu,
        timeout_ms: request.timeout_ms,
        success: request.exit_code == 0,
        cpu_percent: request.cpu_percent,
        memory_mb: request.memory_mb,
        network_rx_bytes: request.network_rx_bytes,
        network_tx_bytes: request.network_tx_bytes,
        agent_id: request.agent_id.clone(),
        created_at: timestamp,
    };

    // Update metrics
    state
        .metrics
        .sandbox_runs_total
        .with_label_values(&[
            &sandbox_run.provider,
            &sandbox_run.language,
            &sandbox_run.success.to_string(),
        ])
        .inc();

    state
        .metrics
        .sandbox_run_duration
        .with_label_values(&[&sandbox_run.provider, &sandbox_run.language])
        .observe(sandbox_run.duration_ms as f64);

    state
        .metrics
        .sandbox_run_cost
        .with_label_values(&[&sandbox_run.provider])
        .observe(sandbox_run.cost);

    // Store in database
    let result = sqlx::query_as!(
        SandboxRun,
        r#"
        INSERT INTO sandbox_runs (
            id, sandbox_id, provider, language, exit_code, duration_ms, 
            cost, cpu_requested, memory_requested, has_gpu, timeout_ms, 
            success, cpu_percent, memory_mb, network_rx_bytes, network_tx_bytes, agent_id, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *
        "#,
        sandbox_run.id,
        sandbox_run.sandbox_id,
        sandbox_run.provider,
        sandbox_run.language,
        sandbox_run.exit_code,
        sandbox_run.duration_ms,
        sandbox_run.cost,
        sandbox_run.cpu_requested,
        sandbox_run.memory_requested,
        sandbox_run.has_gpu,
        sandbox_run.timeout_ms,
        sandbox_run.success,
        sandbox_run.cpu_percent,
        sandbox_run.memory_mb,
        sandbox_run.network_rx_bytes,
        sandbox_run.network_tx_bytes,
        sandbox_run.agent_id,
        sandbox_run.created_at
    )
    .fetch_one(state.db.pool())
    .await?;

    if let Some(agent_id) = sandbox_run.agent_id.clone() {
        sqlx::query!(
            r#"
            INSERT INTO edge_agent_runs (
                id, agent_id, sandbox_id, provider, language, duration_ms, exit_code,
                cpu_percent, memory_mb, network_rx_bytes, network_tx_bytes, finished_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            "#,
            Uuid::new_v4(),
            agent_id,
            sandbox_run.sandbox_id,
            sandbox_run.provider,
            sandbox_run.language,
            sandbox_run.duration_ms,
            sandbox_run.exit_code,
            sandbox_run.cpu_percent,
            sandbox_run.memory_mb,
            sandbox_run.network_rx_bytes,
            sandbox_run.network_tx_bytes,
            sandbox_run.created_at
        )
        .execute(state.db.pool())
        .await?;
    }

    Ok(Json(result))
}

pub async fn get_training_data(
    State(state): State<AppState>,
    Query(query): Query<TrainingDataQuery>,
) -> AppResult<Json<Vec<TrainingData>>> {
    let limit = query.limit.unwrap_or(1000).min(10000);

    let data = sqlx::query_as!(
        TrainingData,
        r#"
        SELECT id, features, actual_cost, actual_latency, success, provider, created_at
        FROM training_data
        WHERE created_at >= $1
        ORDER BY created_at DESC
        LIMIT $2
        "#,
        query.start,
        limit
    )
    .fetch_all(state.db.pool())
    .await?;

    Ok(Json(data))
}

pub async fn submit_training_data(
    State(state): State<AppState>,
    Json(request): Json<TrainingDataRequest>,
) -> AppResult<StatusCode> {
    // Extract relevant fields from sandbox result
    let result = request.sandbox_result;
    let provider = result["provider"].as_str().unwrap_or("unknown");
    let cost = result["cost"].as_f64().unwrap_or(0.0);
    let latency = result["duration"].as_f64().unwrap_or(0.0);
    let success = result["exitCode"].as_i64().unwrap_or(-1) == 0;

    let training_data = TrainingData {
        id: Uuid::new_v4(),
        features: request.features,
        actual_cost: cost,
        actual_latency: latency,
        success,
        provider: provider.to_string(),
        created_at: request.timestamp,
    };

    sqlx::query!(
        r#"
        INSERT INTO training_data (
            id, features, actual_cost, actual_latency, success, provider, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
        training_data.id,
        training_data.features,
        training_data.actual_cost,
        training_data.actual_latency,
        training_data.success,
        training_data.provider,
        training_data.created_at
    )
    .execute(state.db.pool())
    .await?;

    Ok(StatusCode::CREATED)
}

pub async fn get_provider_stats(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    Query(time_range): Query<TimeRange>,
) -> AppResult<Json<ProviderStats>> {
    let end = time_range.end.unwrap_or_else(Utc::now);

    let stats = sqlx::query!(
        r#"
        SELECT 
            AVG(duration_ms)::FLOAT8 as avg_latency,
            AVG(cost)::FLOAT8 as avg_cost,
            AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END)::FLOAT8 as success_rate,
            COUNT(*) as total_runs
        FROM sandbox_runs
        WHERE provider = $1 
          AND created_at >= $2 
          AND created_at <= $3
        "#,
        provider,
        time_range.start,
        end
    )
    .fetch_one(state.db.pool())
    .await?;

    Ok(Json(ProviderStats {
        avg_latency: stats.avg_latency.unwrap_or(0.0),
        avg_cost: stats.avg_cost.unwrap_or(0.0),
        success_rate: stats.success_rate.unwrap_or(0.0),
        total_runs: stats.total_runs.unwrap_or(0),
    }))
}

pub async fn track_prediction(
    State(state): State<AppState>,
    Json(request): Json<PredictionRequest>,
) -> AppResult<StatusCode> {
    let prediction = Prediction {
        id: Uuid::new_v4(),
        provider: request.prediction.provider.clone(),
        predicted_cost: request.prediction.predicted_cost,
        predicted_latency: request.prediction.predicted_latency,
        confidence: request.prediction.confidence,
        model_version: request.prediction.model_version.clone(),
        actual_cost: request.actual.as_ref().map(|a| a.cost),
        actual_latency: request.actual.as_ref().map(|a| a.latency),
        actual_success: request.actual.as_ref().map(|a| a.success),
        created_at: request.timestamp,
    };

    // Update metrics
    state
        .metrics
        .predictions_total
        .with_label_values(&[&prediction.model_version, &prediction.provider])
        .inc();

    if let Some(actual) = &request.actual {
        // Calculate prediction errors
        let cost_error =
            ((actual.cost - prediction.predicted_cost).abs() / actual.cost * 100.0).min(100.0);
        let latency_error =
            ((actual.latency - prediction.predicted_latency).abs() / actual.latency * 100.0)
                .min(100.0);

        state
            .metrics
            .prediction_errors
            .with_label_values(&[&prediction.model_version, "cost"])
            .observe(cost_error);

        state
            .metrics
            .prediction_errors
            .with_label_values(&[&prediction.model_version, "latency"])
            .observe(latency_error);
    }

    sqlx::query!(
        r#"
        INSERT INTO predictions (
            id, provider, predicted_cost, predicted_latency, confidence,
            model_version, actual_cost, actual_latency, actual_success, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        "#,
        prediction.id,
        prediction.provider,
        prediction.predicted_cost,
        prediction.predicted_latency,
        prediction.confidence,
        prediction.model_version,
        prediction.actual_cost,
        prediction.actual_latency,
        prediction.actual_success,
        prediction.created_at
    )
    .execute(state.db.pool())
    .await?;

    Ok(StatusCode::CREATED)
}

pub async fn get_model_performance(
    State(state): State<AppState>,
    Path(version): Path<String>,
    Query(time_range): Query<TimeRange>,
) -> AppResult<Json<ModelPerformance>> {
    let end = time_range.end.unwrap_or_else(Utc::now);

    let performance = sqlx::query!(
        r#"
        SELECT 
            COUNT(*) as total_predictions,
            AVG(ABS(actual_cost - predicted_cost))::FLOAT8 as avg_cost_error,
            AVG(ABS(actual_latency - predicted_latency))::FLOAT8 as avg_latency_error,
            AVG(CASE 
                WHEN actual_success IS NOT NULL AND provider = 
                    (SELECT provider FROM predictions p2 
                     WHERE p2.id = predictions.id 
                     ORDER BY confidence DESC 
                     LIMIT 1)
                THEN 1.0 
                ELSE 0.0 
            END)::FLOAT8 as provider_accuracy
        FROM predictions
        WHERE model_version = $1 
          AND created_at >= $2 
          AND created_at <= $3
          AND actual_cost IS NOT NULL
          AND actual_latency IS NOT NULL
        "#,
        version,
        time_range.start,
        end
    )
    .fetch_one(state.db.pool())
    .await?;

    Ok(Json(ModelPerformance {
        total_predictions: performance.total_predictions.unwrap_or(0),
        avg_cost_error: performance.avg_cost_error.unwrap_or(0.0),
        avg_latency_error: performance.avg_latency_error.unwrap_or(0.0),
        provider_accuracy: performance.provider_accuracy.unwrap_or(0.0),
    }))
}
