import { readPool } from "../db/client.js";
import { isMigrationsApplied } from "../db/migrate.js";

export interface HealthStatus {
  status: "ok";
  checks: {
    database: "up";
    migrations: "applied";
  };
}

export async function checkHealth(): Promise<HealthStatus> {
  await readPool.query("SELECT 1");

  if (!isMigrationsApplied()) {
    throw new Error("migrations not yet applied");
  }

  return {
    status: "ok",
    checks: {
      database: "up",
      migrations: "applied",
    },
  };
}