import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import type { DB } from "../db/client.js";
import {
  papers,
  queue,
  type Paper,
  type QueueEntry,
} from "../db/schema.js";

export type QueueItem = { queue: QueueEntry; paper: Paper };

export const queueRepo = {
  /**
   * Pending items, freshest priority first. A "postponed" item reappears once
   * its `postponedUntil` time has passed.
   */
  async pending(db: DB, now: Date): Promise<QueueItem[]> {
    const rows = await db
      .select({ queue, paper: papers })
      .from(queue)
      .innerJoin(papers, eq(queue.paperId, papers.id))
      .where(
        or(
          eq(queue.status, "pending"),
          and(
            eq(queue.status, "postponed"),
            or(
              isNull(queue.postponedUntil),
              lte(queue.postponedUntil, now),
            ),
          ),
        ),
      )
      .orderBy(asc(queue.priority), asc(queue.position), asc(queue.addedAt));

    return rows.map((r) => ({ queue: r.queue, paper: r.paper }));
  },

  async byPaperId(db: DB, paperId: number): Promise<QueueEntry | undefined> {
    const rows = await db
      .select()
      .from(queue)
      .where(eq(queue.paperId, paperId))
      .limit(1);
    return rows[0];
  },

  /** Ensures a queue entry exists for a paper (idempotent). */
  async ensure(db: DB, paperId: number, priority = 0): Promise<void> {
    const existing = await this.byPaperId(db, paperId);
    if (!existing) {
      await db.insert(queue).values({ paperId, priority });
    }
  },

  async setStatus(
    db: DB,
    paperId: number,
    status: QueueEntry["status"],
    extra: Partial<QueueEntry> = {},
  ): Promise<void> {
    await db
      .update(queue)
      .set({ status, updatedAt: new Date(), ...extra })
      .where(eq(queue.paperId, paperId));
  },

  async pendingCount(db: DB, now: Date): Promise<number> {
    return (await this.pending(db, now)).length;
  },
};
