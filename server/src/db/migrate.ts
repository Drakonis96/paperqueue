import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, sqlite } from "./client.js";

/**
 * Applies any pending SQL migrations from ./drizzle.
 * Run with `npm run db:migrate` (after `npm run db:generate`).
 */
console.log("Running migrations...");
migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations complete.");
sqlite.close();
