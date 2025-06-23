use anyhow::Result;
use prometheus::{Counter, Gauge, Histogram, Registry, Encoder, TextEncoder};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::models::*;

pub struct MetricsCollector {
    registry: Registry,
    events_total: Counter,
    events_by_type: Arc<RwLock<HashMap<String, Counter>>>,
    events_by_severity: Arc<RwLock<HashMap<String, Counter>>>,
    quarantined_sandboxes: Gauge,
    active_monitors: Gauge,
    policy_violations: Counter,
    response_time: Histogram,
}

impl MetricsCollector {
    pub fn new() -> Self {
        let registry = Registry::new();
        
        let events_total = Counter::new(
            "security_events_total",
            "Total number of security events processed"
        ).unwrap();
        
        let quarantined_sandboxes = Gauge::new(
            "quarantined_sandboxes",
            "Number of currently quarantined sandboxes"
        ).unwrap();
        
        let active_monitors = Gauge::new(
            "active_monitors",
            "Number of active sandbox monitors"
        ).unwrap();
        
        let policy_violations = Counter::new(
            "policy_violations_total",
            "Total number of policy violations"
        ).unwrap();
        
        let response_time = Histogram::with_opts(
            prometheus::HistogramOpts::new(
                "security_response_time_seconds",
                "Time taken to process security events"
            ).buckets(vec![0.001, 0.01, 0.1, 1.0, 10.0])
        ).unwrap();

        registry.register(Box::new(events_total.clone())).unwrap();
        registry.register(Box::new(quarantined_sandboxes.clone())).unwrap();
        registry.register(Box::new(active_monitors.clone())).unwrap();
        registry.register(Box::new(policy_violations.clone())).unwrap();
        registry.register(Box::new(response_time.clone())).unwrap();

        Self {
            registry,
            events_total,
            events_by_type: Arc::new(RwLock::new(HashMap::new())),
            events_by_severity: Arc::new(RwLock::new(HashMap::new())),
            quarantined_sandboxes,
            active_monitors,
            policy_violations,
            response_time,
        }
    }

    pub fn record_event(&self, event: &SecurityEvent) {
        self.events_total.inc();
        
        // Record event type
        tokio::spawn({
            let event_type = event.event_type.clone();
            let events_by_type = self.events_by_type.clone();
            let registry = self.registry.clone();
            
            async move {
                let mut counters = events_by_type.write().await;
                if !counters.contains_key(&event_type) {
                    let counter = Counter::new(
                        format!("security_events_by_type_{}", event_type),
                        format!("Number of {} events", event_type)
                    ).unwrap();
                    registry.register(Box::new(counter.clone())).unwrap();
                    counters.insert(event_type.clone(), counter);
                }
                if let Some(counter) = counters.get(&event_type) {
                    counter.inc();
                }
            }
        });

        // Record severity
        tokio::spawn({
            let severity = event.severity.clone();
            let events_by_severity = self.events_by_severity.clone();
            let registry = self.registry.clone();
            
            async move {
                let mut counters = events_by_severity.write().await;
                if !counters.contains_key(&severity) {
                    let counter = Counter::new(
                        format!("security_events_by_severity_{}", severity),
                        format!("Number of {} severity events", severity)
                    ).unwrap();
                    registry.register(Box::new(counter.clone())).unwrap();
                    counters.insert(severity.clone(), counter);
                }
                if let Some(counter) = counters.get(&severity) {
                    counter.inc();
                }
            }
        });
    }

    pub fn record_policy_violation(&self) {
        self.policy_violations.inc();
    }

    pub fn record_response_time(&self, duration: f64) {
        self.response_time.observe(duration);
    }

    pub fn set_quarantined_count(&self, count: f64) {
        self.quarantined_sandboxes.set(count);
    }

    pub fn set_active_monitors(&self, count: f64) {
        self.active_monitors.set(count);
    }

    pub async fn get_dashboard_metrics(
        &self,
        _time_range: Option<String>,
        _granularity: Option<String>,
    ) -> Result<DashboardMetrics> {
        let events_by_type_counters = self.events_by_type.read().await;
        let events_by_severity_counters = self.events_by_severity.read().await;
        
        let mut events_by_type = HashMap::new();
        for (event_type, counter) in events_by_type_counters.iter() {
            events_by_type.insert(event_type.clone(), counter.get() as u64);
        }
        
        let mut events_by_severity = HashMap::new();
        for (severity, counter) in events_by_severity_counters.iter() {
            events_by_severity.insert(severity.clone(), counter.get() as u64);
        }

        Ok(DashboardMetrics {
            total_events: self.events_total.get() as u64,
            events_by_type,
            events_by_severity,
            quarantined_sandboxes: self.quarantined_sandboxes.get() as u64,
            policy_violations: self.policy_violations.get() as u64,
            compliance_score: self.calculate_compliance_score(),
            avg_response_time_ms: self.response_time.get_sample_sum() * 1000.0 / self.response_time.get_sample_count() as f64,
            active_monitors: self.active_monitors.get() as u64,
            realtime_metrics: RealtimeMetrics {
                events_per_second: self.events_total.get() / 60.0, // Rough estimate
                active_sandboxes: self.active_monitors.get() as u64,
                quarantined_sandboxes: self.quarantined_sandboxes.get() as u64,
                critical_events: events_by_severity.get("critical").cloned().unwrap_or(0),
            },
        })
    }

    pub async fn collect_system_metrics(&self) -> Result<()> {
        // Collect system-level metrics
        // This would include CPU, memory, disk usage, etc.
        // For now, just placeholder implementation
        Ok(())
    }

    pub fn export_prometheus(&self) -> String {
        let encoder = TextEncoder::new();
        let metric_families = self.registry.gather();
        encoder.encode_to_string(&metric_families).unwrap_or_default()
    }

    fn calculate_compliance_score(&self) -> f64 {
        let total_events = self.events_total.get();
        let violations = self.policy_violations.get();
        
        if total_events == 0.0 {
            return 100.0;
        }
        
        let violation_rate = violations / total_events;
        (100.0 - (violation_rate * 100.0)).max(0.0)
    }
}