import { FastifyInstance } from "fastify";

import { validateTopLevel, validateBatch } from "../utils/validation.js";
import { parseLogsQuery } from "../utils/query-params.js";
import { logService } from "../services/log.service.js";
import { parseAggregateQuery } from "../utils/aggregate-params.js";
import { ingestionBuffer } from "../services/ingestion-buffer.service.js";

export async function logsRoute(app: FastifyInstance) {
  app.post("/logs", async (request, reply) => {
  // فحص السعة أول شي — رخيص جدًا (مجرد مقارنة رقم)، يوقف الدورة العكسية فورًا
  if (ingestionBuffer.isFull()) {
    reply.header("Retry-After", "1");
    return reply.status(503).send({
      error: "ingestion buffer full, retry shortly",
      accepted: 0,
      rejected: [],
    });
  }

  const topLevel = validateTopLevel(request.body);
  if (!topLevel.success) {
    return reply.status(400).send({
      error: "request body must be an object with a non-empty 'logs' array",
    });
  }

  const { accepted, rejected } = validateBatch(topLevel.data.logs);
  if (accepted.length === 0) {
    return reply.status(400).send({ accepted: 0, rejected });
  }

  const bufferResult = await logService.ingest(accepted);
  if (!bufferResult.accepted) {
    reply.header("Retry-After", "1");
    return reply.status(503).send({
      error: "ingestion buffer full, retry shortly",
      accepted: 0,
      rejected,
    });
  }

  return reply.status(200).send({ accepted: accepted.length, rejected });
});

  app.get("/logs", async (request, reply) => {
    const parsed = parseLogsQuery(request.query as Record<string, unknown>);

    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error });
    }

    const result = await logService.query(parsed.data);

    return reply.status(200).send(result);
  });

 app.get("/logs/aggregate", async (request, reply) => {
   const receivedAt = Date.now();

   const parsed = parseAggregateQuery(request.query as Record<string, unknown>);

   if (!parsed.success) {
     return reply.status(400).send({ error: parsed.error });
   }

   const beforeQuery = Date.now();
   const result = await logService.aggregate(parsed.data);
   const afterQuery = Date.now();

   console.log(
     `aggregate timing: queueWait=${beforeQuery - receivedAt}ms dbQuery=${afterQuery - beforeQuery}ms total=${afterQuery - receivedAt}ms rows=${result.buckets.length}`
   );

   return reply.status(200).send(result);
 });
}