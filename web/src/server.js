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
};

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

  // Live updates: one server-side WebSocket to Zotero, fanned out to browsers.
  state.stream = new ZoteroStream({
    apiKey: config.zoteroApiKey,
    userId: info.userID,
    url: config.zoteroStreamURL,
  });
  state.stream.on("changed", (version) => broadcastChanged(version));
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
app.use(express.json({ limit: "256kb" }));

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
  });
});

app.get("/api/library", async (req, res) => {
  if (!requireClient(res)) return;
  try {
    const since = req.query.since != null ? Number(req.query.since) : null;
    const result = await state.client.librarySync(since);
    let deleted = [];
    if (since != null && !result.notModified && !state.demo) {
      deleted = await state.client.deletedItemKeys(since).catch(() => []);
    }
    res.json({ ...result, deleted });
  } catch (err) {
    handleError(res, err);
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
