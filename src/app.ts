import Fastify from "fastify";
import { healthRoute } from "./routes/health.js";
import { logsRoute } from "./routes/logs.js";
import { registerErrorHandler } from "./plugins/error-handler.js";

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.register(healthRoute);
  app.register(logsRoute);
  registerErrorHandler(app);

  return app;
}