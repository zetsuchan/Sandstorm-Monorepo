use anyhow::Result;
use dashmap::DashMap;
use std::sync::Arc;
use uuid::Uuid;

use crate::models::*;

pub struct QuarantineManager {
    quarantines: Arc<DashMap<String, QuarantineRecord>>,
}

impl QuarantineManager {
    pub fn new() -> Self {
        Self {
            quarantines: Arc::new(DashMap::new()),
        }
    }

    pub async fn quarantine(
        &self,
        sandbox_id: &str,
        reason: &str,
        triggering_event: &SecurityEvent,
    ) -> Result<QuarantineRecord> {
        let record = QuarantineRecord {
            id: Uuid::new_v4().to_string(),
            sandbox_id: sandbox_id.to_string(),
            reason: reason.to_string(),
            triggered_by: triggering_event.clone(),
            start_time: chrono::Utc::now(),
            end_time: None,
            auto_release: false,
            release_conditions: None,
        };

        self.quarantines.insert(record.id.clone(), record.clone());
        
        // In a real implementation, this would also:
        // 1. Stop the sandbox
        // 2. Isolate network access
        // 3. Preserve sandbox state for analysis
        // 4. Notify security team
        
        Ok(record)
    }

    pub async fn release(&self, quarantine_id: &str) -> Result<()> {
        if let Some(mut record) = self.quarantines.get_mut(quarantine_id) {
            record.end_time = Some(chrono::Utc::now());
            
            // In a real implementation, this would also:
            // 1. Restore sandbox access
            // 2. Re-enable network
            // 3. Apply any remediation actions
            // 4. Log the release
        }
        
        Ok(())
    }

    pub async fn is_quarantined(&self, sandbox_id: &str) -> bool {
        self.quarantines
            .iter()
            .any(|entry| entry.sandbox_id == sandbox_id && entry.end_time.is_none())
    }

    pub async fn list_active(&self) -> Result<Vec<QuarantineRecord>> {
        Ok(self
            .quarantines
            .iter()
            .filter(|entry| entry.end_time.is_none())
            .map(|entry| entry.clone())
            .collect())
    }

    pub async fn get_record(&self, quarantine_id: &str) -> Option<QuarantineRecord> {
        self.quarantines.get(quarantine_id).map(|r| r.clone())
    }

    pub async fn cleanup_old_records(&self, retention_hours: i64) -> Result<usize> {
        let cutoff = chrono::Utc::now() - chrono::Duration::hours(retention_hours);
        let mut removed = 0;
        
        let to_remove: Vec<_> = self
            .quarantines
            .iter()
            .filter(|entry| {
                if let Some(end_time) = entry.end_time {
                    end_time < cutoff
                } else {
                    false
                }
            })
            .map(|entry| entry.id.clone())
            .collect();

        for id in to_remove {
            self.quarantines.remove(&id);
            removed += 1;
        }

        Ok(removed)
    }
}