import type { FastifyPluginAsync } from "fastify";
import { computeStats } from "../services/stats.service.js";

const statsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/stats",
    { preHandler: [fastify.authenticate] },
    async () => computeStats(fastify.db, new Date()),
  );
};

export default statsRoutes;
