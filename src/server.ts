import { buildApp } from "./app.js";
import pool from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { ensureUpcomingPartitions } from "./db/partition-manager.js";


const app = buildApp();

const port = Number(process.env.PORT ?? 8080);

async function start() {
  try {
    await pool.query("SELECT 1");

    app.log.info("Database connection successful");

    await runMigrations();
    app.log.info("Migrations applied");


    await ensureUpcomingPartitions();
    app.log.info("Upcoming partitions ensured");

    // src/server.ts — إضافة بعد ensureUpcomingPartitions الأولى

   const ONE_DAY_MS = 24 * 60 * 60 * 1000;

   setInterval(() => {
     ensureUpcomingPartitions().catch((err) => {
       app.log.error({ err }, "failed to ensure upcoming partitions");
     });
   }, ONE_DAY_MS);

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