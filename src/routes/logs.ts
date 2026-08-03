import { FastifyInstance } from "fastify";

import { validateTopLevel, validateBatch } from "../utils/validation.js";
import { parseLogsQuery } from "../utils/query-params.js";
import { logService } from "../services/log.service.js";
import { parseAggregateQuery } from "../utils/aggregate-params.js";


export async function logsRoute(app: FastifyInstance) {
  app.post("/logs", async (request, reply) => {
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

    await logService.ingest(accepted);

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
  const parsed = parseAggregateQuery(request.query as Record<string, unknown>);

  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error });
  }

  const result = await logService.aggregate(parsed.data);

  return reply.status(200).send(result);
});
}