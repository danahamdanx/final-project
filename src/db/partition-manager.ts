import pool from "./client.js";

const PARTITION_LOOKAHEAD_DAYS = 7;

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function partitionName(date: Date): string {
  return `logs_${formatDate(date).replace(/-/g, "_")}`;
}

async function partitionExists(name: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM pg_class WHERE relname = $1`,
    [name]
  );
  return (result.rowCount ?? 0) > 0;
}

async function createDailyPartition(date: Date): Promise<void> {
  const name = partitionName(date);

  if (await partitionExists(name)) {
    return;
  }

  const start = formatDate(date);
  const nextDay = new Date(date);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const end = formatDate(nextDay);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${name} PARTITION OF logs
    FOR VALUES FROM ('${start}') TO ('${end}')
  `);
}

/**
 * ينشئ partitions يومية بدءًا من اليوم لحد N يوم قدام.
 * آمن للاستدعاء المتكرر (idempotent) — بيتخطى الـ partitions الموجودة أصلًا.
 */
export async function ensureUpcomingPartitions(
  lookaheadDays: number = PARTITION_LOOKAHEAD_DAYS
): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let i = 0; i < lookaheadDays; i++) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + i);
    await createDailyPartition(date);
  }
}