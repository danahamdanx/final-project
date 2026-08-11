import Fastify from "fastify";
import { healthRoute } from "./routes/health.js";
import { logsRoute } from "./routes/logs.js";
import { registerErrorHandler } from "./plugins/error-handler.js";

export function buildApp() {
  const app = Fastify({
    logger: false,
  });

  app.register(healthRoute);
  app.register(logsRoute);
  registerErrorHandler(app);

  return app;
}