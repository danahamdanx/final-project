import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pool from "./client.js";

export async function runMigrations(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const migrationsDir = path.join(process.cwd(), "migrations");

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const exists = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [file]
    );

    if (exists.rowCount !== 0) {
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, file), "utf8");

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(sql);

      await client.query(
        "INSERT INTO schema_migrations(version) VALUES($1)",
        [file]
      );

      await client.query("COMMIT");

      console.log(`Migration ${file} applied.`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}