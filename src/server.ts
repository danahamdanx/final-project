import { buildApp } from "./app.js";
import pool from "./db/client.js";
import { runMigrations } from "./db/migrate.js";

const app = buildApp();

const port = Number(process.env.PORT ?? 8080);

async function start() {
  try {
    await pool.query("SELECT 1");

    app.log.info("Database connection successful");

    await runMigrations();

    await app.listen({
      host: "0.0.0.0",
      port,
    });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();