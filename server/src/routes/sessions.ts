import type { FastifyPluginAsync } from "fastify";
import { sessionToDTO } from "../dto.js";
import { papersRepo } from "../repositories/papers.repo.js";
import { sessionsRepo } from "../repositories/sessions.repo.js";

const sessionsRoutes: FastifyPluginAsync = async (fastify) => {
  // Recent reading sessions.
  fastify.get(
    "/sessions",
    { preHandler: [fastify.authenticate] },
    async () => {
      const rows = await sessionsRepo.recent(fastify.db);
      return { sessions: rows.map(sessionToDTO) };
    },
  );

  // Start a reading session (called when the reader opens).
  fastify.post<{ Body: { paperId: number; totalPages?: number } }>(
    "/sessions",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { paperId, totalPages } = request.body ?? {};
      if (!paperId) return reply.badRequest("paperId is required");

      const paper = await papersRepo.byId(fastify.db, paperId);
      if (!paper) return reply.notFound("Paper not found");

      const session = await sessionsRepo.start(fastify.db, {
        paperId,
        startedAt: new Date(),
        totalPages: totalPages ?? null,
      });
      return { session: sessionToDTO(session) };
    },
  );

  // Finish a reading session (called when the reader closes).
  fastify.patch<{
    Params: { id: string };
    Body: {
      durationSeconds?: number;
      lastPage?: number;
      totalPages?: number;
    };
  }>(
    "/sessions/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const existing = await sessionsRepo.byId(fastify.db, id);
      if (!existing) return reply.notFound("Session not found");

      const { durationSeconds, lastPage, totalPages } = request.body ?? {};
      const updated = await sessionsRepo.finish(fastify.db, id, {
        endedAt: new Date(),
        durationSeconds: durationSeconds ?? existing.durationSeconds,
        lastPage: lastPage ?? existing.lastPage,
        totalPages: totalPages ?? existing.totalPages,
      });
      return { session: sessionToDTO(updated!) };
    },
  );
};

export default sessionsRoutes;
