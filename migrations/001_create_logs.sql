-- ==========================================
-- Create log level enum
-- ==========================================
CREATE TYPE log_level AS ENUM (
    'debug',
    'info',
    'warn',
    'error'
);

-- ==========================================
-- Create logs table
-- ==========================================

CREATE TABLE logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    level log_level NOT NULL,
    service TEXT NOT NULL,
    message TEXT NOT NULL,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ==========================================
-- Indexes
-- ==========================================

CREATE INDEX idx_logs_timestamp ON logs (timestamp DESC);

CREATE INDEX idx_logs_service ON logs (service);

CREATE INDEX idx_logs_level ON logs (level);

CREATE INDEX idx_logs_service_timestamp ON logs (service, timestamp DESC);