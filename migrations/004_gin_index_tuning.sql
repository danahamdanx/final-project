-- migrations/004_gin_index_tuning.sql

DROP INDEX IF EXISTS idx_logs_attributes;

DROP INDEX IF EXISTS idx_logs_message_trgm;

CREATE INDEX idx_logs_attributes ON logs USING GIN (attributes jsonb_path_ops)
WITH (
        fastupdate = on,
        gin_pending_list_limit = 8192
    );

CREATE INDEX idx_logs_message_trgm ON logs USING GIN (message gin_trgm_ops)
WITH (
        fastupdate = on,
        gin_pending_list_limit = 8192
    );