import sensible from "@fastify/sensible";
import Fastify, { type FastifyInstance } from "fastify";
import { env, isDevelopment } from "./config/env.js";
import authPlugin from "./plugins/auth.js";
import dbPlugin from "./plugins/db.js";
import authRoutes from "./routes/auth.js";
import devRoutes from "./routes/dev.js";
import healthRoutes from "./routes/health.js";
import papersRoutes from "./routes/papers.js";
import pdfRoutes from "./routes/pdf.js";
import queueRoutes from "./routes/queue.js";
import sessionsRoutes from "./routes/sessions.js";
import statsRoutes from "./routes/stats.js";

/**
 * Builds and configures the Fastify app without starting to listen, so it can
 * be reused by the entrypoint and (later) by integration tests.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: isDevelopment
        ? {
            target: "pino-pretty",
            options: {
              translateTime: "HH:MM:ss Z",
              ignore: "pid,hostname",
            },
          }
        : undefined,
    },
  });

  await app.register(sensible);
  await app.register(dbPlugin);
  await app.register(authPlugin);

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes);
      await api.register(papersRoutes);
      await api.register(queueRoutes);
      await api.register(sessionsRoutes);
      await api.register(pdfRoutes);
      await api.register(statsRoutes);
      if (isDevelopment) {
        await api.register(devRoutes);
      }
    },
    { prefix: "/api/v1" },
  );

  return app;
}
