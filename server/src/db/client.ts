import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

// Resolve the DB path relative to the server/ directory (process.cwd()).
const dbPath = isAbsolute(env.DATABASE_URL)
  ? env.DATABASE_URL
  : resolve(process.cwd(), env.DATABASE_URL);

// Ensure the parent directory (e.g. ./data) exists before opening the file.
const dir = dirname(dbPath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

export const sqlite = new Database(dbPath);

// WAL: better read/write concurrency. foreign_keys: enforce ON DELETE CASCADE.
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export type DB = typeof db;
