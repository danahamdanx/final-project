import pool from "../db/client.js";

function getRetentionDays(): number {
  const raw = process.env.RETENTION_DAYS ?? "30";
  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid RETENTION_DAYS value: '${raw}'`);
  }

  return parsed;
}

interface PartitionInfo {
  partitionName: string;
  partitionStart: Date;
}

async function listLogPartitions(): Promise<PartitionInfo[]> {
  const result = await pool.query<{ relname: string }>(`
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'logs'
      AND c.relname != 'logs_default'
  `);

  return result.rows
    .map((row) => {
      const match = row.relname.match(/^logs_(\d{4})_(\d{2})_(\d{2})$/);
      if (!match) return null;

      const [, year, month, day] = match;
      const partitionStart = new Date(
        Date.UTC(Number(year), Number(month) - 1, Number(day))
      );

      return { partitionName: row.relname, partitionStart };
    })
    .filter((p): p is PartitionInfo => p !== null);
}

export interface RetentionResult {
  retentionDays: number;
  droppedPartitions: string[];
}

export async function runRetention(retentionDaysOverride?: number): Promise<RetentionResult> {
  const retentionDays = retentionDaysOverride ?? getRetentionDays();

  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);

  const partitions = await listLogPartitions();
  const droppedPartitions: string[] = [];

  for (const partition of partitions) {
    if (partition.partitionStart < cutoff) {
      await pool.query(`DROP TABLE IF EXISTS ${partition.partitionName}`);
      droppedPartitions.push(partition.partitionName);
    }
  }

  return { retentionDays, droppedPartitions };
}