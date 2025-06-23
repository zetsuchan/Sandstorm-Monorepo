use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::models::*;

pub use SecurityEvent;

pub struct EventAggregator;

impl EventAggregator {
    pub fn new() -> Self {
        Self
    }

    pub async fn aggregate(
        &self,
        events: &[SecurityEvent],
        window_ms: u64,
    ) -> Result<AggregationResult> {
        let patterns = self.identify_patterns(events, window_ms);
        let anomalies = self.detect_anomalies(events);
        let correlation_groups = self.correlate_events(events);

        Ok(AggregationResult {
            patterns,
            anomalies,
            correlation_groups,
        })
    }

    fn identify_patterns(&self, events: &[SecurityEvent], window_ms: u64) -> Vec<EventPattern> {
        let mut patterns: HashMap<String, EventPattern> = HashMap::new();
        let window_start = Utc::now() - chrono::Duration::milliseconds(window_ms as i64);

        for event in events.iter().filter(|e| e.timestamp >= window_start) {
            let key = format!("{}:{}", event.event_type, event.severity);
            
            if let Some(pattern) = patterns.get_mut(&key) {
                pattern.count += 1;
                if !pattern.sandboxes.contains(&event.sandbox_id) {
                    pattern.sandboxes.push(event.sandbox_id.clone());
                }
                if event.timestamp > pattern.last_seen {
                    pattern.last_seen = event.timestamp;
                }
            } else {
                patterns.insert(
                    key,
                    EventPattern {
                        event_type: event.event_type.clone(),
                        count: 1,
                        severity: event.severity.clone(),
                        sandboxes: vec![event.sandbox_id.clone()],
                        first_seen: event.timestamp,
                        last_seen: event.timestamp,
                    },
                );
            }
        }

        let mut result: Vec<_> = patterns.into_values().collect();
        result.sort_by(|a, b| b.count.cmp(&a.count));
        result
    }

    fn detect_anomalies(&self, events: &[SecurityEvent]) -> Vec<SecurityEvent> {
        let mut anomalies = Vec::new();
        
        // Simple anomaly detection based on event frequency
        let mut event_counts: HashMap<String, u64> = HashMap::new();
        
        for event in events {
            let key = format!("{}:{}", event.event_type, event.sandbox_id);
            *event_counts.entry(key).or_insert(0) += 1;
        }

        // Mark events as anomalous if they occur frequently in a short time
        for event in events {
            let key = format!("{}:{}", event.event_type, event.sandbox_id);
            if let Some(&count) = event_counts.get(&key) {
                if count > 10 || event.severity == "critical" {
                    anomalies.push(event.clone());
                }
            }
        }

        // Remove duplicates
        anomalies.sort_by(|a, b| a.id.cmp(&b.id));
        anomalies.dedup_by(|a, b| a.id == b.id);

        anomalies
    }

    fn correlate_events(&self, events: &[SecurityEvent]) -> Vec<CorrelationGroup> {
        let mut correlation_groups = Vec::new();
        
        // Time-based correlation
        correlation_groups.extend(self.correlate_by_time(events, 60000)); // 1 minute window
        
        // Sandbox-based correlation
        correlation_groups.extend(self.correlate_by_sandbox(events));
        
        // Attack pattern correlation
        correlation_groups.extend(self.correlate_attack_patterns(events));

        correlation_groups
    }

    fn correlate_by_time(&self, events: &[SecurityEvent], window_ms: u64) -> Vec<CorrelationGroup> {
        let mut groups = Vec::new();
        let window_duration = chrono::Duration::milliseconds(window_ms as i64);

        for (i, event) in events.iter().enumerate() {
            let mut related = vec![event.clone()];
            
            for other_event in events.iter().skip(i + 1) {
                if (other_event.timestamp - event.timestamp).abs() <= window_duration {
                    related.push(other_event.clone());
                }
            }

            if related.len() > 1 {
                groups.push(CorrelationGroup {
                    related_events: related,
                    correlation_type: "temporal".to_string(),
                    confidence: 0.7,
                });
            }
        }

        groups
    }

    fn correlate_by_sandbox(&self, events: &[SecurityEvent]) -> Vec<CorrelationGroup> {
        let mut groups = Vec::new();
        let mut sandbox_events: HashMap<String, Vec<SecurityEvent>> = HashMap::new();

        // Group events by sandbox
        for event in events {
            sandbox_events
                .entry(event.sandbox_id.clone())
                .or_default()
                .push(event.clone());
        }

        // Find sandboxes with multiple high-severity events
        for (sandbox_id, events) in sandbox_events {
            let high_severity_events: Vec<_> = events
                .into_iter()
                .filter(|e| e.severity == "high" || e.severity == "critical")
                .collect();

            if high_severity_events.len() > 1 {
                groups.push(CorrelationGroup {
                    related_events: high_severity_events,
                    correlation_type: "sandbox_compromise".to_string(),
                    confidence: 0.9,
                });
            }
        }

        groups
    }

    fn correlate_attack_patterns(&self, events: &[SecurityEvent]) -> Vec<CorrelationGroup> {
        let mut groups = Vec::new();
        
        // Known attack patterns
        let attack_patterns = vec![
            vec!["file_access", "process_spawn", "privilege_escalation"],
            vec!["file_access", "network_activity"],
            vec!["network_activity", "process_spawn", "network_activity"],
        ];

        // Group events by sandbox and sort by time
        let mut sandbox_events: HashMap<String, Vec<SecurityEvent>> = HashMap::new();
        for event in events {
            sandbox_events
                .entry(event.sandbox_id.clone())
                .or_default()
                .push(event.clone());
        }

        for (_, mut events) in sandbox_events {
            events.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

            for pattern in &attack_patterns {
                if let Some(matched_events) = self.find_sequence(&events, pattern) {
                    groups.push(CorrelationGroup {
                        related_events: matched_events,
                        correlation_type: "attack_chain".to_string(),
                        confidence: 0.8,
                    });
                }
            }
        }

        groups
    }

    fn find_sequence(&self, events: &[SecurityEvent], sequence: &[&str]) -> Option<Vec<SecurityEvent>> {
        let mut matched = Vec::new();
        let mut sequence_index = 0;

        for event in events {
            if event.event_type == sequence[sequence_index] {
                matched.push(event.clone());
                sequence_index += 1;
                
                if sequence_index == sequence.len() {
                    return Some(matched);
                }
            }
        }

        None
    }
}