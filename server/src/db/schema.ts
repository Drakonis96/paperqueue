import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * A Zotero creator (author, editor, ...). Stored as a JSON blob on `papers`
 * because we only ever read it back whole for display.
 */
export type Creator = {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  /** Single-field name (used for institutional authors). */
  name?: string;
};

/** Read state, kept in sync with Zotero tags (`_read`, `_skip`, ...). */
export const READ_STATUSES = ["unread", "reading", "read", "skipped"] as const;
export type ReadStatus = (typeof READ_STATUSES)[number];

/** Lifecycle of an entry in the reading queue. */
export const QUEUE_STATUSES = [
  "pending",
  "reading",
  "done",
  "postponed",
] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

// SQLite stores timestamps as integer epoch-milliseconds; Drizzle maps them
// to JS `Date` via `mode: "timestamp_ms"`. This default fills them server-side.
const nowMs = sql`(unixepoch() * 1000)`;

/* -------------------------------------------------------------------------- */
/*  papers — local cache of Zotero items                                      */
/* -------------------------------------------------------------------------- */

export const papers = sqliteTable(
  "papers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    // Zotero identity & sync bookkeeping.
    zoteroKey: text("zotero_key").notNull(),
    zoteroVersion: integer("zotero_version").notNull().default(0),
    libraryId: text("library_id").notNull(),

    // Bibliographic metadata.
    itemType: text("item_type").notNull().default("journalArticle"),
    title: text("title").notNull(),
    creators: text("creators", { mode: "json" })
      .$type<Creator[]>()
      .notNull()
      .default(sql`'[]'`),
    abstract: text("abstract"),
    publicationTitle: text("publication_title"),
    publicationDate: text("publication_date"),
    doi: text("doi"),
    url: text("url"),

    // Cached Zotero tags (the source of truth for read state lives in Zotero).
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),

    // Key of the child PDF attachment item in Zotero, if any.
    pdfAttachmentKey: text("pdf_attachment_key"),

    readStatus: text("read_status", { enum: READ_STATUSES })
      .notNull()
      .default("unread"),

    // Original Zotero "date added", kept for sorting the freshest items first.
    zoteroDateAdded: text("zotero_date_added"),

    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (t) => [
    // A Zotero item key is unique within a library.
    uniqueIndex("papers_library_zotero_key_idx").on(t.libraryId, t.zoteroKey),
    index("papers_read_status_idx").on(t.readStatus),
  ],
);

/* -------------------------------------------------------------------------- */
/*  queue — prioritised reading list                                          */
/* -------------------------------------------------------------------------- */

export const queue = sqliteTable(
  "queue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    paperId: integer("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),

    status: text("status", { enum: QUEUE_STATUSES })
      .notNull()
      .default("pending"),

    // `real` so we can insert "between" two items when reordering without
    // rewriting every row. Lower number = higher priority.
    priority: real("priority").notNull().default(0),
    // Manual drag-to-reorder position; ties broken by priority.
    position: integer("position").notNull().default(0),

    // Set when the user postpones ("swipe left"); item is hidden until then.
    postponedUntil: integer("postponed_until", { mode: "timestamp_ms" }),

    addedAt: integer("added_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (t) => [
    // Each paper appears in the queue at most once.
    uniqueIndex("queue_paper_id_idx").on(t.paperId),
    index("queue_status_priority_idx").on(t.status, t.priority),
  ],
);

/* -------------------------------------------------------------------------- */
/*  reading_sessions — timed reading sessions per paper                       */
/* -------------------------------------------------------------------------- */

export const readingSessions = sqliteTable(
  "reading_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    paperId: integer("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),

    startedAt: integer("started_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    // Denormalised duration, written when the session closes, so weekly/streak
    // stats don't have to recompute from start/end on every read.
    durationSeconds: integer("duration_seconds").notNull().default(0),

    // Reading progress, for the per-paper progress indicator.
    lastPage: integer("last_page"),
    totalPages: integer("total_pages"),

    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (t) => [
    index("reading_sessions_paper_id_idx").on(t.paperId),
    index("reading_sessions_started_at_idx").on(t.startedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*  account — single-user Zotero credentials + app session                    */
/* -------------------------------------------------------------------------- */

// Single-user MVP: there is exactly one row (id = 1). It holds the Zotero API
// key obtained via OAuth and the bearer token the app uses to talk to us.
export const account = sqliteTable("account", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  zoteroUserId: text("zotero_user_id").notNull(),
  username: text("username"),
  /** Zotero API key (the OAuth access token doubles as the key). */
  apiKey: text("api_key").notNull(),
  /** Library path segment, e.g. "users/123456". */
  libraryId: text("library_id").notNull(),
  /** Opaque bearer token the app sends as `Authorization: Bearer <token>`. */
  sessionToken: text("session_token").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(nowMs),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(nowMs),
});

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;

/* -------------------------------------------------------------------------- */
/*  Relations (for the Drizzle relational query API)                          */
/* -------------------------------------------------------------------------- */

export const papersRelations = relations(papers, ({ one, many }) => ({
  queueEntry: one(queue, {
    fields: [papers.id],
    references: [queue.paperId],
  }),
  sessions: many(readingSessions),
}));

export const queueRelations = relations(queue, ({ one }) => ({
  paper: one(papers, {
    fields: [queue.paperId],
    references: [papers.id],
  }),
}));

export const readingSessionsRelations = relations(
  readingSessions,
  ({ one }) => ({
    paper: one(papers, {
      fields: [readingSessions.paperId],
      references: [papers.id],
    }),
  }),
);

/* -------------------------------------------------------------------------- */
/*  Inferred row types — import these across the codebase                     */
/* -------------------------------------------------------------------------- */

export type Paper = typeof papers.$inferSelect;
export type NewPaper = typeof papers.$inferInsert;
export type QueueEntry = typeof queue.$inferSelect;
export type NewQueueEntry = typeof queue.$inferInsert;
export type ReadingSession = typeof readingSessions.$inferSelect;
export type NewReadingSession = typeof readingSessions.$inferInsert;
