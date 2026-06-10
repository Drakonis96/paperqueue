import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import {
  account,
  papers,
  queue,
  readingSessions,
  type Creator,
} from "../db/schema.js";

/**
 * Development-only helpers. Lets us exercise the queue/sessions/stats endpoints
 * without a real Zotero account. NOT registered in production.
 */
const DEV_SESSION_TOKEN = "dev-session-token";

const SAMPLE_PAPERS: Array<{
  zoteroKey: string;
  title: string;
  creators: Creator[];
  publicationTitle: string;
  date: string;
}> = [
  {
    zoteroKey: "DEVKEY01",
    title: "Attention Is All You Need",
    creators: [
      { creatorType: "author", firstName: "Ashish", lastName: "Vaswani" },
      { creatorType: "author", firstName: "Noam", lastName: "Shazeer" },
    ],
    publicationTitle: "NeurIPS",
    date: "2017",
  },
  {
    zoteroKey: "DEVKEY02",
    title: "Deep Residual Learning for Image Recognition",
    creators: [{ creatorType: "author", firstName: "Kaiming", lastName: "He" }],
    publicationTitle: "CVPR",
    date: "2016",
  },
  {
    zoteroKey: "DEVKEY03",
    title: "BERT: Pre-training of Deep Bidirectional Transformers",
    creators: [{ creatorType: "author", firstName: "Jacob", lastName: "Devlin" }],
    publicationTitle: "NAACL",
    date: "2019",
  },
  {
    zoteroKey: "DEVKEY04",
    title: "A Few Useful Things to Know About Machine Learning",
    creators: [{ creatorType: "author", firstName: "Pedro", lastName: "Domingos" }],
    publicationTitle: "CACM",
    date: "2012",
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

const devRoutes: FastifyPluginAsync = async (fastify) => {
  // Seeds a fake account + papers + queue + a couple of reading sessions.
  fastify.post("/dev/seed", async (request) => {
    const db = fastify.db;

    await db.delete(readingSessions);
    await db.delete(queue);
    await db.delete(papers);
    await db.delete(account);

    await db.insert(account).values({
      zoteroUserId: "0",
      username: "dev",
      apiKey: "dev-api-key",
      libraryId: "users/0",
      sessionToken: DEV_SESSION_TOKEN,
    });

    const insertedIds: number[] = [];
    for (const p of SAMPLE_PAPERS) {
      const rows = await db
        .insert(papers)
        .values({
          zoteroKey: p.zoteroKey,
          zoteroVersion: 1,
          libraryId: "users/0",
          itemType: "journalArticle",
          title: p.title,
          creators: p.creators,
          publicationTitle: p.publicationTitle,
          publicationDate: p.date,
          tags: [],
          readStatus: "unread",
        })
        .returning({ id: papers.id });
      const id = rows[0]!.id;
      insertedIds.push(id);
      await db.insert(queue).values({ paperId: id, priority: id });
    }

    // Mark the first paper read (a session two days ago) plus a session today,
    // so streak/stats have something to display.
    const firstId = insertedIds[0]!;
    const now = Date.now();
    await db
      .update(papers)
      .set({ readStatus: "read", updatedAt: new Date(now) })
      .where(eq(papers.id, firstId));
    await db
      .update(queue)
      .set({ status: "done", completedAt: new Date(now) })
      .where(eq(queue.paperId, firstId));

    await db.insert(readingSessions).values([
      {
        paperId: firstId,
        startedAt: new Date(now - 2 * DAY_MS),
        endedAt: new Date(now - 2 * DAY_MS + 600_000),
        durationSeconds: 600,
        lastPage: 8,
        totalPages: 12,
      },
      {
        paperId: insertedIds[1]!,
        startedAt: new Date(now),
        endedAt: new Date(now + 300_000),
        durationSeconds: 300,
        lastPage: 3,
        totalPages: 10,
      },
    ]);

    request.log.info("Dev seed complete");
    return {
      ok: true,
      sessionToken: DEV_SESSION_TOKEN,
      papers: insertedIds.length,
    };
  });
};

export default devRoutes;
