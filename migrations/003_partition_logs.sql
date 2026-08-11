-- ==========================================
-- Convert logs table to be RANGE partitioned by timestamp
-- Required for efficient retention (DROP PARTITION instead of DELETE)
-- ==========================================

DROP TABLE IF EXISTS logs;

CREATE TABLE logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY,
    timestamp TIMESTAMPTZ NOT NULL,
    level log_level NOT NULL,
    service TEXT NOT NULL,
    message TEXT NOT NULL,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- ==========================================
-- Indexes (تنطبق تلقائيًا على أي partition جديد يتضاف لاحقًا)
-- ==========================================

CREATE INDEX idx_logs_timestamp ON logs (timestamp DESC, id DESC);

CREATE INDEX idx_logs_service_ts ON logs (service, timestamp DESC);

CREATE INDEX idx_logs_level_ts ON logs (level, timestamp DESC);

CREATE INDEX idx_logs_attributes ON logs USING GIN (attributes jsonb_path_ops);

CREATE INDEX idx_logs_message_trgm ON logs USING GIN (message gin_trgm_ops);

-- ==========================================
-- Default partition — شبكة أمان لأي بيانات ما إلها partition محدد بعد
-- ==========================================

CREATE TABLE logs_default PARTITION OF logs DEFAULT;