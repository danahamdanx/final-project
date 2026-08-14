CREATE TABLE logs_rollup_1m (
    bucket_start TIMESTAMPTZ NOT NULL,
    service      TEXT NOT NULL,
    level        log_level NOT NULL,
    count        BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_start, service, level)
);

CREATE INDEX idx_rollup_bucket ON logs_rollup_1m (bucket_start DESC);
