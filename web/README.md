# PaperQueue — Web edition

The third way to run PaperQueue: a **self-hosted web app**. Same product as the
iOS/macOS apps — the reading queue, library, collections, history, stats and
**live sync** — but it runs in your browser, so it's roomy and works on any
device on your network.

> Set the Zotero key via `.env` or docker-compose; the browser only ever talks
> to this server. State is stored in Zotero **tags**, so a queue you build here
> shows up on your phone and Mac too.

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
| `PORT`            | `5954`                    | Port the server listens on.                             |
| `ZOTERO_LIBRARY`  | *(your user library)*     | Read a group library instead, e.g. `groups/123456`.     |
| `ZOTERO_USER_ID`  | *(resolved from the key)* | Override the user id (rarely needed).                   |
| `ZOTERO_API_BASE` | `https://api.zotero.org`  | Override the Zotero API endpoint (proxies).             |
| `DEMO_MODE`       | `0`                       | Force the demo library even with a key set.             |
| `DATA_DIR`        | `/data` (Docker)          | Where user settings are persisted. Mount a volume here. |
| `AUTH_ENABLED`    | `0` *(off)*               | Require a login (see [Optional login](#optional-login)).|
| `PQ_SECURITY_HEADERS` | `1` *(on)*            | Hardening headers (CSP, nosniff, anti-clickjacking). `0` to disable. |
| `PQ_FRAME_ANCESTORS`  | `'none'`             | Who may embed the app in an `<iframe>` (see [Security headers](#security-headers)). |

### Settings persistence (`/data`)

User settings — daily goal, custom queues, tags-on-read and AI favourites — are
**not** Zotero tags, so they're saved on the server (in `DATA_DIR/settings.json`)
and shared across every browser/device that uses this instance. The compose
files mount a named volume `paperqueue-data` at `/data` so they survive restarts
and image updates. Queue/read **state** still lives in Zotero tags as before.

### Optional login

By default PaperQueue requires **no credentials** — there are **no default
username or password configured**, and the app opens straight to your library.
If you expose the instance beyond a trusted network you can switch on a simple
shared login:

```bash
AUTH_ENABLED=1
AUTH_USERNAME=admin        # default if unset
AUTH_PASSWORD=paperqueue   # default if unset — change it!
```

When enabled the server gates the data API behind a session cookie and shows a
sign-in screen; a **Sign out** action appears in **Settings → Account**. The
built-in fallback credentials are `admin` / `paperqueue` — they only apply once
you turn auth on, and you should override them. Login attempts are **rate-limited
per IP** to blunt brute-force guessing.

| Variable               | Default       | What it does                                              |
| ---------------------- | ------------- | -------------------------------------------------------- |
| `AUTH_ENABLED`         | `0`           | `1` to require a login. Off ⇒ no credentials asked.      |
| `AUTH_USERNAME`        | `admin`       | The login username (used only when auth is on).          |
| `AUTH_PASSWORD`        | `paperqueue`  | The login password (used only when auth is on).          |
| `AUTH_MAX_ATTEMPTS`    | `5`           | Failed tries from one IP before it's locked out.         |
| `AUTH_WINDOW_MINUTES`  | `15`          | Window the failures are counted within.                  |
| `AUTH_BLOCK_MINUTES`   | `15`          | How long an IP stays locked out.                         |
| `AUTH_SESSION_HOURS`   | `720`         | How long a session (cookie) stays valid (30 days).       |
| `AUTH_COOKIE_SECURE`   | `0`           | Send the cookie only over HTTPS — set when behind TLS.   |

> This is *basic* shared-password protection (one account, in-memory sessions),
> meant for keeping a self-hosted instance private — not a multi-user system. It
> doesn't replace putting the app behind your own reverse proxy / TLS.

### Security headers

Every response carries hardening headers by default: a strict same-origin
**Content-Security-Policy** (backs up the UI's HTML escaping), `X-Content-Type-Options:
nosniff`, `Referrer-Policy`, a locked-down `Permissions-Policy`, and
anti-clickjacking framing controls. Everything the browser needs is same-origin
(the AI keys stay on the server, so the browser never calls a provider directly),
so the default policy needs no exceptions.

- `PQ_SECURITY_HEADERS=0` turns them off — only if a reverse proxy in front
  already sets equivalent headers.
- `PQ_FRAME_ANCESTORS` controls who may embed PaperQueue in an `<iframe>`. The
  default `'none'` blocks all framing. To pin it inside a self-hosted dashboard
  (Heimdall, Organizr, Homepage…), set it to `'self'` or a space-separated list
  of origins, e.g. `PQ_FRAME_ANCESTORS='https://dash.example.com'`.

### Install it as an app (PWA)

The web edition is an installable **Progressive Web App**. Open it in a browser
and use **Install** (desktop Chrome/Edge address bar) or **Add to Home Screen**
(iOS Safari / Android Chrome) to get a standalone, fullscreen icon — ideal for
reading on a phone or tablet. The app shell is cached so it launches instantly
and opens offline; your queue and library always load fresh from Zotero (the
service worker never caches API data). Installability needs a **secure origin**
(HTTPS, or `localhost` for testing).

### AI assistant (optional)

Set a key for any provider to switch on the in-app **AI assistant** (the floating
chat). Like the Zotero key, these live **only on the server** — they're never sent
to the browser and never logged.

| Variable             | What it does                                                       |
| -------------------- | ----------------------------------------------------------------- |
| `OPENAI_API_KEY`     | Enables OpenAI.                                                    |
| `OPENROUTER_API_KEY` | Enables OpenRouter (300+ models through one key).                 |
| `DEEPSEEK_API_KEY`   | Enables DeepSeek.                                                  |
| `GEMINI_API_KEY`     | Enables Google Gemini ([AI Studio key](https://aistudio.google.com/apikey); `GOOGLE_API_KEY` also works). |
| `AI_CUSTOM_NAME`     | Label for a custom OpenAI-compatible provider (e.g. `Ollama`).    |
| `AI_CUSTOM_BASE_URL` | Base URL for it, e.g. `http://localhost:11434/v1`.                |
| `AI_CUSTOM_API_KEY`  | Key for it (use any non-empty value for keyless local servers).  |

In **Settings → AI assistant** each configured provider can *Load models*; star the
ones you want and they appear in the model picker. From the **Queue** tab the
assistant can:

- **Study a topic** — type what you want to learn, pick one or more reference
  collections, and it suggests readings to go deeper on that topic (judging by the
  titles), ordered roughly foundational → advanced. Optional include/exclude tag
  filters narrow the candidates.
- **Suggest papers** from one or more collections to complement what's already
  queued — you say how many, it proposes (with a reason each), you tick which to add.
- **Reorder the queue** by topical/author/chronological affinity — from the
  **Order with AI** button.

Every AI change is **confirmed before it happens and can be undone**.

## Features (parity with the apps)

- **Reading queue(s)** — curated lists; mark read, skip, remove,
  drag-to-reorder, jump-to-position. Create and switch between multiple named
  queues with a scrollable tab strip. **Searching the queue keeps each paper's
  real position number** instead of renumbering the filtered results.
- **Touch-friendly drag & drop** — reorder the queue and move a paper to another
  queue (drop it on a queue tab) with the grip handle, on a mouse **or a
  touchscreen** (Pointer Events, with edge auto-scroll for long lists).
- **Postponed list** — a built-in list (alongside Default) where postponed
  papers wait until you put them back in a reading queue.
- **Library** — your whole bibliography with search, sorting and rich filters
  (status, collection, author, tag, year). Queued papers show a green check.
- **Collections** — browse collections and subcollections, add to the queue.
- **History** — everything you've read, with real read dates. Sending a paper
  back to its queue **restores its original position** rather than appending it.
- **Stats** — daily goal ring, reading streaks, a month-grid calendar (with
  month navigation, today highlighted and **over-goal days marked**), per-week
  papers and pages charts, and a **weekly comeback** indicator: when extra
  reading on a strong day makes up for an earlier day you fell short, it shows
  how much you've clawed back and whether you're back on track for the week.
- **Add by DOI** — fetches metadata from Crossref and adds it to Zotero.
- **Tags on read** — in **Settings → Tags on read**, choose Zotero tags to
  **add** and/or tags to **remove** automatically whenever you mark a paper read
  (removal only applies if the paper already has the tag). Use either or both.
- **Optional login** — off by default (no credentials); enable a simple
  rate-limited shared password to keep a self-hosted instance private. See
  [Optional login](#optional-login).
- **AI assistant** *(optional)* — suggests papers for your queue from context
  collections and reorders the queue by affinity, with OpenAI, OpenRouter,
  DeepSeek, Google Gemini or any OpenAI-compatible endpoint. Always confirmed,
  always undoable; provider keys stay on the server. See
  [Configuration → AI assistant](#ai-assistant-optional).
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
│   ├── ai.js         # OpenAI-compatible AI proxy (keys stay server-side)
│   ├── auth.js       # optional shared-password login + rate limiting
│   └── demo.js       # in-memory sample library (no-key demo mode)
├── public/           # the browser app (vanilla JS, no build step)
│   ├── index.html
│   ├── styles.css
│   └── js/{app,store,stats,api,ai}.js
├── Dockerfile
├── docker-compose.yml         # server: pulls drakonis96/paperqueue from Docker Hub
└── docker-compose.local.yml   # local: builds the image from source
```

The browser holds the working model and all the product logic (mirroring the
app's `QueueStore`/`StatsService`); the server is a thin, key-holding proxy.

## License

MIT — see the repository [LICENSE](../LICENSE).
