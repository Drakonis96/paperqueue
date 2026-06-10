import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { papers, type NewPaper, type Paper } from "../db/schema.js";

export const papersRepo = {
  async all(db: DB): Promise<Paper[]> {
    return db.select().from(papers);
  },

  async byId(db: DB, id: number): Promise<Paper | undefined> {
    const rows = await db
      .select()
      .from(papers)
      .where(eq(papers.id, id))
      .limit(1);
    return rows[0];
  },

  async byZoteroKey(
    db: DB,
    libraryId: string,
    zoteroKey: string,
  ): Promise<Paper | undefined> {
    const rows = await db.select().from(papers).where(eq(papers.zoteroKey, zoteroKey));
    return rows.find((p) => p.libraryId === libraryId);
  },

  /**
   * Inserts a new paper or updates the existing one (matched by
   * library_id + zotero_key). Returns the row id.
   */
  async upsert(db: DB, data: NewPaper): Promise<number> {
    const existing = await this.byZoteroKey(db, data.libraryId, data.zoteroKey);
    if (existing) {
      await db
        .update(papers)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(papers.id, existing.id));
      return existing.id;
    }
    const inserted = await db.insert(papers).values(data).returning({
      id: papers.id,
    });
    return inserted[0]!.id;
  },

  async setReadStatus(
    db: DB,
    id: number,
    status: Paper["readStatus"],
    tags: string[],
  ): Promise<void> {
    await db
      .update(papers)
      .set({ readStatus: status, tags, updatedAt: new Date() })
      .where(eq(papers.id, id));
  },
};
