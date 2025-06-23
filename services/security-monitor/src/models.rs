use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityEvent {
    pub id: String,
    pub event_type: String,
    pub severity: String,
    pub timestamp: DateTime<Utc>,
    pub sandbox_id: String,
    pub provider: String,
    pub message: String,
    pub details: serde_json::Value,
    pub metadata: Option<serde_json::Value>,
    pub falco_rule: Option<String>,
    pub ebpf_trace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityPolicy {
    pub id: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub tier: String,
    pub rules: Vec<SecurityRule>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityRule {
    pub id: String,
    pub name: String,
    pub description: String,
    pub condition: RuleCondition,
    pub action: String,
    pub notifications: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleCondition {
    pub event_type: Option<String>,
    pub severity: Option<String>,
    pub pattern: Option<String>,
    pub threshold: Option<u32>,
    pub time_window_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuarantineRecord {
    pub id: String,
    pub sandbox_id: String,
    pub reason: String,
    pub triggered_by: SecurityEvent,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub auto_release: bool,
    pub release_conditions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alert {
    pub id: String,
    pub severity: String,
    pub message: String,
    pub timestamp: DateTime<Utc>,
    pub sandbox_id: Option<String>,
    pub acknowledged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregationResult {
    pub patterns: Vec<EventPattern>,
    pub anomalies: Vec<SecurityEvent>,
    pub correlation_groups: Vec<CorrelationGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventPattern {
    pub event_type: String,
    pub count: u64,
    pub severity: String,
    pub sandboxes: Vec<String>,
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrelationGroup {
    pub related_events: Vec<SecurityEvent>,
    pub correlation_type: String,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardMetrics {
    pub total_events: u64,
    pub events_by_type: std::collections::HashMap<String, u64>,
    pub events_by_severity: std::collections::HashMap<String, u64>,
    pub quarantined_sandboxes: u64,
    pub policy_violations: u64,
    pub compliance_score: f64,
    pub avg_response_time_ms: f64,
    pub active_monitors: u64,
    pub realtime_metrics: RealtimeMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RealtimeMetrics {
    pub events_per_second: f64,
    pub active_sandboxes: u64,
    pub quarantined_sandboxes: u64,
    pub critical_events: u64,
}

// Request/Response types
#[derive(Debug, Deserialize)]
pub struct EventQuery {
    pub sandbox_id: Option<String>,
    pub event_type: Option<String>,
    pub severity: Option<String>,
    pub start_time: Option<DateTime<Utc>>,
    pub end_time: Option<DateTime<Utc>>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

impl Default for EventQuery {
    fn default() -> Self {
        Self {
            sandbox_id: None,
            event_type: None,
            severity: None,
            start_time: None,
            end_time: None,
            limit: Some(100),
            offset: Some(0),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct AggregationQuery {
    pub start_time: Option<DateTime<Utc>>,
    pub end_time: Option<DateTime<Utc>>,
    pub window_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct MetricsQuery {
    pub time_range: Option<String>,
    pub granularity: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AlertQuery {
    pub acknowledged: Option<bool>,
    pub severity: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct QuarantineRequest {
    pub sandbox_id: String,
    pub reason: String,
    pub triggering_event: SecurityEvent,
}

#[derive(Debug, Deserialize)]
pub struct MonitoringRequest {
    pub provider: String,
    pub ebpf_programs: Option<Vec<String>>,
    pub falco_rules: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EventResponse {
    pub event_id: String,
    pub action_taken: String,
    pub matched_rules: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PolicyResponse {
    pub policy_id: String,
}

#[derive(Debug, Serialize)]
pub struct MonitoringResponse {
    pub sandbox_id: String,
    pub status: String,
    pub monitors_active: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct MonitoringStatus {
    pub sandbox_id: String,
    pub provider: String,
    pub start_time: DateTime<Utc>,
    pub uptime_seconds: u64,
    pub ebpf_active: bool,
    pub falco_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyEvaluation {
    pub action: String,
    pub reason: String,
    pub matched_rules: Vec<String>,
    pub confidence: f64,
}