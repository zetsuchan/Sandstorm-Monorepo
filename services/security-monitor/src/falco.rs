use anyhow::Result;
use std::process::{Command, Stdio};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::RwLock;
use tracing::{error, info, warn};

use crate::models::SecurityEvent;

pub struct FalcoIntegration {
    sandbox_id: String,
    rules_path: String,
    process: RwLock<Option<Child>>,
    event_handlers: RwLock<Vec<Box<dyn Fn(SecurityEvent) + Send + Sync>>>,
}

impl FalcoIntegration {
    pub fn new(sandbox_id: &str, rules_path: &str) -> Result<Self> {
        Ok(Self {
            sandbox_id: sandbox_id.to_string(),
            rules_path: rules_path.to_string(),
            process: RwLock::new(None),
            event_handlers: RwLock::new(Vec::new()),
        })
    }

    pub async fn start(&self) -> Result<()> {
        let mut process_guard = self.process.write().await;
        
        if process_guard.is_some() {
            warn!("Falco integration already running for sandbox {}", self.sandbox_id);
            return Ok(());
        }

        // Start Falco process
        let mut cmd = Command::new("falco");
        cmd.args(&[
            "-o", "json_output=true",
            "-o", "json_include_output_property=true",
            "-r", &self.rules_path,
        ]);

        let mut child = tokio::process::Command::from(cmd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        // Start monitoring stdout for events
        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            let sandbox_id = self.sandbox_id.clone();
            let handlers = self.event_handlers.clone();
            
            tokio::spawn(async move {
                let mut lines = reader.lines();
                
                while let Ok(Some(line)) = lines.next_line().await {
                    match serde_json::from_str::<serde_json::Value>(&line) {
                        Ok(falco_event) => {
                            if let Some(security_event) = Self::parse_falco_event(&sandbox_id, &falco_event) {
                                let handlers_lock = handlers.read().await;
                                for handler in handlers_lock.iter() {
                                    handler(security_event.clone());
                                }
                            }
                        }
                        Err(e) => {
                            error!("Failed to parse Falco event: {} - {}", e, line);
                        }
                    }
                }
            });
        }

        *process_guard = Some(child);
        info!("Started Falco integration for sandbox {}", self.sandbox_id);
        
        Ok(())
    }

    pub async fn stop(&self) -> Result<()> {
        let mut process_guard = self.process.write().await;
        
        if let Some(mut child) = process_guard.take() {
            // Attempt graceful shutdown
            if let Err(e) = child.kill().await {
                error!("Failed to kill Falco process: {}", e);
            }
            
            // Wait for process to exit
            match child.wait().await {
                Ok(status) => {
                    info!("Falco process exited with status: {}", status);
                }
                Err(e) => {
                    error!("Error waiting for Falco process: {}", e);
                }
            }
        }
        
        Ok(())
    }

    pub async fn on_event<F>(&self, handler: F)
    where
        F: Fn(SecurityEvent) + Send + Sync + 'static,
    {
        let mut handlers = self.event_handlers.write().await;
        handlers.push(Box::new(handler));
    }

    fn parse_falco_event(sandbox_id: &str, falco_event: &serde_json::Value) -> Option<SecurityEvent> {
        let rule = falco_event.get("rule")?.as_str()?;
        let priority = falco_event.get("priority")?.as_str()?;
        let output = falco_event.get("output")?.as_str()?;
        let time = falco_event.get("time")?.as_str()?;
        let output_fields = falco_event.get("output_fields");

        // Parse timestamp
        let timestamp = chrono::DateTime::parse_from_rfc3339(time)
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .unwrap_or_else(|_| chrono::Utc::now());

        // Map Falco priority to our severity levels
        let severity = match priority.to_lowercase().as_str() {
            "emergency" | "alert" | "critical" => "critical",
            "error" => "high",
            "warning" => "medium",
            "notice" | "informational" | "debug" => "low",
            _ => "medium",
        };

        // Map rule to event type
        let event_type = Self::map_rule_to_event_type(rule);

        // Extract metadata from output fields
        let metadata = if let Some(fields) = output_fields {
            Some(serde_json::json!({
                "pid": fields.get("proc.pid"),
                "uid": fields.get("user.uid"),
                "gid": fields.get("group.gid"),
                "executable": fields.get("proc.name"),
                "syscall": fields.get("evt.type"),
                "filePath": fields.get("fd.name"),
            }))
        } else {
            None
        };

        Some(SecurityEvent {
            id: uuid::Uuid::new_v4().to_string(),
            event_type,
            severity: severity.to_string(),
            timestamp,
            sandbox_id: sandbox_id.to_string(),
            provider: "custom".to_string(),
            message: output.to_string(),
            details: output_fields.cloned().unwrap_or(serde_json::json!({})),
            metadata,
            falco_rule: Some(rule.to_string()),
            ebpf_trace: None,
        })
    }

    fn map_rule_to_event_type(rule: &str) -> String {
        // Map common Falco rules to our event types
        if rule.contains("Write below etc") || rule.contains("Read sensitive file") {
            "file_access".to_string()
        } else if rule.contains("Outbound Connection") || rule.contains("Inbound Connection") {
            "network_activity".to_string()
        } else if rule.contains("Spawned Process") || rule.contains("Run shell") {
            "process_spawn".to_string()
        } else if rule.contains("Sudo") || rule.contains("Change thread namespace") {
            "privilege_escalation".to_string()
        } else if rule.contains("Container escape") || rule.contains("Crypto mining") {
            "suspicious_behavior".to_string()
        } else {
            "policy_violation".to_string()
        }
    }
}

impl Drop for FalcoIntegration {
    fn drop(&mut self) {
        // Cleanup in destructor
        if let Ok(mut process_guard) = self.process.try_write() {
            if let Some(mut child) = process_guard.take() {
                if let Err(e) = std::process::Command::new("kill")
                    .arg(child.id().unwrap().to_string())
                    .output()
                {
                    error!("Failed to cleanup Falco process: {}", e);
                }
            }
        }
    }
}