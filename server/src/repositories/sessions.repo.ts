import { desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import {
  readingSessions,
  type NewReadingSession,
  type ReadingSession,
} from "../db/schema.js";

export const sessionsRepo = {
  async start(db: DB, data: NewReadingSession): Promise<ReadingSession> {
    const inserted = await db
      .insert(readingSessions)
      .values(data)
      .returning();
    return inserted[0]!;
  },

  async byId(db: DB, id: number): Promise<ReadingSession | undefined> {
    const rows = await db
      .select()
      .from(readingSessions)
      .where(eq(readingSessions.id, id))
      .limit(1);
    return rows[0];
  },

  async finish(
    db: DB,
    id: number,
    patch: Partial<
      Pick<
        ReadingSession,
        "endedAt" | "durationSeconds" | "lastPage" | "totalPages"
      >
    >,
  ): Promise<ReadingSession | undefined> {
    await db
      .update(readingSessions)
      .set(patch)
      .where(eq(readingSessions.id, id));
    return this.byId(db, id);
  },

  async recent(db: DB, limit = 100): Promise<ReadingSession[]> {
    return db
      .select()
      .from(readingSessions)
      .orderBy(desc(readingSessions.startedAt))
      .limit(limit);
  },

  async all(db: DB): Promise<ReadingSession[]> {
    return db.select().from(readingSessions);
  },
};
