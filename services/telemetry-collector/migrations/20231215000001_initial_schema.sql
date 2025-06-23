-- Create sandbox_runs table
CREATE TABLE IF NOT EXISTS sandbox_runs (
    id UUID PRIMARY KEY,
    sandbox_id VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    language VARCHAR(50) NOT NULL,
    exit_code INTEGER NOT NULL,
    duration_ms BIGINT NOT NULL,
    cost DOUBLE PRECISION NOT NULL,
    cpu_requested DOUBLE PRECISION,
    memory_requested INTEGER,
    has_gpu BOOLEAN NOT NULL DEFAULT FALSE,
    timeout_ms BIGINT,
    success BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for sandbox_runs
CREATE INDEX idx_sandbox_runs_provider ON sandbox_runs(provider);
CREATE INDEX idx_sandbox_runs_created_at ON sandbox_runs(created_at);
CREATE INDEX idx_sandbox_runs_provider_created ON sandbox_runs(provider, created_at);

-- Create training_data table
CREATE TABLE IF NOT EXISTS training_data (
    id UUID PRIMARY KEY,
    features JSONB NOT NULL,
    actual_cost DOUBLE PRECISION NOT NULL,
    actual_latency DOUBLE PRECISION NOT NULL,
    success BOOLEAN NOT NULL,
    provider VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for training_data
CREATE INDEX idx_training_data_created_at ON training_data(created_at);
CREATE INDEX idx_training_data_provider ON training_data(provider);

-- Create predictions table
CREATE TABLE IF NOT EXISTS predictions (
    id UUID PRIMARY KEY,
    provider VARCHAR(50) NOT NULL,
    predicted_cost DOUBLE PRECISION NOT NULL,
    predicted_latency DOUBLE PRECISION NOT NULL,
    confidence DOUBLE PRECISION NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    actual_cost DOUBLE PRECISION,
    actual_latency DOUBLE PRECISION,
    actual_success BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for predictions
CREATE INDEX idx_predictions_model_version ON predictions(model_version);
CREATE INDEX idx_predictions_created_at ON predictions(created_at);
CREATE INDEX idx_predictions_model_created ON predictions(model_version, created_at);