import { FastifyInstance, FastifyError } from "fastify";
import { ZodError } from "zod";

export async function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error(error);

    // JSON مشوّه أو body غير قابل للتحليل — Fastify بترميها كـ SyntaxError
    // أو FastifyError بكود يبدأ بـ FST_ERR_CTP قبل ما توصل لأي مرحلة تحقق
    const errorCode = typeof error.code === "string" ? error.code : "";

    if (error instanceof SyntaxError || errorCode.startsWith("FST_ERR_CTP")) {
      return reply.status(400).send({
        error: "request body contains malformed JSON",
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "Request validation failed",
      });
    }

    return reply.status(500).send({
      error: "internal server error",
    });
  });
}