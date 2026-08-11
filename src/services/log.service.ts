import { LogInput } from "../schemas/log.schema.js";
import { logRepository, LogRow } from "../repositories/log.repository.js";
import { ParsedLogsQuery } from "../utils/query-params.js";
import { encodeCursor } from "../utils/cursor.js";
import { ParsedAggregateQuery } from "../utils/aggregate-params.js";
import { ingestionBuffer } from "./ingestion-buffer.service.js";


export interface LogApiShape {
  id: string;
  timestamp: string;
  level: string;
  service: string;
  message: string;
  attributes: Record<string, unknown>;
}

export interface LogsQueryResult {
  logs: LogApiShape[];
  next_cursor: string | null;
}

export interface AggregateBucket {
  start: string;
  group: string | null;
  count: number;
}

export interface AggregateResult {
  buckets: AggregateBucket[];
}

function formatRow(row: LogRow): LogApiShape {
  return {
    id: row.id,
    timestamp: row.timestamp.toISOString(),
    level: row.level,
    service: row.service,
    message: row.message,
    attributes: row.attributes,
  };
}

export class LogService {
  async ingest(logs: LogInput[]): Promise<void> {
        ingestionBuffer.add(logs);

  }

  async query(params: ParsedLogsQuery): Promise<LogsQueryResult> {
    const rows = await logRepository.findMany(params);
    const hasMore = rows.length > params.limit;
    const pageRows = hasMore ? rows.slice(0, params.limit) : rows;

    const logs = pageRows.map(formatRow);

    let next_cursor: string | null = null;

    if (hasMore) {
      const last = pageRows[pageRows.length - 1];
      if (!last) {
        throw new Error("expected at least one row when hasMore is true");
      }
      next_cursor = encodeCursor({
        timestamp: last.timestamp.toISOString(),
        id: last.id,
      });
    }

    return { logs, next_cursor };
  }

  async aggregate(params: ParsedAggregateQuery): Promise<AggregateResult> {
    const rows = await logRepository.aggregate(params);

    const buckets = rows.map((row) => ({
      start: row.bucket_start.toISOString(),
      group: row.group_value,
      count: Number(row.count),
    }));

    return { buckets };
  }
}

export const logService = new LogService();