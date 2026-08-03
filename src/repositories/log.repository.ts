import pool from "../db/client.js";
import { LogInput } from "../schemas/log.schema.js";
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
  count: string; // Postgres COUNT(*) بترجع bigint كـ string
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
    conditions.push(`attributes ->> $${values.length - 1} = $${values.length}`);
  }

  if (params.parsedCursor) {
    values.push(params.parsedCursor.timestamp);
    values.push(params.parsedCursor.id);
    conditions.push(
      `(timestamp, id) < ($${values.length - 1}, $${values.length}::bigint)`
    );
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  values.push(params.limit + 1); // نجيب واحد زيادة لنعرف فيه صفحة تالية أو لأ

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
      return `to_timestamp(floor(extract(epoch from timestamp) / 300) * 300)`;
    default:
      throw new Error(`unsupported bucket size: ${bucket}`);
  }
}

export function buildAggregateQuery(params: ParsedAggregateQuery): BuiltQuery {
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
    conditions.push(`attributes ->> $${values.length - 1} = $${values.length}`);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  const bucketExpr = bucketExpression(params.bucket);

  const selectGroupColumn = params.group_by ? params.group_by : "NULL";
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

export class LogRepository {
  async insertMany(logs: LogInput[]): Promise<void> {
    if (logs.length === 0) {
      return;
    }

    const values: unknown[] = [];
    const placeholders: string[] = [];

    logs.forEach((log, index) => {
      const offset = index * 5;

      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`
      );

      values.push(
        log.timestamp,
        log.level,
        log.service,
        log.message,
        JSON.stringify(log.attributes)
      );
    });

    await pool.query(
      `
      INSERT INTO logs (
        timestamp,
        level,
        service,
        message,
        attributes
      )
      VALUES
      ${placeholders.join(",")}
      `,
      values
    );
  }

  async findMany(params: ParsedLogsQuery): Promise<LogRow[]> {
    const { sql, values } = buildLogQuery(params);
    const result = await pool.query(sql, values);
    return result.rows;
  }

  async aggregate(params: ParsedAggregateQuery): Promise<AggregateRow[]> {
    const { sql, values } = buildAggregateQuery(params);
    const result = await pool.query(sql, values);
    return result.rows;
  }
}

export const logRepository = new LogRepository();