import fp from "fastify-plugin";
import { db, sqlite, type DB } from "../db/client.js";

declare module "fastify" {
  interface FastifyInstance {
    db: DB;
  }
}

/**
 * Decorates the Fastify instance with the shared Drizzle `db` handle and
 * closes the underlying SQLite connection on shutdown.
 */
export default fp(
  async (fastify) => {
    fastify.decorate("db", db);

    fastify.addHook("onClose", async () => {
      sqlite.close();
    });
  },
  { name: "db" },
);
