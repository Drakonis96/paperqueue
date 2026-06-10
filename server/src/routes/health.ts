import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

/**
 * Liveness/readiness probe. Also pings SQLite so a broken DB surfaces here
 * rather than on the first real request.
 */
const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health", async () => {
    const row = fastify.db.get(sql`select 1 as ok`) as
      | { ok: number }
      | undefined;

    return {
      status: "ok",
      db: row?.ok === 1 ? "connected" : "unknown",
      timestamp: new Date().toISOString(),
    };
  });
};

export default healthRoutes;
