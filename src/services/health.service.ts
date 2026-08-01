import pool from "../db/client.js";

export interface HealthStatus {
  status: "ok";
  database: "up";
}

export async function checkHealth(): Promise<HealthStatus> {
  await pool.query("SELECT 1");

  return {
    status: "ok",
    database: "up",
  };
}