import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { account, type Account, type NewAccount } from "../db/schema.js";

/** Single-user MVP: the account is a singleton (we keep the most recent row). */
export const accountRepo = {
  async get(db: DB): Promise<Account | undefined> {
    const rows = await db.select().from(account).limit(1);
    return rows[0];
  },

  async getBySessionToken(
    db: DB,
    token: string,
  ): Promise<Account | undefined> {
    const rows = await db
      .select()
      .from(account)
      .where(eq(account.sessionToken, token))
      .limit(1);
    return rows[0];
  },

  /** Replaces the account row (there is only ever one). */
  async upsert(db: DB, data: NewAccount): Promise<Account> {
    await db.delete(account);
    const inserted = await db.insert(account).values(data).returning();
    return inserted[0]!;
  },

  async clear(db: DB): Promise<void> {
    await db.delete(account);
  },
};
