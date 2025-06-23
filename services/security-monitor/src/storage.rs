use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::{postgres::PgPool, PgConnection, Row};
use uuid::Uuid;

use crate::models::*;

pub struct EventStore {
    pool: PgPool,
}

impl EventStore {
    pub async fn new(database_url: &str) -> Result<Self> {
        let pool = PgPool::connect(database_url).await?;
        Ok(Self { pool })
    }

    pub async fn run_migrations(&self) -> Result<()> {
        sqlx::migrate!("./migrations").run(&self.pool).await?;
        Ok(())
    }

    pub async fn store_event(&self, event: &SecurityEvent) -> Result<String> {
        let event_id = Uuid::new_v4().to_string();
        
        sqlx::query!(
            r#"
            INSERT INTO security_events (
                id, event_type, severity, timestamp, sandbox_id, provider,
                message, details, metadata, falco_rule, ebpf_trace
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            "#,
            event_id,
            event.event_type,
            event.severity,
            event.timestamp,
            event.sandbox_id,
            event.provider,
            event.message,
            &event.details,
            &event.metadata,
            event.falco_rule,
            event.ebpf_trace
        )
        .execute(&self.pool)
        .await?;

        Ok(event_id)
    }

    pub async fn list_events(&self, query: EventQuery) -> Result<Vec<SecurityEvent>> {
        let mut sql = String::from(
            "SELECT id, event_type, severity, timestamp, sandbox_id, provider, 
             message, details, metadata, falco_rule, ebpf_trace 
             FROM security_events WHERE 1=1"
        );
        
        let mut bind_count = 0;
        
        if query.sandbox_id.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND sandbox_id = ${}", bind_count));
        }
        
        if query.event_type.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND event_type = ${}", bind_count));
        }
        
        if query.severity.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND severity = ${}", bind_count));
        }
        
        if query.start_time.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND timestamp >= ${}", bind_count));
        }
        
        if query.end_time.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND timestamp <= ${}", bind_count));
        }
        
        sql.push_str(" ORDER BY timestamp DESC");
        
        if let Some(limit) = query.limit {
            bind_count += 1;
            sql.push_str(&format!(" LIMIT ${}", bind_count));
        }
        
        if let Some(offset) = query.offset {
            bind_count += 1;
            sql.push_str(&format!(" OFFSET ${}", bind_count));
        }

        let mut query_builder = sqlx::query(&sql);
        
        if let Some(ref sandbox_id) = query.sandbox_id {
            query_builder = query_builder.bind(sandbox_id);
        }
        if let Some(ref event_type) = query.event_type {
            query_builder = query_builder.bind(event_type);
        }
        if let Some(ref severity) = query.severity {
            query_builder = query_builder.bind(severity);
        }
        if let Some(start_time) = query.start_time {
            query_builder = query_builder.bind(start_time);
        }
        if let Some(end_time) = query.end_time {
            query_builder = query_builder.bind(end_time);
        }
        if let Some(limit) = query.limit {
            query_builder = query_builder.bind(limit as i64);
        }
        if let Some(offset) = query.offset {
            query_builder = query_builder.bind(offset as i64);
        }

        let rows = query_builder.fetch_all(&self.pool).await?;
        
        let events = rows
            .into_iter()
            .map(|row| SecurityEvent {
                id: row.get("id"),
                event_type: row.get("event_type"),
                severity: row.get("severity"),
                timestamp: row.get("timestamp"),
                sandbox_id: row.get("sandbox_id"),
                provider: row.get("provider"),
                message: row.get("message"),
                details: row.get("details"),
                metadata: row.get("metadata"),
                falco_rule: row.get("falco_rule"),
                ebpf_trace: row.get("ebpf_trace"),
            })
            .collect();

        Ok(events)
    }

    pub async fn store_quarantine(&self, record: &QuarantineRecord) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO quarantine_records (
                id, sandbox_id, reason, triggered_by, start_time, end_time,
                auto_release, release_conditions
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
            record.id,
            record.sandbox_id,
            record.reason,
            serde_json::to_value(&record.triggered_by)?,
            record.start_time,
            record.end_time,
            record.auto_release,
            serde_json::to_value(&record.release_conditions)?
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn update_quarantine_end_time(
        &self,
        quarantine_id: &str,
        end_time: DateTime<Utc>,
    ) -> Result<()> {
        sqlx::query!(
            "UPDATE quarantine_records SET end_time = $1 WHERE id = $2",
            end_time,
            quarantine_id
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn list_quarantines(&self, active_only: bool) -> Result<Vec<QuarantineRecord>> {
        let sql = if active_only {
            "SELECT * FROM quarantine_records WHERE end_time IS NULL ORDER BY start_time DESC"
        } else {
            "SELECT * FROM quarantine_records ORDER BY start_time DESC"
        };

        let rows = sqlx::query(sql).fetch_all(&self.pool).await?;
        
        let records = rows
            .into_iter()
            .map(|row| {
                let triggered_by: serde_json::Value = row.get("triggered_by");
                let triggered_by: SecurityEvent = serde_json::from_value(triggered_by)?;
                
                let release_conditions: Option<serde_json::Value> = row.get("release_conditions");
                let release_conditions: Option<Vec<String>> = release_conditions
                    .map(|v| serde_json::from_value(v))
                    .transpose()?;

                Ok(QuarantineRecord {
                    id: row.get("id"),
                    sandbox_id: row.get("sandbox_id"),
                    reason: row.get("reason"),
                    triggered_by,
                    start_time: row.get("start_time"),
                    end_time: row.get("end_time"),
                    auto_release: row.get("auto_release"),
                    release_conditions,
                })
            })
            .collect::<Result<Vec<_>>>()?;

        Ok(records)
    }

    pub async fn store_alert(&self, alert: &Alert) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO alerts (
                id, severity, message, timestamp, sandbox_id, acknowledged
            ) VALUES ($1, $2, $3, $4, $5, $6)
            "#,
            alert.id,
            alert.severity,
            alert.message,
            alert.timestamp,
            alert.sandbox_id,
            alert.acknowledged
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn list_alerts(&self, query: AlertQuery) -> Result<Vec<Alert>> {
        let mut sql = String::from(
            "SELECT id, severity, message, timestamp, sandbox_id, acknowledged 
             FROM alerts WHERE 1=1"
        );
        
        let mut bind_count = 0;
        
        if let Some(acknowledged) = query.acknowledged {
            bind_count += 1;
            sql.push_str(&format!(" AND acknowledged = ${}", bind_count));
        }
        
        if query.severity.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND severity = ${}", bind_count));
        }
        
        sql.push_str(" ORDER BY timestamp DESC");
        
        if let Some(limit) = query.limit {
            bind_count += 1;
            sql.push_str(&format!(" LIMIT ${}", bind_count));
        }

        let mut query_builder = sqlx::query(&sql);
        
        if let Some(acknowledged) = query.acknowledged {
            query_builder = query_builder.bind(acknowledged);
        }
        if let Some(ref severity) = query.severity {
            query_builder = query_builder.bind(severity);
        }
        if let Some(limit) = query.limit {
            query_builder = query_builder.bind(limit as i64);
        }

        let rows = query_builder.fetch_all(&self.pool).await?;
        
        let alerts = rows
            .into_iter()
            .map(|row| Alert {
                id: row.get("id"),
                severity: row.get("severity"),
                message: row.get("message"),
                timestamp: row.get("timestamp"),
                sandbox_id: row.get("sandbox_id"),
                acknowledged: row.get("acknowledged"),
            })
            .collect();

        Ok(alerts)
    }

    pub async fn acknowledge_alert(&self, alert_id: &str) -> Result<()> {
        sqlx::query!(
            "UPDATE alerts SET acknowledged = true WHERE id = $1",
            alert_id
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn aggregate_old_events(&self) -> Result<u64> {
        // This would implement event aggregation logic
        // For now, just return 0
        Ok(0)
    }

    pub async fn cleanup_old_events(&self, retention_days: i32) -> Result<u64> {
        let cutoff = Utc::now() - chrono::Duration::days(retention_days as i64);
        
        let result = sqlx::query!(
            "DELETE FROM security_events WHERE timestamp < $1",
            cutoff
        )
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
    }
}