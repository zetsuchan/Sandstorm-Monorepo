use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json;
use sqlx::Row;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::{
    error::AppResult,
    models::{
        EdgeAgentMetricsDto, EdgeAgentOverview, EdgeAgentRunRecord, EdgeAgentRunSummary,
        EdgeAgentStatusDto, EdgeAgentStatusRecord, EdgeLogBatchRequest, EdgeMetricsBatchRequest,
        EdgeStatusBatchRequest,
    },
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct RunsQuery {
    pub limit: Option<i64>,
    pub since: Option<DateTime<Utc>>,
}

pub async fn ingest_status(
    State(state): State<AppState>,
    Json(payload): Json<EdgeStatusBatchRequest>,
) -> AppResult<StatusCode> {
    for item in payload.items {
        let payload_json = serde_json::to_value(&item)?;
        let queue_depth = extract_number(&item.sandboxes, "queued").unwrap_or(0.0);
        let running = extract_number(&item.sandboxes, "running").unwrap_or(0.0);
        let completed = extract_number(&item.sandboxes, "completed").unwrap_or(0.0);
        let failed = extract_number(&item.sandboxes, "failed").unwrap_or(0.0);
        let cpu_percent = extract_number(&item.resources, "cpuUsagePercent");
        let memory_percent = match (
            extract_number(&item.resources, "usedMemoryMB"),
            extract_number(&item.resources, "totalMemoryMB"),
        ) {
            (Some(used), Some(total)) if total > 0.0 => Some((used / total) * 100.0),
            _ => None,
        };
        let public_endpoint = item
            .connectivity
            .get("publicEndpoint")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());

        sqlx::query!(
            r#"
            INSERT INTO edge_agent_status (
                agent_id, agent_name, status, version, queue_depth, running, completed, failed,
                cpu_percent, memory_percent, last_heartbeat, public_endpoint, payload
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (agent_id) DO UPDATE SET
                agent_name = EXCLUDED.agent_name,
                status = EXCLUDED.status,
                version = EXCLUDED.version,
                queue_depth = EXCLUDED.queue_depth,
                running = EXCLUDED.running,
                completed = EXCLUDED.completed,
                failed = EXCLUDED.failed,
                cpu_percent = EXCLUDED.cpu_percent,
                memory_percent = EXCLUDED.memory_percent,
                last_heartbeat = EXCLUDED.last_heartbeat,
                public_endpoint = EXCLUDED.public_endpoint,
                payload = EXCLUDED.payload
            "#,
            item.agent_id,
            item.agent_name,
            item.status,
            item.version,
            clamp_i32(queue_depth),
            clamp_i32(running),
            clamp_i32(completed),
            clamp_i32(failed),
            cpu_percent,
            memory_percent,
            item.last_health_check,
            public_endpoint,
            payload_json
        )
        .execute(state.db.pool())
        .await?;
    }

    Ok(StatusCode::ACCEPTED)
}

pub async fn ingest_metrics(
    State(state): State<AppState>,
    Json(payload): Json<EdgeMetricsBatchRequest>,
) -> AppResult<StatusCode> {
    for entry in payload.items {
        let payload_json = serde_json::to_value(&entry)?;
        let cpu_percent = entry
            .system
            .get("cpuPercent")
            .and_then(|value| value.as_f64());
        let memory_percent = entry.system.get("memory").and_then(|memory| {
            let used = memory.get("usedMB").and_then(|value| value.as_f64());
            let total = memory.get("totalMB").and_then(|value| value.as_f64());
            match (used, total) {
                (Some(u), Some(t)) if t > 0.0 => Some((u / t) * 100.0),
                _ => None,
            }
        });

        sqlx::query!(
            r#"
            INSERT INTO edge_agent_metrics (id, agent_id, recorded_at, payload)
            VALUES ($1, $2, $3, $4)
            "#,
            Uuid::new_v4(),
            entry.agent_id,
            entry.timestamp,
            payload_json
        )
        .execute(state.db.pool())
        .await?;

        sqlx::query!(
            r#"
            UPDATE edge_agent_status
            SET
                queue_depth = $2,
                running = $3,
                completed = $4,
                failed = $5,
                cpu_percent = COALESCE($6, cpu_percent),
                memory_percent = COALESCE($7, memory_percent),
                last_heartbeat = GREATEST(last_heartbeat, $8)
            WHERE agent_id = $1
            "#,
            entry.agent_id,
            clamp_i32(entry.queue_depth as f64),
            clamp_i32(entry.running as f64),
            clamp_i32(entry.completed as f64),
            clamp_i32(entry.failed as f64),
            cpu_percent,
            memory_percent,
            entry.timestamp
        )
        .execute(state.db.pool())
        .await?;

        if let Some(sandbox_run) = entry.sandbox_run.as_ref() {
            match serde_json::from_value::<EdgeAgentRunSummary>(sandbox_run.clone()) {
                Ok(summary) => {
                    sqlx::query!(
                        r#"
                        INSERT INTO edge_agent_runs (
                            id, agent_id, sandbox_id, provider, language, duration_ms, exit_code,
                            cpu_percent, memory_mb, network_rx_bytes, network_tx_bytes, finished_at
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                        "#,
                        Uuid::new_v4(),
                        entry.agent_id.clone(),
                        summary.sandbox_id,
                        summary.provider,
                        summary.language,
                        summary.duration_ms,
                        summary.exit_code,
                        summary.cpu_percent,
                        summary.memory_mb,
                        summary.network_rx_bytes,
                        summary.network_tx_bytes,
                        summary.finished_at
                    )
                    .execute(state.db.pool())
                    .await?;
                }
                Err(error) => warn!(
                    ?error,
                    "failed to decode sandbox run sample from edge metrics"
                ),
            }
        }
    }

    Ok(StatusCode::ACCEPTED)
}

pub async fn ingest_logs(Json(payload): Json<EdgeLogBatchRequest>) -> AppResult<StatusCode> {
    for log in payload.items {
        match log.level.as_str() {
            "error" => {
                warn!(message = %log.message, context = ?log.context, "edge agent error log")
            }
            "warn" => warn!(message = %log.message, context = ?log.context, "edge agent warning"),
            "info" => info!(message = %log.message, context = ?log.context, "edge agent info"),
            _ => debug!(message = %log.message, context = ?log.context, "edge agent log"),
        }
    }
    Ok(StatusCode::ACCEPTED)
}

pub async fn list_agents(State(state): State<AppState>) -> AppResult<Json<Vec<EdgeAgentOverview>>> {
    let rows = sqlx::query(
        r#"
        SELECT
            s.agent_id,
            s.agent_name,
            s.status,
            s.version,
            s.queue_depth,
            s.running,
            s.completed,
            s.failed,
            s.cpu_percent,
            s.memory_percent,
            s.last_heartbeat,
            s.public_endpoint,
            r.sandbox_id,
            r.provider,
            r.language,
            r.duration_ms,
            r.exit_code,
            r.cpu_percent AS run_cpu_percent,
            r.memory_mb AS run_memory_mb,
            r.network_rx_bytes AS run_network_rx_bytes,
            r.network_tx_bytes AS run_network_tx_bytes,
            r.finished_at AS run_finished_at
        FROM edge_agent_status s
        LEFT JOIN LATERAL (
            SELECT sandbox_id, provider, language, duration_ms, exit_code, cpu_percent, memory_mb, network_rx_bytes, network_tx_bytes, finished_at
            FROM edge_agent_runs
            WHERE agent_id = s.agent_id
            ORDER BY finished_at DESC
            LIMIT 1
        ) r ON TRUE
        ORDER BY s.agent_id
        "#,
    )
    .fetch_all(state.db.pool())
    .await?;

    let mut agents = Vec::with_capacity(rows.len());
    for row in rows {
        let agent_id: String = row.try_get("agent_id")?;
        let sandbox_id: Option<String> = row.try_get("sandbox_id")?;
        let sandbox_run = if let Some(id) = sandbox_id {
            Some(EdgeAgentRunSummary {
                sandbox_id: id,
                provider: row.try_get("provider")?,
                language: row.try_get("language")?,
                duration_ms: row.try_get::<i64, _>("duration_ms")?,
                exit_code: row.try_get::<i32, _>("exit_code")?,
                cpu_percent: row.try_get("run_cpu_percent")?,
                memory_mb: row.try_get("run_memory_mb")?,
                network_rx_bytes: row.try_get("run_network_rx_bytes")?,
                network_tx_bytes: row.try_get("run_network_tx_bytes")?,
                finished_at: row.try_get("run_finished_at")?,
            })
        } else {
            None
        };

        agents.push(EdgeAgentOverview {
            agent_id,
            agent_name: row.try_get("agent_name")?,
            status: row.try_get("status")?,
            version: row.try_get("version")?,
            queue_depth: row.try_get::<i32, _>("queue_depth")?,
            running: row.try_get::<i32, _>("running")?,
            completed: row.try_get::<i32, _>("completed")?,
            failed: row.try_get::<i32, _>("failed")?,
            cpu_percent: row.try_get("cpu_percent")?,
            memory_percent: row.try_get("memory_percent")?,
            last_heartbeat: row.try_get("last_heartbeat")?,
            public_endpoint: row.try_get("public_endpoint")?,
            sandbox_run,
        });
    }

    Ok(Json(agents))
}

pub async fn list_agent_runs(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    Query(query): Query<RunsQuery>,
) -> AppResult<Json<Vec<EdgeAgentRunSummary>>> {
    let limit = query.limit.unwrap_or(20).clamp(1, 100);
    let since = query
        .since
        .unwrap_or_else(|| Utc::now() - chrono::Duration::hours(24));

    let rows = sqlx::query_as!(
        EdgeAgentRunRecord,
        r#"
        SELECT id, agent_id, sandbox_id, provider, language, duration_ms, exit_code,
               cpu_percent, memory_mb, network_rx_bytes, network_tx_bytes, finished_at
        FROM edge_agent_runs
        WHERE agent_id = $1 AND finished_at >= $2
        ORDER BY finished_at DESC
        LIMIT $3
        "#,
        agent_id,
        since,
        limit
    )
    .fetch_all(state.db.pool())
    .await?;

    let runs = rows
        .into_iter()
        .map(|record| EdgeAgentRunSummary {
            sandbox_id: record.sandbox_id,
            provider: record.provider,
            language: record.language,
            duration_ms: record.duration_ms,
            exit_code: record.exit_code,
            cpu_percent: record.cpu_percent,
            memory_mb: record.memory_mb,
            network_rx_bytes: record.network_rx_bytes,
            network_tx_bytes: record.network_tx_bytes,
            finished_at: record.finished_at,
        })
        .collect();

    Ok(Json(runs))
}

fn extract_number(value: &serde_json::Value, field: &str) -> Option<f64> {
    value.get(field).and_then(|v| v.as_f64())
}

fn clamp_i32(value: f64) -> i32 {
    value.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32
}
