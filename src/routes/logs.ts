import { FastifyInstance } from "fastify";

import { validateTopLevel, validateBatch } from "../utils/validation.js";
import { logService } from "../services/log.service.js";

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
      return reply.status(400).send({
        accepted: 0,
        rejected,
      });
    }

    await logService.ingest(accepted);

    return reply.status(200).send({
      accepted: accepted.length,
      rejected,
    });
  });
}