-- migrations/002_query_indexes.sql

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- استبدال index الـ timestamp القديم بواحد فيه tie-breaker
DROP INDEX IF EXISTS idx_logs_timestamp;

CREATE INDEX idx_logs_timestamp ON logs (timestamp DESC, id DESC);

-- GIN index لفلترة attr.<key>
CREATE INDEX idx_logs_attributes ON logs USING GIN (attributes jsonb_path_ops);

-- trigram index لدعم substring search على q=
CREATE INDEX idx_logs_message_trgm ON logs USING GIN (message gin_trgm_ops);