import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readPool, writePool } from "../db/client.js";

let migrationsApplied = false;

export function isMigrationsApplied(): boolean {
  return migrationsApplied;
}

export async function runMigrations(): Promise<void> {
  await readPool.query(`
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
    const exists = await readPool.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [file]
    );

    if (exists.rowCount !== 0) {
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, file), "utf8");

    const client = await readPool.connect();

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

  migrationsApplied = true;
}