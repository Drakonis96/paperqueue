# PaperQueue — Server

Personal backend that bridges the **PaperQueue** app and the **Zotero Web API**.
Fastify + SQLite (Drizzle ORM), TypeScript, ESM.

## Requirements

- Node.js ≥ 20
- npm

## Setup

```bash
cd server
npm install
cp .env.example .env        # adjust if you like the defaults are fine
npm run db:generate         # generate SQL migration from the schema
npm run db:migrate          # apply migrations -> ./data/paperqueue.db
npm run dev                 # start the server with hot reload
```

The server listens on `http://localhost:3000` by default.

## Verify it works

```bash
curl http://localhost:3000/api/v1/health
# -> {"status":"ok","db":"connected","timestamp":"..."}
```

## Scripts

| Script                | What it does                                         |
| --------------------- | ---------------------------------------------------- |
| `npm run dev`         | Start the server with hot reload (`tsx watch`).      |
| `npm run build`       | Type-check and compile to `dist/`.                   |
| `npm run start`       | Run the compiled server from `dist/`.                |
| `npm run typecheck`   | Type-check only, no emit.                            |
| `npm run db:generate` | Generate a SQL migration from `src/db/schema.ts`.    |
| `npm run db:migrate`  | Apply pending migrations to the SQLite database.     |
| `npm run db:studio`   | Open Drizzle Studio (visual DB browser).             |

## Project structure

```
server/
├── drizzle/                 # generated SQL migrations (after db:generate)
├── src/
│   ├── config/
│   │   └── env.ts           # zod-validated environment config
│   ├── db/
│   │   ├── client.ts        # better-sqlite3 + Drizzle connection
│   │   ├── migrate.ts       # migration runner
│   │   └── schema.ts        # papers, queue, reading_sessions
│   ├── plugins/
│   │   └── db.ts            # Fastify plugin exposing `fastify.db`
│   ├── routes/
│   │   └── health.ts        # GET /api/v1/health
│   ├── app.ts               # Fastify app factory
│   └── index.ts             # entrypoint
├── drizzle.config.ts
├── tsconfig.json
└── package.json
```

## Data model (current)

- **papers** — local cache of Zotero items (metadata, tags, PDF attachment key,
  read status, sync version).
- **queue** — prioritised reading list; one entry per paper, with status and
  postpone time.
- **reading_sessions** — timed reading sessions with duration and page progress.

> Users / Zotero OAuth tokens are intentionally not modelled yet — they arrive
> with the authentication task.
