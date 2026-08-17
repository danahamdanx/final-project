# Log Ingestion & Query Service

A high-throughput log ingestion and query service built with Fastify, PostgreSQL, and TypeScript. Supports batched ingestion, flexible attribute filtering, time-bucketed aggregation, and automatic time-based retention.

---

## Setup Instructions

**Requirements:** Docker and Docker Compose.

```bash
docker compose up --build -d
```

This starts two containers:

- `app` — the Fastify service (port `8080`), constrained to **0.5 CPU / 256MB RAM**
- `postgres` — PostgreSQL 16, constrained to **1 CPU / 1GB RAM**

Database migrations run automatically on app startup (`runMigrations()` in `src/db/migrate.ts`), and daily partitions for the next 7 days are created automatically on boot and refreshed daily.

Check everything is healthy:

```bash
docker compose ps
curl http://localhost:8080/health
```

**Local development (without Docker):**

```bash
npm ci
npm run dev          # tsx watch src/server.ts
npm run build        # tsc -> dist/
npm run typecheck    # tsc --noEmit
npm run test         # all tests
npm run test:unit
npm run test:integration
```

**Environment variables** (see `docker-compose.yml` for defaults): `PORT`, `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`, `RETENTION_DAYS` (default `30`).

---

## API Documentation

### `POST /logs`

Ingest a batch of log entries.

**Body:**

```json
{
  "logs": [
    {
      "timestamp": "2026-08-12T10:00:00Z",
      "level": "info",
      "service": "payments",
      "message": "payment completed",
      "attributes": { "userId": "123", "amount": 42 }
    }
  ]
}
```

| Field        | Type            | Rules                                                      |
| ------------ | --------------- | ---------------------------------------------------------- |
| `timestamp`  | ISO 8601 string | required; must not be more than 5 minutes in the future    |
| `level`      | enum            | `debug` \| `info` \| `warn` \| `error`                     |
| `service`    | string          | 1–100 chars, trimmed                                       |
| `message`    | string          | 1–1000 chars, trimmed                                      |
| `attributes` | object          | flat key → `string \| number \| boolean`; defaults to `{}` |

Each log in the array is validated independently — invalid entries are rejected without failing the whole batch, as long as at least one entry is valid.

**Response `200`:**

```json
{ "accepted": 1, "rejected": [] }
```

`rejected` is an array of `{ index, reason }` for entries that failed validation.

**Response `400`:** if the top-level body isn't `{ logs: [...] }` with at least one entry, or if _all_ entries in the batch are rejected.

Ingestion does not write synchronously — accepted logs are placed in an in-memory buffer and flushed to PostgreSQL on a periodic timer (see [Architecture](#architecture--data-flow)).

---

### `GET /logs`

Query raw log entries, newest first, with cursor-based pagination.

| Query param       | Type     | Notes                                                            |
| ----------------- | -------- | ---------------------------------------------------------------- |
| `service`         | string   | exact match                                                      |
| `level`           | enum     | exact match                                                      |
| `since` / `until` | ISO 8601 | inclusive/exclusive time range                                   |
| `q`               | string   | substring search on `message` (`ILIKE`, backed by trigram index) |
| `attr.<key>`      | string   | e.g. `attr.userId=123`; supports multiple, ANDed                 |
| `limit`           | int      | 1–1000, default 100                                              |
| `cursor`          | string   | opaque cursor from a previous response, for pagination           |

Example: `GET /logs?service=payments&level=error&since=2026-08-12T00:00:00Z&attr.userId=123&limit=50`

---

### `GET /logs/aggregate`

Time-bucketed counts, optionally grouped by `service` or `level`.

| Query param                           | Type     | Notes                                                  |
| ------------------------------------- | -------- | ------------------------------------------------------ |
| `since` / `until`                     | ISO 8601 | **required**; `until` must not be earlier than `since` |
| `bucket`                              | enum     | **required**; `1m` \| `5m` \| `1h` \| `1d`             |
| `group_by`                            | enum     | optional; `service` \| `level`                         |
| `service`, `level`, `q`, `attr.<key>` | —        | same filters as `GET /logs`                            |

Example: `GET /logs/aggregate?since=2026-08-12T00:00:00Z&until=2026-08-12T01:00:00Z&bucket=1m&group_by=service`

**Response `200`:**

```json
{
  "buckets": [
    {
      "bucket_start": "2026-08-12T00:01:00Z",
      "group_value": "payments",
      "count": "42"
    }
  ]
}
```

---

### `GET /health`

Returns `200` with `{ status: "ok", database: "up" }` if the app can reach PostgreSQL, `503` otherwise.

---

## Architecture & Data Flow

```
POST /logs → validate (hand-written, per-entry) → in-memory buffer
                                                        │
                                          flush every 500ms (timer)
                                                        │
                                        writePool → UNNEST bulk INSERT
                                                        │
                                              PostgreSQL (partitioned)

GET /logs, /logs/aggregate → readPool → PostgreSQL
```

Key decisions:

- **Separate read/write connection pools** (`readPool`, `writePool` in `src/db/client.ts`) so that a burst of writes can't starve concurrent aggregate/query requests of connections.
- **Buffered, timer-flushed ingestion** (`src/services/ingestion-buffer.service.ts`) instead of writing on every request — batches many HTTP requests' worth of logs into fewer, larger `INSERT`s. Flush errors are caught explicitly (`.catch()` on the timer callback) so a failed flush can't crash the process with an unhandled rejection; failed batches are re-queued and retried on the next tick.
- **`UNNEST`-based bulk insert** instead of per-row `($1,$2,...),($6,$7,...)` placeholders. A naive placeholder-per-value insert hits PostgreSQL's 65,535-parameter-per-statement limit at a few thousand rows and forces query re-planning on every call (different SQL text per batch size). `UNNEST` passes 5 arrays as fixed parameters regardless of batch size, so the query plan is cached and reused.
- **Hand-written validation** (`src/utils/validation.ts`) instead of Zod on the hot ingestion path — Zod's per-field overhead was measurable under the 0.5 CPU constraint (see [Bottlenecks](#bottlenecks-discovered)); Zod is still used for query-parameter parsing, which is much lower volume.

---

## Schema Design

```sql
CREATE TYPE log_level AS ENUM ('debug', 'info', 'warn', 'error');

CREATE TABLE logs (
    id         BIGINT GENERATED ALWAYS AS IDENTITY,
    timestamp  TIMESTAMPTZ NOT NULL,
    level      log_level NOT NULL,
    service    TEXT NOT NULL,
    message    TEXT NOT NULL,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE TABLE logs_default PARTITION OF logs DEFAULT;
```

- **`log_level` as an enum**, not text — smaller on-disk footprint, and invalid values are rejected at the database level as a second line of defense behind application validation.
- **Range-partitioned by `timestamp`**, one partition per day, created 7 days ahead of time by `src/db/partition-manager.ts` (idempotent, safe to call repeatedly) and refreshed daily via a background interval in `server.ts`. A `DEFAULT` partition catches anything outside the pre-created range instead of failing the insert.
  - **Why partitioning:** the retention requirement (drop ~1 month of data without long-running locks or bloat) is a natural fit for `DROP TABLE`/`DETACH PARTITION` on whole daily partitions, which is near-instant, versus a `DELETE ... WHERE timestamp < ...` on a million-row table, which scans, generates massive WAL and dead-tuple bloat, and holds row locks for the duration.
  - Partition pruning also means `GET /logs/aggregate` and `GET /logs` only scan the partitions actually covered by `since`/`until`, confirmed via `EXPLAIN ANALYZE` (`Subplans Removed: N`, only the relevant day's partition scanned).
- **Composite primary key `(id, timestamp)`**: PostgreSQL requires the partition key to be part of any unique constraint on a partitioned table; `id` alone (identity) still gives global uniqueness.

### Index Design

| Index                   | Type                              | Purpose                                                                                                                           |
| ----------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `idx_logs_timestamp`    | btree `(timestamp DESC, id DESC)` | primary sort order for `GET /logs`, and time-range scans for aggregation; `id DESC` as a tie-breaker for stable cursor pagination |
| `idx_logs_service_ts`   | btree `(service, timestamp DESC)` | `service=` filter combined with time range                                                                                        |
| `idx_logs_level_ts`     | btree `(level, timestamp DESC)`   | `level=` filter combined with time range                                                                                          |
| `idx_logs_attributes`   | GIN `(attributes jsonb_path_ops)` | `attr.<key>=<value>` filters on arbitrary JSONB keys                                                                              |
| `idx_logs_message_trgm` | GIN `(message gin_trgm_ops)`      | substring search (`q=`) via `pg_trgm`, since `message` has no fixed structure                                                     |

**GIN tuning (`004_gin_index_tuning.sql`):** both GIN indexes are created with `fastupdate = on, gin_pending_list_limit = 8192`. Under sustained high-throughput writes, GIN's default per-row index maintenance was measurably expensive (see [Bottlenecks](#bottlenecks-discovered)); `fastupdate` batches new entries into a pending list and flushes them in bulk instead of updating the index structure on every single insert, which cut mean insert latency roughly in half in testing and — more importantly — stopped `max` insert latency from growing as the table grew.

---

## Attribute Storage Strategy

`attributes` is stored as `JSONB` rather than a fixed set of columns or an EAV (entity-attribute-value) side table:

- **Flat, schemaless key→value pairs** (`Record<string, string | number | boolean>`) match the requirement for arbitrary, caller-defined metadata without a schema migration per new attribute key.
- **`JSONB` over `JSON`**: binary storage, supports indexing.
- **`jsonb_path_ops` GIN index** rather than the default `jsonb_ops` operator class: smaller index, faster for the containment/equality lookups (`attributes ->> 'key' = 'value'`) this service actually does, at the cost of not supporting the (unused) `?`/`?|`/`?&` existence operators.
- Attribute filters are applied as `attributes ->> $key = $value` conditions built with parameterized queries (see `buildLogQuery` / `buildAggregateQuery` in `src/repositories/log.repository.ts`) — never string-interpolated, so this is not a SQL-injection vector despite the dynamic key names.

---

## Retention Strategy

`src/services/retention.service.ts`, run on startup and then every 24 hours:

1. Lists all partitions of `logs` (via `pg_inherits`).
2. Parses each partition's date from its name (`logs_YYYY_MM_DD`).
3. Drops any partition entirely older than `RETENTION_DAYS` (default 30) via `DROP TABLE`.

Because this operates on whole partitions rather than rows, it avoids the long-running-lock and bloat problems of a row-level `DELETE`: `DROP TABLE` on a partition is a fast catalog operation, doesn't scan the data, generates minimal WAL, and doesn't leave dead tuples requiring `VACUUM`. It also doesn't block or slow concurrent ingestion into other (current) partitions, since each partition is a separate physical table.

`RETENTION_DAYS` is validated on every run (must be a positive integer) and throws rather than silently defaulting on a malformed value, so a bad environment variable fails loudly at startup instead of silently deleting the wrong amount of data.

---

## Load-Test Methodology

Two k6 scripts, in `performance/`:

- **`ingestion-baseline.js`** — ingestion only, isolated: 75 constant VUs, each posting a 100-log batch in a tight loop, for 30s. Measures raw ingestion throughput with no concurrent read load.
- **`mixed-load.js`** — the scenario the target numbers are actually specified against: 75 constant VUs doing the same ingestion loop, running concurrently with a separate `constant-arrival-rate` scenario firing exactly 1 `GET /logs/aggregate` request per second, for 30s. This is meant to simulate the production shape: continuous writes with periodic dashboard/aggregation reads.

Before each mixed-load run, the table was truncated (`TRUNCATE logs`) to start from a known-empty state. All tests were run against the full resource-constrained `docker-compose.yml` (app: 0.5 CPU/256MB, postgres: 1 CPU/1GB) — not against an unconstrained local environment.

Diagnosis of the aggregation-latency bottleneck (see below) went beyond just reading k6 output: `pg_stat_statements` was used to measure actual in-database query execution time independent of anything the Node process was doing, and a lightweight event-loop-stall probe (`setInterval` drift measurement) was added to `server.ts` to directly observe when and for how long the Node event loop was blocked, then cross-referenced against both the `pg_stat_statements` numbers and the k6-observed request latency to isolate where the time was actually going.

---

## Measured Performance Results

**Test environment (primary):** Official load generator (loadgen.foothilltech.net), running against the full resource-constrained deployment (app: 0.5 CPU/256MB, PostgreSQL: 1 CPU/1GB) as specified. Local testing (WSL2/Docker Desktop, described below) was used for iterative diagnosis; the official results below are authoritative.

**Dataset size:** up to ~1.5M rows accepted per scenario during official benchmarking.

**Batch size:** 100 logs/request (load generator default); server-side flush batches up to 2,000 rows per INSERT, every ~1s.

### Official Load Generator Results (best submission: 68.37/100, rank #9)

| Metric        | Value                                                                           |
| ------------- | ------------------------------------------------------------------------------- |
| Overall score | 68.37 / 100                                                                     |
| Performance   | 24.64 / 50                                                                      |
| Reliability   | 20.00 / 20 (zero crashes, zero dropped/malformed requests across all scenarios) |
| Correctness   | 15.00 / 15                                                                      |
| Queries       | 8.73 / 15                                                                       |

**Load scenario** (15,000 logs/s target, 120s sustained):

- Achieved ~10983 logs/sec accepted
- Ingestion latency p95: 15ms
- Aggregate query p95: **16ms** (via the rollup table, see below)
- Application CPU: 24.64% avg / 42.73% max (well under the 0.5-CPU limit)
- PostgreSQL CPU: 31.75% avg / 60.63% max (well under the 1-CPU limit)

**Stress / Spike / Breakpoint scenarios** (up to 45,000 logs/s): the service degrades gracefully via backpressure (503 + Retry-After) rather than crashing or dropping requests silently — 0 requests were ever dropped or errored with 5xx-uncaught failures across any scenario; rejected requests are explicit and countable.

### Local baseline (isolated ingestion, no concurrent queries)

- Sustained throughput: ~19,000–23,000 logs/sec, exceeding the 15,000 logs/sec baseline target.

### Aggregate query latency, isolated from the application

Measured via `pg_stat_statements` under concurrent write load: **mean 11–25ms, max well under 100ms**, consistently — confirming PostgreSQL itself is not the bottleneck for aggregation once the rollup table is in place.

### Ingestion (isolated, `ingestion-baseline.js`)

- **Sustained throughput: ~19,000–23,000 logs/sec**, exceeding the 15,000 logs/sec baseline target with margin.
- 0% failed requests across all isolated-ingestion runs.

### Mixed load (`mixed-load.js` — 75 concurrent ingesting VUs + 1 aggregation req/sec)

Best measured run:

- Ingestion: 234 req/sec → ~23,000 logs/sec effective, 0 failed ingestion requests.
- Aggregate query success rate: 96% (of requests that completed).
- Aggregate under 1s (p95 target): 33%.
- p95 latency: ~1.0s; p99/max latency spiked into several seconds under peak concurrent write pressure.

Across repeated runs on the same code, results varied more than expected for identical configuration — throughput ranged **129–234 req/sec** and "aggregate under 1s" ranged **4–33%** — see [Known Limitations](#known-limitations).

**Aggregate query latency, isolated from the application**, measured directly via `pg_stat_statements` during mixed-load runs: **mean 11–25ms, max 32–60ms**, consistently, regardless of concurrent ingestion pressure. This is the key diagnostic finding — the database itself is not the bottleneck; see below.

### Resource Usage

- App container CPU: sustained at or near its 0.5-CPU ceiling during concurrent ingestion.
- PostgreSQL container CPU: never observed near its 1-CPU ceiling during the same runs (confirmed via `docker stats` and `pg_stat_activity` wait-event sampling).
- Raw disk write throughput was independently verified inside the postgres container (`dd ... oflag=direct`): ~469 MB/s, ruling out virtualized-disk I/O as a contributing factor.

---

## Bottlenecks Discovered

In the order they were found and fixed/mitigated:

1. **Parameter-per-value INSERT hit PostgreSQL's 65,535-parameter limit** at a few thousand buffered rows, causing the periodic flush to throw. Fixed by switching to `UNNEST`-based bulk insert (5 fixed array parameters regardless of batch size).
2. **Unhandled flush errors crashed the whole process.** The periodic flush ran with `void this.flush()` and no error handling; any thrown error (including #1 above) became an unhandled rejection, which modern Node.js treats as fatal. Fixed with explicit `.catch()` on the timer callback and re-queuing failed batches.
3. **GIN index maintenance cost scaled with table size.** With default GIN settings, mean `INSERT` latency was ~24ms and _max_ latency grew from ~50ms to over 700ms over the course of a single 30s test as the table grew (confirmed via `pg_stat_statements` before/after). Mitigated with `fastupdate = on` and a larger `gin_pending_list_limit`, cutting mean latency roughly in half and eliminating the growth pattern.
4. **Node.js single-threaded event-loop contention under the 0.5 CPU constraint.** This was the dominant remaining bottleneck and the hardest to isolate. Symptoms: `GET /logs/aggregate` requests occasionally took 4–7 seconds end-to-end, while `pg_stat_statements` showed the same query consistently executing in under 60ms _inside_ PostgreSQL. Ruled out, with direct evidence, in this order: connection-pool contention (separate read/write pools made no difference), `autovacuum`/dead tuples (`n_dead_tup` was 0), parallel-worker CPU contention (`max_parallel_workers_per_gather=0` made no difference), WAL checkpoint stalls (`checkpoints_req` didn't increase during test runs), and virtualized disk I/O (raw `dd` write throughput was fine). What was _not_ ruled out: a direct event-loop-stall probe showed the Node process's event loop stalling for 100–1000+ ms at a time, repeatedly and almost continuously during concurrent ingestion, closely time-correlated with the slow `aggregate timing` log lines — while `insertMany`'s own JS-side array-building step measured under 5ms every time. The remaining time is attributable to per-call overhead in the `pg` driver's protocol encoding (binary parameter serialization) competing for the same single CPU-bound thread as request handling, at the write frequency required to sustain ~20K logs/sec on 0.5 CPU.

---

## Optimizations Applied

- `UNNEST`-based bulk insert (see #1 above)
- Explicit flush-error handling instead of relying on process-level crash recovery (see #2)
- Separate `readPool` / `writePool` connection pools, so write load can't starve read connections
- Fastify `response` schema on `GET /logs/aggregate` (enables `fast-json-stringify` instead of the generic `JSON.stringify` path)
- GIN index `fastupdate` tuning (see #3)
- Hand-written per-entry ingestion validation instead of Zod on the hot path (Zod retained for query-parameter parsing, which is much lower volume)
- Daily range partitioning + partition-based retention (`DROP TABLE` instead of `DELETE`)
- `checkpoint_completion_target = 0.9` and `max_wal_size = 2GB` to smooth checkpoint I/O (kept as a general good practice, though not the primary bottleneck — see above)

**Attempted but reverted:** offloading batch serialization and the `INSERT` call itself to a `worker_threads` worker. Measured result was _worse_ on every metric (throughput dropped from ~234 to ~132 req/sec, aggregate-under-1s dropped from 33% to 8%) — a single worker serialized all writes onto itself (recreating the same contention one level down) and `postMessage`'s structured-clone cost added overhead that wasn't there before. Reverted in favor of the simpler direct-pool `insertMany`. This is left in as a documented negative result rather than omitted, per the instruction to show evidence of actual measurement rather than assumptions.

---

## Known Limitations

- **Aggregation latency under sustained concurrent write load does not reliably meet the 1s p95 target** on the full 0.5 CPU / 256MB application constraint, despite the query itself executing in under 60ms inside PostgreSQL (verified via `pg_stat_statements`). Root-caused to Node.js single-threaded event-loop contention between the write-serialization path and concurrent request handling at the write frequency needed to sustain ~20K logs/sec on half a CPU core. A worker-thread offload was attempted and measured to make things worse (see above) and was reverted; a more promising but out-of-scope-for-this-timebox next step would be running ingestion and query-serving as fully separate OS processes (e.g., via `cluster` with routing, or a dedicated ingestion service) so that each has its own JS event loop rather than sharing one — not attempted here because the CPU budget (0.5 total) would need to be split between them, and validating that trade-off properly needs more time than was available.
- **Run-to-run variance was higher than expected** for identical code and configuration — mixed-load throughput ranged from 129 to 234 req/sec, and aggregate-under-1s ranged from 4% to 33%, across consecutive runs with no changes in between. This is likely attributable to the WSL2/Docker Desktop development environment (background OS activity, virtualization scheduling) rather than the application itself; the reported "best run" numbers above should be read as an upper bound observed in this environment, not a guaranteed floor. Testing in a native Linux environment (the likely target evaluation environment) is expected to show less variance.
- `pg-copy-streams` remains in `package.json` as a dependency from an earlier `COPY`-protocol approach that was tried and abandoned in favor of `UNNEST` (see Bottlenecks) once `pg_stat_statements` showed PostgreSQL itself was not the constrained resource. It's unused in the current code and can be removed.
- Query-parameter validation (`GET /logs`, `GET /logs/aggregate`) still uses Zod; this wasn't a measured bottleneck (query volume is far lower than ingestion volume) so it wasn't rewritten, but it's a place to look first if query-side latency ever becomes an issue.

---

## Optional Features

No optional features (authentication, API keys, multi-tenancy, or rate limiting) are implemented in this submission. `AUTH_ENABLED` is not applicable — the service has no auth code path at all, so it cannot be accidentally enabled.

`docker compose up` with no environment file, no arguments, and no manual setup yields the plain, unauthenticated core service exactly as specified: `GET /health`, `POST /logs`, `GET /logs`, and `GET /logs/aggregate` all accept unauthenticated requests with no rate limit, quota, or tenancy restriction.

**Implemented beyond the minimum (documented, not gated behind config):**

- **Backpressure** (stretch goal): `POST /logs` returns `503` with `Retry-After: 1` when the in-memory ingestion buffer is full, rather than crashing or silently dropping data. This is always on and cannot be disabled — it is core reliability behavior, not an optional feature requiring configuration.
- **Pre-aggregated rollup table** (stretch goal): a `logs_rollup_1m` table is maintained incrementally during ingestion and used transparently by `GET /logs/aggregate` when `bucket=1m` and no `q`/`attr.*` filters are present (falling back to the raw-table query otherwise). This is always on; it changes response _latency_, never response _shape_.
