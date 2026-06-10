import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { POSTPONE_MS, READ_TAG, SKIP_TAG } from "../constants.js";
import { paperToDTO } from "../dto.js";
import type { Account, Paper } from "../db/schema.js";
import { papersRepo } from "../repositories/papers.repo.js";
import { queueRepo } from "../repositories/queue.repo.js";
import { ZoteroClient } from "../services/zotero/client.js";

/**
 * Writes the desired status tags to Zotero, merging with the paper's existing
 * non-status tags. Best-effort: on failure we keep the local change and let the
 * next sync reconcile, so the app stays responsive offline.
 */
async function pushTags(
  fastify: FastifyInstance,
  account: Account,
  paper: Paper,
  add: string[],
  remove: string[],
): Promise<string[]> {
  const base = paper.tags.filter((t) => !remove.includes(t));
  const nextTags = Array.from(new Set([...base, ...add]));

  if (paper.pdfAttachmentKey === null && !paper.zoteroKey) return nextTags;

  try {
    const client = new ZoteroClient(account.apiKey, account.zoteroUserId);
    await client.setTags(paper.zoteroKey, nextTags);
  } catch (err) {
    fastify.log.warn(
      { err, paperId: paper.id },
      "Zotero tag write failed; keeping local change",
    );
  }
  return nextTags;
}

const queueRoutes: FastifyPluginAsync = async (fastify) => {
  // The reading queue: pending papers, highest priority first.
  fastify.get(
    "/queue",
    { preHandler: [fastify.authenticate] },
    async () => {
      const items = await queueRepo.pending(fastify.db, new Date());
      return {
        items: items.map((i) => paperToDTO(i.paper, i.queue)),
        count: items.length,
      };
    },
  );

  // Swipe right: mark as read -> _read tag in Zotero + local done.
  fastify.post<{ Params: { paperId: string } }>(
    "/queue/:paperId/read",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const paper = await papersRepo.byId(
        fastify.db,
        Number(request.params.paperId),
      );
      if (!paper) return reply.notFound("Paper not found");

      const tags = await pushTags(
        fastify,
        request.account,
        paper,
        [READ_TAG],
        [SKIP_TAG],
      );
      await papersRepo.setReadStatus(fastify.db, paper.id, "read", tags);
      await queueRepo.ensure(fastify.db, paper.id);
      await queueRepo.setStatus(fastify.db, paper.id, "done", {
        completedAt: new Date(),
      });

      const fresh = await papersRepo.byId(fastify.db, paper.id);
      const q = await queueRepo.byPaperId(fastify.db, paper.id);
      return { paper: paperToDTO(fresh!, q) };
    },
  );

  // Mark as skipped -> _skip tag in Zotero + local done.
  fastify.post<{ Params: { paperId: string } }>(
    "/queue/:paperId/skip",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const paper = await papersRepo.byId(
        fastify.db,
        Number(request.params.paperId),
      );
      if (!paper) return reply.notFound("Paper not found");

      const tags = await pushTags(
        fastify,
        request.account,
        paper,
        [SKIP_TAG],
        [READ_TAG],
      );
      await papersRepo.setReadStatus(fastify.db, paper.id, "skipped", tags);
      await queueRepo.ensure(fastify.db, paper.id);
      await queueRepo.setStatus(fastify.db, paper.id, "done");

      const fresh = await papersRepo.byId(fastify.db, paper.id);
      const q = await queueRepo.byPaperId(fastify.db, paper.id);
      return { paper: paperToDTO(fresh!, q) };
    },
  );

  // Swipe left: postpone -> hidden until postponedUntil. No Zotero write.
  fastify.post<{
    Params: { paperId: string };
    Body: { days?: number };
  }>(
    "/queue/:paperId/postpone",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const paper = await papersRepo.byId(
        fastify.db,
        Number(request.params.paperId),
      );
      if (!paper) return reply.notFound("Paper not found");

      const days = request.body?.days ?? 1;
      const until = new Date(Date.now() + days * POSTPONE_MS);
      await queueRepo.ensure(fastify.db, paper.id);
      await queueRepo.setStatus(fastify.db, paper.id, "postponed", {
        postponedUntil: until,
      });

      const q = await queueRepo.byPaperId(fastify.db, paper.id);
      return { paper: paperToDTO(paper, q) };
    },
  );

  // Undo: bring a paper back to the pending queue and clear status tags.
  fastify.post<{ Params: { paperId: string } }>(
    "/queue/:paperId/reset",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const paper = await papersRepo.byId(
        fastify.db,
        Number(request.params.paperId),
      );
      if (!paper) return reply.notFound("Paper not found");

      const tags = await pushTags(
        fastify,
        request.account,
        paper,
        [],
        [READ_TAG, SKIP_TAG],
      );
      await papersRepo.setReadStatus(fastify.db, paper.id, "unread", tags);
      await queueRepo.ensure(fastify.db, paper.id);
      await queueRepo.setStatus(fastify.db, paper.id, "pending", {
        completedAt: null,
        postponedUntil: null,
      });

      const fresh = await papersRepo.byId(fastify.db, paper.id);
      const q = await queueRepo.byPaperId(fastify.db, paper.id);
      return { paper: paperToDTO(fresh!, q) };
    },
  );
};

export default queueRoutes;
