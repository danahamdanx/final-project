import Fastify from "fastify";
import pool from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
const app = Fastify({
  logger: true,
});

const port = Number(process.env.PORT ?? 8080);
const host = "0.0.0.0";

const start = async (): Promise<void> => {
  try {
    await pool.query("SELECT 1");

    app.log.info("Database connection successful");
    await runMigrations();
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();