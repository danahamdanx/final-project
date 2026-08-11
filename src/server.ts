import { buildApp } from "./app.js";
import { readPool, writePool } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { ensureUpcomingPartitions } from "./db/partition-manager.js";
import { runRetention } from "./services/retention.service.js";
import { ingestionBuffer } from "./services/ingestion-buffer.service.js";

let lastCheck = Date.now();
setInterval(() => {
  const now = Date.now();
  const drift = now - lastCheck - 50;
  if (drift > 100) {
    console.warn(`event loop stall: ${drift}ms at ${new Date().toISOString()}`);
  }
  lastCheck = now;
}, 50);

process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection", reason);
});

const app = buildApp();
const port = Number(process.env.PORT ?? 8080);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function start() {
  try {
    await readPool.query("SELECT 1");
    app.log.info("Database connection successful");

    await runMigrations();
    app.log.info("Migrations applied");

    await ensureUpcomingPartitions();
    app.log.info("Upcoming partitions ensured");

    const retentionResult = await runRetention();
    app.log.info(retentionResult, "Retention check completed");

    ingestionBuffer.start();
    app.log.info("Ingestion buffer started");

    setInterval(() => {
      ensureUpcomingPartitions().catch((err) => {
        app.log.error({ err }, "failed to ensure upcoming partitions");
      });
    }, ONE_DAY_MS);

    setInterval(() => {
      runRetention()
        .then((result) => app.log.info(result, "Retention check completed"))
        .catch((err) => {
          app.log.error({ err }, "failed to run retention");
        });
    }, ONE_DAY_MS);

    await app.listen({ host: "0.0.0.0", port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on("SIGTERM", async () => {
  app.log.info("SIGTERM received, flushing remaining logs");
  await ingestionBuffer.stop();
  await app.close();
  process.exit(0);
});

void start();