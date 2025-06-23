use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub ebpf_enabled: bool,
    pub falco_enabled: bool,
    pub falco_rules_path: String,
    pub siem_webhook_url: Option<String>,
    pub siem_api_key: Option<String>,
    pub metrics_retention_days: u32,
    pub event_batch_size: usize,
    pub quarantine_auto_release: bool,
    pub quarantine_max_duration_hours: u32,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Config {
            port: std::env::var("PORT")
                .unwrap_or_else(|_| "8081".to_string())
                .parse()?,
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://postgres:postgres@localhost/sandstorm_security".to_string()),
            ebpf_enabled: std::env::var("EBPF_ENABLED")
                .unwrap_or_else(|_| "true".to_string())
                .parse()?,
            falco_enabled: std::env::var("FALCO_ENABLED")
                .unwrap_or_else(|_| "true".to_string())
                .parse()?,
            falco_rules_path: std::env::var("FALCO_RULES_PATH")
                .unwrap_or_else(|_| "/etc/falco/rules.yaml".to_string()),
            siem_webhook_url: std::env::var("SIEM_WEBHOOK_URL").ok(),
            siem_api_key: std::env::var("SIEM_API_KEY").ok(),
            metrics_retention_days: std::env::var("METRICS_RETENTION_DAYS")
                .unwrap_or_else(|_| "30".to_string())
                .parse()?,
            event_batch_size: std::env::var("EVENT_BATCH_SIZE")
                .unwrap_or_else(|_| "1000".to_string())
                .parse()?,
            quarantine_auto_release: std::env::var("QUARANTINE_AUTO_RELEASE")
                .unwrap_or_else(|_| "false".to_string())
                .parse()?,
            quarantine_max_duration_hours: std::env::var("QUARANTINE_MAX_DURATION_HOURS")
                .unwrap_or_else(|_| "24".to_string())
                .parse()?,
        })
    }
}