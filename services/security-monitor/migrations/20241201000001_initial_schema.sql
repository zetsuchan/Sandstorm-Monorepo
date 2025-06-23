-- Initial schema for security monitor service

-- Security events table
CREATE TABLE security_events (
    id VARCHAR(255) PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    sandbox_id VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    metadata JSONB,
    falco_rule VARCHAR(255),
    ebpf_trace VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Quarantine records table
CREATE TABLE quarantine_records (
    id VARCHAR(255) PRIMARY KEY,
    sandbox_id VARCHAR(255) NOT NULL,
    reason TEXT NOT NULL,
    triggered_by JSONB NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    auto_release BOOLEAN NOT NULL DEFAULT FALSE,
    release_conditions JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Security policies table
CREATE TABLE security_policies (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    tier VARCHAR(20) NOT NULL,
    rules JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Security rules table (denormalized for easier querying)
CREATE TABLE security_rules (
    id VARCHAR(255) PRIMARY KEY,
    policy_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    condition JSONB NOT NULL,
    action VARCHAR(50) NOT NULL,
    notifications JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (policy_id) REFERENCES security_policies(id) ON DELETE CASCADE
);

-- Alerts table
CREATE TABLE alerts (
    id VARCHAR(255) PRIMARY KEY,
    severity VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    sandbox_id VARCHAR(255),
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Compliance reports table
CREATE TABLE compliance_reports (
    id VARCHAR(255) PRIMARY KEY,
    standard VARCHAR(50) NOT NULL,
    sandbox_id VARCHAR(255),
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL,
    findings JSONB NOT NULL DEFAULT '[]',
    generated_at TIMESTAMPTZ NOT NULL,
    signature TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Provenance records table
CREATE TABLE provenance_records (
    id VARCHAR(255) PRIMARY KEY,
    sandbox_id VARCHAR(255) NOT NULL,
    result_hash VARCHAR(255) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    provider VARCHAR(50) NOT NULL,
    security_events JSONB NOT NULL DEFAULT '[]',
    signature TEXT NOT NULL,
    public_key TEXT NOT NULL,
    chain_anchor JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Metrics aggregation table
CREATE TABLE metrics_aggregations (
    id SERIAL PRIMARY KEY,
    metric_type VARCHAR(100) NOT NULL,
    time_bucket TIMESTAMPTZ NOT NULL,
    granularity VARCHAR(20) NOT NULL, -- minute, hour, day
    value DOUBLE PRECISION NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_security_events_sandbox_id ON security_events(sandbox_id);
CREATE INDEX idx_security_events_timestamp ON security_events(timestamp);
CREATE INDEX idx_security_events_type_severity ON security_events(event_type, severity);
CREATE INDEX idx_security_events_provider ON security_events(provider);

CREATE INDEX idx_quarantine_records_sandbox_id ON quarantine_records(sandbox_id);
CREATE INDEX idx_quarantine_records_start_time ON quarantine_records(start_time);
CREATE INDEX idx_quarantine_records_active ON quarantine_records(end_time) WHERE end_time IS NULL;

CREATE INDEX idx_security_policies_enabled ON security_policies(enabled);
CREATE INDEX idx_security_policies_tier ON security_policies(tier);

CREATE INDEX idx_security_rules_policy_id ON security_rules(policy_id);
CREATE INDEX idx_security_rules_action ON security_rules(action);

CREATE INDEX idx_alerts_timestamp ON alerts(timestamp);
CREATE INDEX idx_alerts_acknowledged ON alerts(acknowledged);
CREATE INDEX idx_alerts_sandbox_id ON alerts(sandbox_id);
CREATE INDEX idx_alerts_severity ON alerts(severity);

CREATE INDEX idx_compliance_reports_standard ON compliance_reports(standard);
CREATE INDEX idx_compliance_reports_generated_at ON compliance_reports(generated_at);
CREATE INDEX idx_compliance_reports_sandbox_id ON compliance_reports(sandbox_id);

CREATE INDEX idx_provenance_records_sandbox_id ON provenance_records(sandbox_id);
CREATE INDEX idx_provenance_records_timestamp ON provenance_records(timestamp);
CREATE INDEX idx_provenance_records_provider ON provenance_records(provider);

CREATE INDEX idx_metrics_aggregations_type_bucket ON metrics_aggregations(metric_type, time_bucket);
CREATE INDEX idx_metrics_aggregations_granularity ON metrics_aggregations(granularity);

-- Views for common queries
CREATE VIEW recent_security_events AS
SELECT *
FROM security_events
WHERE timestamp > NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC;

CREATE VIEW active_quarantines AS
SELECT *
FROM quarantine_records
WHERE end_time IS NULL
ORDER BY start_time DESC;

CREATE VIEW unacknowledged_alerts AS
SELECT *
FROM alerts
WHERE acknowledged = FALSE
ORDER BY timestamp DESC;

CREATE VIEW security_metrics_summary AS
SELECT
    COUNT(*) as total_events,
    COUNT(DISTINCT sandbox_id) as unique_sandboxes,
    COUNT(*) FILTER (WHERE severity = 'critical') as critical_events,
    COUNT(*) FILTER (WHERE severity = 'high') as high_events,
    COUNT(*) FILTER (WHERE severity = 'medium') as medium_events,
    COUNT(*) FILTER (WHERE severity = 'low') as low_events
FROM security_events
WHERE timestamp > NOW() - INTERVAL '24 hours';

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_security_policies_updated_at
    BEFORE UPDATE ON security_policies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();