import { readPool, writePool } from "../db/client.js";
import { LogInput } from "../schemas/log.schema.js";
import { ingestionBuffer } from "../services/ingestion-buffer.service.js";
import { ParsedAggregateQuery } from "../utils/aggregate-params.js";
import { ParsedLogsQuery } from "../utils/query-params.js";


export interface LogRow {
  id: string;
  timestamp: Date;
  level: string;
  service: string;
  message: string;
  attributes: Record<string, unknown>;
}

export interface BuiltQuery {
  sql: string;
  values: unknown[];
}

export interface AggregateRow {
  bucket_start: Date;
  group_value: string | null;
  count: string;
}

export function buildLogQuery(params: ParsedLogsQuery): BuiltQuery {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.service) {
    values.push(params.service);
    conditions.push(`service = $${values.length}`);
  }

  if (params.level) {
    values.push(params.level);
    conditions.push(`level = $${values.length}`);
  }

  if (params.since) {
    values.push(params.since);
    conditions.push(`timestamp >= $${values.length}`);
  }

  if (params.until) {
    values.push(params.until);
    conditions.push(`timestamp < $${values.length}`);
  }

  if (params.q) {
    values.push(`%${params.q}%`);
    conditions.push(`message ILIKE $${values.length}`);
  }

  for (const [key, value] of Object.entries(params.attributes)) {
    values.push(key);
    values.push(value);
    conditions.push(
      `attributes ->> $${values.length - 1} = $${values.length}`
    );
  }

  if (params.parsedCursor) {
    values.push(params.parsedCursor.timestamp);
    values.push(params.parsedCursor.id);

    conditions.push(
      `(timestamp, id) < ($${values.length - 1}, $${values.length}::bigint)`
    );
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  values.push(params.limit + 1);

  const sql = `
    SELECT id, timestamp, level, service, message, attributes
    FROM logs
    ${whereClause}
    ORDER BY timestamp DESC, id DESC
    LIMIT $${values.length}
  `;

  return { sql, values };
}

function bucketExpression(bucket: string): string {
  switch (bucket) {
    case "1m":
      return `date_trunc('minute', timestamp)`;

    case "1h":
      return `date_trunc('hour', timestamp)`;

    case "1d":
      return `date_trunc('day', timestamp)`;

    case "5m":
      return `to_timestamp(
        floor(extract(epoch from timestamp) / 300) * 300
      )`;

    default:
      throw new Error(`unsupported bucket size: ${bucket}`);
  }
}

export function buildAggregateQuery(
  params: ParsedAggregateQuery
): BuiltQuery {
  const conditions: string[] = [];
  const values: unknown[] = [];

  values.push(params.since);
  conditions.push(`timestamp >= $${values.length}`);

  values.push(params.until);
  conditions.push(`timestamp < $${values.length}`);

  if (params.service) {
    values.push(params.service);
    conditions.push(`service = $${values.length}`);
  }

  if (params.level) {
    values.push(params.level);
    conditions.push(`level = $${values.length}`);
  }

  if (params.q) {
    values.push(`%${params.q}%`);
    conditions.push(`message ILIKE $${values.length}`);
  }

  for (const [key, value] of Object.entries(params.attributes)) {
    values.push(key);
    values.push(value);

    conditions.push(
      `attributes ->> $${values.length - 1} = $${values.length}`
    );
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  const bucketExpr = bucketExpression(params.bucket);

  const selectGroupColumn = params.group_by
    ? params.group_by
    : "NULL";

  const groupByExpr = params.group_by
    ? `${bucketExpr}, ${params.group_by}`
    : bucketExpr;

  const sql = `
    SELECT
      ${bucketExpr} AS bucket_start,
      ${selectGroupColumn} AS group_value,
      COUNT(*) AS count
    FROM logs
    ${whereClause}
    GROUP BY ${groupByExpr}
    ORDER BY bucket_start ASC
  `;

  return { sql, values };
}
export function canUseRollup(params: ParsedAggregateQuery): boolean {
  return (
    params.bucket === "1m" &&
    !params.q &&
    Object.keys(params.attributes).length === 0
  );
}

function buildRollupQuery(params: ParsedAggregateQuery): BuiltQuery {
  const conditions: string[] = [];
  const values: unknown[] = [];

  values.push(params.since);
  conditions.push(`bucket_start >= $${values.length}`);

  values.push(params.until);
  conditions.push(`bucket_start < $${values.length}`);

  if (params.service) {
    values.push(params.service);
    conditions.push(`service = $${values.length}`);
  }

  if (params.level) {
    values.push(params.level);
    conditions.push(`level = $${values.length}`);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const selectGroupColumn = params.group_by
    ? params.group_by
    : "NULL";

  const groupByExpr = params.group_by
    ? `bucket_start, ${params.group_by}`
    : "bucket_start";

  const sql = `
    SELECT
      bucket_start,
      ${selectGroupColumn} AS group_value,
      SUM(count) AS count
    FROM logs_rollup_1m
    ${whereClause}
    GROUP BY ${groupByExpr}
    ORDER BY bucket_start ASC
  `;

  return { sql, values };
}
export class LogRepository {
// رجعي log.repository.ts لنسخته يلي كانت قبل worker thread
async insertMany(logs: LogInput[]): Promise<void> {
  if (logs.length === 0) return;

  const timestamps: string[] = [];
  const levels: string[] = [];
  const services: string[] = [];
  const messages: string[] = [];
  const attributesArr: string[] = [];

  for (const log of logs) {
    timestamps.push(log.timestamp);
    levels.push(log.level);
    services.push(log.service);
    messages.push(log.message);
    attributesArr.push(JSON.stringify(log.attributes));
  }

  

  await writePool.query(
    `
    INSERT INTO logs (timestamp, level, service, message, attributes)
    SELECT * FROM UNNEST(
      $1::timestamptz[], $2::log_level[], $3::text[], $4::text[], $5::jsonb[]
    )
    `,
    [timestamps, levels, services, messages, attributesArr]
  );
}
async upsertRollup(logs: LogInput[]): Promise<void> {
  if (logs.length === 0) return;

  interface RollupEntry {
    bucket: string;
    service: string;
    level: string;
    count: number;
  }

  const counts = new Map<string, RollupEntry>();

  for (const log of logs) {
    const bucket = log.timestamp.slice(0, 16) + ":00.000Z";
    const key = `${bucket}|${log.service}|${log.level}`;

    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { bucket, service: log.service, level: log.level, count: 1 });
    }
  }

  const buckets: string[] = [];
  const services: string[] = [];
  const levels: string[] = [];
  const amounts: number[] = [];

  for (const entry of counts.values()) {
    buckets.push(entry.bucket);
    services.push(entry.service);
    levels.push(entry.level);
    amounts.push(entry.count);
  }

  await writePool.query(
    `
    INSERT INTO logs_rollup_1m (bucket_start, service, level, count)
    SELECT * FROM UNNEST($1::timestamptz[], $2::text[], $3::log_level[], $4::bigint[])
    ON CONFLICT (bucket_start, service, level)
    DO UPDATE SET count = logs_rollup_1m.count + EXCLUDED.count
    `,
    [buckets, services, levels, amounts]
  );
}

  async ingest(logs: LogInput[]): Promise<{ accepted: boolean }> {
  return ingestionBuffer.add(logs);
}
  async findMany(params: ParsedLogsQuery): Promise<LogRow[]> {
    const { sql, values } = buildLogQuery(params);

    const result = await readPool.query(sql, values);

    return result.rows;
  }

  async aggregate(
  params: ParsedAggregateQuery
): Promise<AggregateRow[]> {
  const { sql, values } = canUseRollup(params)
    ? buildRollupQuery(params)
    : buildAggregateQuery(params);

  const result = await readPool.query<AggregateRow>(sql, values);

  return result.rows;
}
}

export const logRepository = new LogRepository();