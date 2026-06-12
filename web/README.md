# PaperQueue — Web edition

The third way to run PaperQueue: a **self-hosted web app**. Same product as the
iOS/macOS apps — the reading queue, library, collections, history, stats and
**live sync** — but it runs in your browser, so it's roomy and works on any
device on your network.

> **One service, one port.** No IP wrangling, no extra moving parts. The Zotero
> key lives only on the server (set it via `.env` or docker-compose); the
> browser only ever talks to this server. State is stored in Zotero **tags**, so
> a queue you build here shows up on your phone and Mac too.

<p align="center"><code>http://localhost:5954</code></p>

## Run it

### Docker — server (from Docker Hub, recommended)

`docker-compose.yml` pulls the prebuilt image `drakonis96/paperqueue`:

```bash
cd web
echo "ZOTERO_API_KEY=your_key_here" > .env   # or leave blank for the demo
docker compose up -d
# → open http://localhost:5954
# update later with:  docker compose pull && docker compose up -d
```

### Docker — local build

`docker-compose.local.yml` builds the image from this source instead:

```bash
cd web
docker compose -f docker-compose.local.yml up -d --build
# → open http://localhost:5954
```

Both map `5954:5954` and read `ZOTERO_API_KEY` from your shell or `.env`. That's
the whole configuration.

### Node (no Docker)

```bash
cd web
npm install
ZOTERO_API_KEY=your_key_here npm start
# → open http://localhost:5954
```

### Try it with no key

Leave `ZOTERO_API_KEY` unset and PaperQueue boots with a **built-in demo
library** so you can explore every screen — queue, reorder, mark read, stats —
before connecting your own Zotero.

## Get a Zotero API key

1. Open <https://www.zotero.org/settings/keys/new>.
2. Create a key with library **read & write** access.
3. Put it in `.env` (or the compose `environment:`) and restart.

Your queue/read state syncs through Zotero's own tags, so this web app, the
iPhone/iPad app and the Mac app all stay in lock-step.

## Configuration

| Variable          | Default                   | What it does                                            |
| ----------------- | ------------------------- | ------------------------------------------------------- |
| `ZOTERO_API_KEY`  | *(demo mode)*             | Your Zotero Web API key. The only thing usually needed. |
| `PORT`            | `5954`                    | Port the single service listens on.                     |
| `ZOTERO_LIBRARY`  | *(your user library)*     | Read a group library instead, e.g. `groups/123456`.     |
| `ZOTERO_USER_ID`  | *(resolved from the key)* | Override the user id (rarely needed).                   |
| `ZOTERO_API_BASE` | `https://api.zotero.org`  | Override the Zotero API endpoint (proxies).             |
| `DEMO_MODE`       | `0`                       | Force the demo library even with a key set.             |

## Features (parity with the apps)

- **Reading queue(s)** — curated lists; mark read, skip, remove,
  drag-to-reorder, jump-to-position. Create and switch between multiple named
  queues.
- **Postponed list** — a built-in list (alongside Default) where postponed
  papers wait until you put them back in a reading queue.
- **Library** — your whole bibliography with search, sorting and rich filters
  (status, collection, author, tag, year). Queued papers show a green check.
- **Collections** — browse collections and subcollections, add to the queue.
- **History** — everything you've read, with real read dates; send papers back.
- **Stats** — daily goal ring, reading streaks, a month-grid calendar (with
  month navigation and today highlighted), and per-week papers and pages charts.
- **Add by DOI** — fetches metadata from Crossref and adds it to Zotero.
- **Live sync** — the server keeps a WebSocket to Zotero and pushes changes to
  the browser over Server-Sent Events, so edits from any device appear within a
  second.

## How state is stored (Zotero tags)

| Tag                    | Meaning                                  |
| ---------------------- | ---------------------------------------- |
| `pq:queue`             | The paper is in a reading queue          |
| `pq:qname:<name>`      | Which named queue (absent ⇒ Default)     |
| `pq:pos:<n>`           | Position in the queue (gapped)           |
| `pq:read:<YYYY-MM-DD>` | Read, with the real read date            |
| `pq:skip`              | Skipped                                  |

These are easy to find and remove in Zotero if you ever stop using PaperQueue.

## Architecture

```
web/
├── src/
│   ├── server.js     # single Express service: static UI + REST + SSE
│   ├── config.js     # env config (.env / compose)
│   ├── zotero.js     # Zotero Web API v3 client (incremental sync, tag writes)
│   ├── stream.js     # Zotero WebSocket → live "changed" events
│   ├── crossref.js   # DOI → Zotero item
│   └── demo.js       # in-memory sample library (no-key demo mode)
├── public/           # the browser app (vanilla JS, no build step)
│   ├── index.html
│   ├── styles.css
│   └── js/{app,store,stats,api}.js
├── Dockerfile
├── docker-compose.yml         # server: pulls drakonis96/paperqueue from Docker Hub
└── docker-compose.local.yml   # local: builds the image from source
```

The browser holds the working model and all the product logic (mirroring the
app's `QueueStore`/`StatsService`); the server is a thin, key-holding proxy.

## License

MIT — see the repository [LICENSE](../LICENSE).
