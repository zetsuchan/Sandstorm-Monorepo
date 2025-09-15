ALTER TABLE sandbox_runs
    ADD COLUMN IF NOT EXISTS cpu_percent DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS memory_mb DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS network_rx_bytes BIGINT,
    ADD COLUMN IF NOT EXISTS network_tx_bytes BIGINT,
    ADD COLUMN IF NOT EXISTS agent_id VARCHAR(255);

CREATE TABLE IF NOT EXISTS edge_agent_status (
    agent_id VARCHAR(255) PRIMARY KEY,
    agent_name VARCHAR(255),
    status VARCHAR(32) NOT NULL,
    version VARCHAR(64) NOT NULL,
    queue_depth INTEGER NOT NULL DEFAULT 0,
    running INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    cpu_percent DOUBLE PRECISION,
    memory_percent DOUBLE PRECISION,
    last_heartbeat TIMESTAMPTZ NOT NULL,
    public_endpoint VARCHAR(255),
    payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS edge_agent_metrics (
    id UUID PRIMARY KEY,
    agent_id VARCHAR(255) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edge_agent_metrics_agent_time
    ON edge_agent_metrics(agent_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS edge_agent_runs (
    id UUID PRIMARY KEY,
    agent_id VARCHAR(255) NOT NULL,
    sandbox_id VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    language VARCHAR(50) NOT NULL,
    duration_ms BIGINT NOT NULL,
    exit_code INTEGER NOT NULL,
    cpu_percent DOUBLE PRECISION,
    memory_mb DOUBLE PRECISION,
    network_rx_bytes BIGINT,
    network_tx_bytes BIGINT,
    finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_edge_agent_runs_agent_time
    ON edge_agent_runs(agent_id, finished_at DESC);

CREATE INDEX IF NOT EXISTS idx_edge_agent_runs_finished_at
    ON edge_agent_runs(finished_at DESC);
