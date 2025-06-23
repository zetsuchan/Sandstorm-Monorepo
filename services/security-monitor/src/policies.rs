use anyhow::Result;
use dashmap::DashMap;
use std::sync::Arc;
use tracing::info;

use crate::models::*;

pub struct PolicyEngine {
    policies: Arc<DashMap<String, SecurityPolicy>>,
}

impl PolicyEngine {
    pub fn new() -> Self {
        Self {
            policies: Arc::new(DashMap::new()),
        }
    }

    pub async fn load_default_policies(&self) -> Result<()> {
        // Basic security policy
        let basic_policy = SecurityPolicy {
            id: "policy_basic".to_string(),
            name: "Basic Security Policy".to_string(),
            description: "Standard security policy for general sandbox protection".to_string(),
            enabled: true,
            tier: "basic".to_string(),
            rules: vec![
                SecurityRule {
                    id: "rule_basic_1".to_string(),
                    name: "Block Critical File Access".to_string(),
                    description: "Prevent access to critical system files".to_string(),
                    condition: RuleCondition {
                        event_type: Some("file_access".to_string()),
                        severity: None,
                        pattern: Some("(/etc/passwd|/etc/shadow|/root/.*)".to_string()),
                        threshold: None,
                        time_window_ms: None,
                    },
                    action: "deny".to_string(),
                    notifications: None,
                },
                SecurityRule {
                    id: "rule_basic_2".to_string(),
                    name: "Alert on Privilege Escalation".to_string(),
                    description: "Alert when privilege escalation is detected".to_string(),
                    condition: RuleCondition {
                        event_type: Some("privilege_escalation".to_string()),
                        severity: None,
                        pattern: None,
                        threshold: None,
                        time_window_ms: None,
                    },
                    action: "alert".to_string(),
                    notifications: None,
                },
            ],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };

        // Shield tier policy
        let shield_policy = SecurityPolicy {
            id: "policy_shield".to_string(),
            name: "Shield Security Policy".to_string(),
            description: "Enhanced security policy with auto-quarantine".to_string(),
            enabled: true,
            tier: "shield".to_string(),
            rules: vec![
                SecurityRule {
                    id: "rule_shield_1".to_string(),
                    name: "Auto-Quarantine Critical Events".to_string(),
                    description: "Automatically quarantine sandboxes with critical security events".to_string(),
                    condition: RuleCondition {
                        event_type: None,
                        severity: Some("critical".to_string()),
                        pattern: None,
                        threshold: None,
                        time_window_ms: None,
                    },
                    action: "quarantine".to_string(),
                    notifications: Some(vec!["security-ops@company.com".to_string()]),
                },
                SecurityRule {
                    id: "rule_shield_2".to_string(),
                    name: "Block Suspicious Behavior".to_string(),
                    description: "Block and quarantine suspicious behavior patterns".to_string(),
                    condition: RuleCondition {
                        event_type: Some("suspicious_behavior".to_string()),
                        severity: None,
                        pattern: None,
                        threshold: None,
                        time_window_ms: None,
                    },
                    action: "quarantine".to_string(),
                    notifications: None,
                },
            ],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };

        self.policies.insert(basic_policy.id.clone(), basic_policy);
        self.policies.insert(shield_policy.id.clone(), shield_policy);

        info!("Loaded {} default policies", self.policies.len());
        Ok(())
    }

    pub async fn add_policy(&self, policy: SecurityPolicy) -> Result<String> {
        let policy_id = policy.id.clone();
        self.policies.insert(policy_id.clone(), policy);
        Ok(policy_id)
    }

    pub async fn update_policy(&self, policy_id: &str, mut policy: SecurityPolicy) -> Result<()> {
        policy.updated_at = chrono::Utc::now();
        self.policies.insert(policy_id.to_string(), policy);
        Ok(())
    }

    pub async fn remove_policy(&self, policy_id: &str) -> Result<()> {
        self.policies.remove(policy_id);
        Ok(())
    }

    pub async fn get_policy(&self, policy_id: &str) -> Result<Option<SecurityPolicy>> {
        Ok(self.policies.get(policy_id).map(|p| p.clone()))
    }

    pub async fn list_policies(&self) -> Result<Vec<SecurityPolicy>> {
        Ok(self.policies.iter().map(|p| p.clone()).collect())
    }

    pub async fn evaluate(&self, event: &SecurityEvent) -> Result<PolicyEvaluation> {
        let mut matched_rules = Vec::new();
        let mut final_action = "allow".to_string();
        let mut final_reason = String::new();
        let mut confidence = 0.0;

        for policy in self.policies.iter() {
            if !policy.enabled {
                continue;
            }

            for rule in &policy.rules {
                if self.matches_rule(event, rule)? {
                    matched_rules.push(rule.name.clone());
                    
                    // Use the most restrictive action
                    if self.is_more_restrictive(&rule.action, &final_action) {
                        final_action = rule.action.clone();
                        final_reason = format!("Rule '{}' triggered", rule.name);
                        confidence = 0.9; // High confidence for rule matches
                    }
                }
            }
        }

        Ok(PolicyEvaluation {
            action: final_action,
            reason: final_reason,
            matched_rules,
            confidence,
        })
    }

    fn matches_rule(&self, event: &SecurityEvent, rule: &SecurityRule) -> Result<bool> {
        let condition = &rule.condition;

        // Check event type
        if let Some(ref event_type) = condition.event_type {
            if event.event_type != *event_type {
                return Ok(false);
            }
        }

        // Check severity
        if let Some(ref severity) = condition.severity {
            if !self.is_severity_match(&event.severity, severity) {
                return Ok(false);
            }
        }

        // Check pattern
        if let Some(ref pattern) = condition.pattern {
            let event_string = serde_json::to_string(event)?;
            let regex = regex::Regex::new(pattern)?;
            if !regex.is_match(&event_string) {
                return Ok(false);
            }
        }

        // Check threshold (would require event counting in real implementation)
        if condition.threshold.is_some() && condition.time_window_ms.is_some() {
            // In a real implementation, this would count similar events within the time window
            // For now, we'll assume the threshold is met
        }

        Ok(true)
    }

    fn is_severity_match(&self, event_severity: &str, rule_severity: &str) -> bool {
        let severity_levels = [
            ("low", 1),
            ("medium", 2),
            ("high", 3),
            ("critical", 4),
        ];

        let event_level = severity_levels
            .iter()
            .find(|(s, _)| *s == event_severity)
            .map(|(_, l)| *l)
            .unwrap_or(0);

        let rule_level = severity_levels
            .iter()
            .find(|(s, _)| *s == rule_severity)
            .map(|(_, l)| *l)
            .unwrap_or(0);

        event_level >= rule_level
    }

    fn is_more_restrictive(&self, action1: &str, action2: &str) -> bool {
        let restrictiveness = [
            ("allow", 0),
            ("alert", 1),
            ("deny", 2),
            ("quarantine", 3),
        ];

        let level1 = restrictiveness
            .iter()
            .find(|(a, _)| *a == action1)
            .map(|(_, l)| *l)
            .unwrap_or(0);

        let level2 = restrictiveness
            .iter()
            .find(|(a, _)| *a == action2)
            .map(|(_, l)| *l)
            .unwrap_or(0);

        level1 > level2
    }
}