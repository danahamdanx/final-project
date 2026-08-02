import { FastifyInstance } from "fastify";
import { ZodError } from "zod";

export async function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "ValidationError",
        message: "Request validation failed",
        details: error.issues,
      });
    }

    return reply.status(500).send({
      error: "InternalServerError",
      message: "An unexpected error occurred",
    });
  });
}