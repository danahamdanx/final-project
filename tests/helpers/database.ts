import pool from "../../src/db/client.js";

export async function clearLogs() {
  await pool.query("TRUNCATE logs, logs_rollup_1m");
}

export async function countLogs(): Promise<number> {
  const result = await pool.query(
    "SELECT COUNT(*)::int AS count FROM logs"
  );

  return result.rows[0].count;
}