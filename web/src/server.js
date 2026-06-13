// PaperQueue — web edition. A single service on a single port that serves the
// browser app and proxies the Zotero Web API. The Zotero key lives only on the
// server (from .env or docker-compose), never in the browser.
//
// Same product as the iOS/macOS apps: the reading queue, library, collections,
// history, stats and live sync all run against the same `pq:` Zotero tags, so a
// queue you build here shows up on your phone and Mac too.

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config, isDemo } from "./config.js";
import { ZoteroClient } from "./zotero.js";
import { ZoteroStream } from "./stream.js";
import { DemoZoteroClient } from "./demo.js";
import { zoteroItemForDOI } from "./crossref.js";
import { aiConfig, aiEnabled, listModels, streamChat } from "./ai.js";
import { readSettings, writeSettings, readSnapshot, writeSnapshot } from "./storage.js";
import { checkForUpdate } from "./update.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

// MARK: - Backend resolution -------------------------------------------------

/** Active state: the Zotero (or demo) client + account info. */
const state = {
  client: null,
  demo: isDemo,
  username: null,
  userId: null,
  library: null,
  stream: null,
  // Server-side library snapshot ({ items, version }). Lets a freshly-opened
  // browser load the whole library instantly instead of each one triggering its
  // own full Zotero fetch. Kept warm by the live stream; persisted to DATA_DIR.
  snapshot: null,
};

// MARK: - Server-side library snapshot ---------------------------------------

let refreshChain = Promise.resolve();
let snapshotDirty = false;
let snapshotWriteTimer = null;

/** Throttled, atomic persistence of the snapshot (it can be several MB). */
function persistSnapshot() {
  snapshotDirty = true;
  if (snapshotWriteTimer) return;
  snapshotWriteTimer = setTimeout(() => {
    snapshotWriteTimer = null;
    if (!snapshotDirty || !state.snapshot) return;
    snapshotDirty = false;
    try {
      writeSnapshot(state.snapshot);
    } catch {
      /* non-fatal — the in-memory snapshot still serves */
    }
  }, 30_000);
}

/**
 * Refreshes the cached snapshot from Zotero. A full pass replaces it; an
 * incremental pass upserts changed items and drops deleted ones. Serialised
 * through `refreshChain` so concurrent triggers don't overlap. Demo mode is
 * always served live, so it never caches here.
 */
function refreshSnapshot({ full = false } = {}) {
  if (!state.client || state.demo) return refreshChain;
  refreshChain = refreshChain
    .then(async () => {
      const since = full || !state.snapshot ? null : state.snapshot.version;
      const result = await state.client.librarySync(since);
      if (result.notModified) return;
      if (since == null) {
        state.snapshot = { items: result.items, version: result.version };
      } else {
        const deleted = await state.client.deletedItemKeys(since).catch(() => []);
        const byKey = new Map(state.snapshot.items.map((i) => [i.data.key, i]));
        for (const it of result.items) byKey.set(it.data.key, it);
        for (const k of deleted) byKey.delete(k);
        state.snapshot = {
          items: [...byKey.values()],
          version: result.version ?? state.snapshot.version,
        };
      }
      persistSnapshot();
    })
    .catch(() => {
      /* leave the previous snapshot in place on error */
    });
  return refreshChain;
}

/** Folds a live `/api/library` read back into the cache so manual syncs and
 *  incremental polls keep the snapshot current without a second fetch. */
function applyToSnapshot(result, since, deleted) {
  if (state.demo || result.notModified) return;
  if (since == null) {
    state.snapshot = { items: result.items, version: result.version };
  } else if (state.snapshot) {
    const byKey = new Map(state.snapshot.items.map((i) => [i.data.key, i]));
    for (const it of result.items) byKey.set(it.data.key, it);
    for (const k of deleted || []) byKey.delete(k);
    state.snapshot = {
      items: [...byKey.values()],
      version: result.version ?? state.snapshot.version,
    };
  } else {
    refreshSnapshot({ full: true }); // no base yet — build one in the background
    return;
  }
  persistSnapshot();
}

async function initBackend() {
  if (isDemo) {
    const demo = new DemoZoteroClient();
    demo.onChange = (version) => broadcastChanged(version);
    state.client = demo;
    state.demo = true;
    state.username = "Demo library";
    console.log(
      "▶ PaperQueue running in DEMO mode (no Zotero key). Set ZOTERO_API_KEY to use your real library."
    );
    return;
  }

  // Real mode: validate the key, resolve the user id, open the live stream.
  let info;
  try {
    info = await ZoteroClient.verifyKey(config.zoteroApiKey, config.zoteroApiBase);
  } catch (err) {
    console.error(
      "✖ Zotero key check failed:",
      err.message,
      "\n  Fix ZOTERO_API_KEY and restart."
    );
    // Boot anyway so the UI can show a clear setup screen.
    state.client = null;
    state.demo = false;
    return;
  }
  if (!info.canRead) {
    console.error(
      "✖ This Zotero key has no library read access. Create one with read & write."
    );
    state.client = null;
    return;
  }

  const library =
    config.zoteroLibrary ||
    (config.zoteroUserId
      ? `users/${config.zoteroUserId}`
      : `users/${info.userID}`);

  state.client = new ZoteroClient({
    apiKey: config.zoteroApiKey,
    library,
    apiBase: config.zoteroApiBase,
  });
  state.demo = false;
  state.username = info.username;
  state.userId = info.userID;
  state.library = library;
  state.canWrite = info.canWrite;

  // Warm the snapshot: serve the persisted one instantly (if any), then refresh
  // from Zotero in the background so the first browser load is fast and current.
  state.snapshot = readSnapshot();
  refreshSnapshot({ full: !state.snapshot });

  // Live updates: one server-side WebSocket to Zotero, fanned out to browsers.
  // On every change we refresh the cached snapshot, then notify browsers.
  state.stream = new ZoteroStream({
    apiKey: config.zoteroApiKey,
    userId: info.userID,
    url: config.zoteroStreamURL,
  });
  state.stream.on("changed", (version) => {
    refreshSnapshot().finally(() => broadcastChanged(version));
  });
  state.stream.start();

  console.log(
    `▶ PaperQueue connected to Zotero as ${info.username || "user " + info.userID} (${library}).`
  );
}

// MARK: - Live updates (Server-Sent Events) ----------------------------------

const sseClients = new Set();

function broadcastChanged(version) {
  const payload = `event: changed\ndata: ${JSON.stringify({ version })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      /* dropped clients are cleaned up on close */
    }
  }
}

// MARK: - App ----------------------------------------------------------------

const app = express();
// AI chat messages carry collection titles / queue lists, so allow a larger body.
app.use(express.json({ limit: "1mb" }));

function requireClient(res) {
  if (!state.client) {
    res
      .status(503)
      .json({ error: "Zotero is not configured. Set ZOTERO_API_KEY and restart." });
    return false;
  }
  return true;
}

function handleError(res, err) {
  const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
  res.status(status).json({ error: err?.message || "Something went wrong." });
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", demo: state.demo, connected: !!state.client });
});

app.get("/api/config", (_req, res) => {
  res.json({
    connected: !!state.client,
    demo: state.demo,
    username: state.username,
    userId: state.userId,
    library: state.library,
    canWrite: state.demo ? true : state.canWrite ?? false,
    version: config.version,
    ai: aiEnabled(),
  });
});

app.get("/api/library", async (req, res) => {
  if (!requireClient(res)) return;
  try {
    const since = req.query.since != null ? Number(req.query.since) : null;
    // The manual Sync button sends force=1 to always pull fresh from Zotero
    // (and refresh the cache). Everything else is served from the snapshot when
    // possible, so freshly-opened browsers don't each trigger a full fetch.
    const force = req.query.force === "1" || req.query.force === "true";

    if (!state.demo && !force && state.snapshot) {
      if (since != null && Number(since) === state.snapshot.version) {
        return res.json({ items: [], version: state.snapshot.version, notModified: true, deleted: [] });
      }
      if (since == null) {
        return res.json({
          items: state.snapshot.items,
          version: state.snapshot.version,
          notModified: false,
          deleted: [],
        });
      }
    }

    const result = await state.client.librarySync(since);
    let deleted = [];
    if (since != null && !result.notModified && !state.demo) {
      deleted = await state.client.deletedItemKeys(since).catch(() => []);
    }
    // Keep the cache in step with any live read (force or incremental).
    applyToSnapshot(result, since, deleted);
    res.json({ ...result, deleted });
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/update", async (_req, res) => {
  try {
    res.json(await checkForUpdate());
  } catch {
    res.json({ current: config.version, latest: config.version, updateAvailable: false, url: null });
  }
});

app.get("/api/collections", async (_req, res) => {
  if (!requireClient(res)) return;
  try {
    res.json(await state.client.allCollections());
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/collections/top", async (_req, res) => {
  if (!requireClient(res)) return;
  try {
    res.json(await state.client.topCollections());
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/collections/:key", async (req, res) => {
  if (!requireClient(res)) return;
  try {
    const [subcollections, items] = await Promise.all([
      state.client.subcollections(req.params.key),
      state.client.collectionItems(req.params.key),
    ]);
    res.json({ subcollections, items });
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/items/:key/tags", async (req, res) => {
  if (!requireClient(res)) return;
  const tags = req.body?.tags;
  if (!Array.isArray(tags)) {
    return res.status(400).json({ error: "Body must be { tags: string[] }." });
  }
  try {
    await state.client.setTags(req.params.key, tags);
    if (!state.demo) broadcastChanged(Date.now()); // nudge other tabs to resync
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/doi", async (req, res) => {
  if (!requireClient(res)) return;
  try {
    const item = await zoteroItemForDOI(req.body?.doi);
    await state.client.createItems([item]);
    if (!state.demo) broadcastChanged(Date.now());
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

// MARK: - AI assistant -------------------------------------------------------
// Provider API keys never leave the server: these routes read them from env and
// only ever return models / streamed completions, never the keys themselves.

app.get("/api/ai/config", (_req, res) => {
  res.json({ providers: aiConfig() });
});

app.get("/api/ai/models", async (req, res) => {
  try {
    const models = await listModels(String(req.query.provider || ""));
    res.json({ models });
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/ai/chat", async (req, res) => {
  const { provider, ...body } = req.body || {};
  // Abort the upstream provider request if the browser disconnects or hits Stop.
  // Listen on the *response* close (client disconnect / stream end), not the
  // request — the request stream closes as soon as its body is read, which would
  // abort the upstream call before it even starts.
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  try {
    await streamChat(String(provider || ""), body, res, controller.signal);
  } catch (err) {
    if (!res.headersSent) handleError(res, err);
    else {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  }
});

// MARK: - User settings (server-side persistence) ----------------------------
// Settings aren't Zotero tags, so they're stored on the server (DATA_DIR) and
// shared across every browser/device that talks to this instance.

app.get("/api/settings", (_req, res) => {
  res.json(readSettings());
});

app.put("/api/settings", (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "Body must be a settings object." });
  }
  try {
    writeSettings(body);
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 5000\n\n");
  res.write(": connected\n\n");
  sseClients.add(res);

  const keepAlive = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* ignore */
    }
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// Static frontend (and SPA fallback for any non-API route).
app.use(express.static(PUBLIC_DIR));
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// MARK: - Boot ---------------------------------------------------------------

initBackend().finally(() => {
  app.listen(config.port, () => {
    console.log(`  Listening on http://localhost:${config.port}`);
  });
});
