import type { FastifyPluginAsync } from "fastify";
import { paperToDTO } from "../dto.js";
import { papersRepo } from "../repositories/papers.repo.js";
import { queueRepo } from "../repositories/queue.repo.js";
import { syncLibrary } from "../services/sync.service.js";

const papersRoutes: FastifyPluginAsync = async (fastify) => {
  // Cached library (works offline; no Zotero round-trip).
  fastify.get(
    "/papers",
    { preHandler: [fastify.authenticate] },
    async (request) => {
      const rows = await papersRepo.all(fastify.db);
      const out = [];
      for (const paper of rows) {
        const q = await queueRepo.byPaperId(fastify.db, paper.id);
        out.push(paperToDTO(paper, q));
      }
      return { papers: out };
    },
  );

  // Pull the latest from Zotero and reconcile the cache.
  fastify.post(
    "/papers/sync",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const result = await syncLibrary(fastify.db, request.account);
        const pendingCount = await queueRepo.pendingCount(
          fastify.db,
          new Date(),
        );
        return { ...result, pendingCount };
      } catch (err) {
        request.log.error(err, "Library sync failed");
        return reply.badGateway("Failed to sync with Zotero.");
      }
    },
  );
};

export default papersRoutes;
