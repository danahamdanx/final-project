import { FastifyInstance } from "fastify";
import { checkHealth } from "../services/health.service.js";

export async function healthRoute(app: FastifyInstance) {
  app.get("/health", async (_, reply) => {
    try {
      const health = await checkHealth();

      return reply.status(200).send(health);
    } catch {
      return reply.status(503).send({
        status: "error",
        database: "down",
      });
    }
  });
}