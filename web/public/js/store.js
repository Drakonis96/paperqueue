// Client-side model + state, mirroring the native app's QueueStore / AppConfig.
//
// Source of truth for queue state is a set of namespaced Zotero tags
// (pq:queue, pq:qname:<name>, pq:pos:<n>, pq:read:<date>, pq:skip), so a queue
// you build here syncs to your phone and Mac through Zotero itself. The server
// is a thin proxy that holds the Zotero key and forwards reads/writes; all the
// product logic lives right here in the browser.

import { api } from "./api.js";

export const Tags = {
  queue: "pq:queue",
  read: "pq:read",
  skip: "pq:skip",
  posPrefix: "pq:pos:",
  qnamePrefix: "pq:qname:",
  posGap: 1024,
};

const DEFAULT_QUEUE = "Default";
// A built-in list that always exists alongside Default. "Postpone" moves a
// paper here (via a pq:qname:Postponed tag) until the user puts it back in a
// reading queue. Stored in Zotero like any named queue, so it syncs everywhere.
const POSTPONED_QUEUE = "Postponed";
const LS_KEY = "paperqueue.web.v1";

export { DEFAULT_QUEUE, POSTPONED_QUEUE };

// MARK: - Helpers ------------------------------------------------------------

function uniq(arr) {
  const seen = new Set();
  return arr.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
}

// Fresh user settings. These are NOT Zotero tags, so the SERVER (DATA_DIR/
// settings.json) is their source of truth and they sync across every browser —
// including a brand-new incognito window — without relying on localStorage.
function defaultSettings() {
  return {
    customQueues: [],
    activeQueue: DEFAULT_QUEUE,
    dailyGoal: 1,
    readExtraTags: [],
    // AI assistant: favourite provider/model pairs the user picks in Settings,
    // and the default selection. Keys never live here — only ids.
    aiFavorites: [], // [{ provider, model }]
    aiDefault: null, // { provider, model } | null
  };
}

/** True when `s` is indistinguishable from a fresh install — used so an empty
 *  browser (e.g. incognito) never seeds the server with defaults and clobbers
 *  real settings saved from another device. */
function isDefaultSettings(s) {
  return JSON.stringify(s) === JSON.stringify(defaultSettings());
}

function todayTag() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function creatorName(c) {
  if (c.name) return c.name;
  if (c.lastName && c.firstName) return `${c.lastName}, ${c.firstName}`;
  return c.lastName || c.firstName || "";
}

/** Splits Zotero creators into authors and editors (mirrors QueueStore). */
function splitCreators(creators) {
  const authors = [];
  const editors = [];
  const others = [];
  for (const c of creators || []) {
    const name = creatorName(c);
    if (!name) continue;
    const type = (c.creatorType || "").toLowerCase();
    if (type.includes("editor")) editors.push(name);
    else if (
      [
        "author", "bookauthor", "contributor", "presenter", "podcaster",
        "interviewee", "director", "inventor", "cartographer", "programmer",
      ].includes(type)
    )
      authors.push(name);
    else others.push(name);
  }
  return { authors: authors.length ? authors : others, editors };
}

function pageCount(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d+)\s*[-–—]\s*(\d+)/);
  if (!m) return null;
  const startStr = m[1];
  let endStr = m[2];
  if (endStr.length < startStr.length) {
    endStr = startStr.slice(0, startStr.length - endStr.length) + endStr;
  }
  const start = Number(startStr);
  const end = Number(endStr);
  if (!(end > start)) return null;
  return end - start;
}

function yearOf(dateString) {
  if (!dateString) return null;
  const m = String(dateString).match(/\d{4}/);
  return m ? m[0] : dateString;
}

function shortNames(names) {
  if (names.length <= 2) return names.join(", ");
  return `${names[0]} et al.`;
}

export function authorLine(p) {
  if (p.authors.length) {
    let line = shortNames(p.authors);
    if (p.editors.length) line += ` · ed. ${shortNames(p.editors)}`;
    return line;
  }
  if (p.editors.length) {
    const label = p.editors.length > 1 ? "eds." : "ed.";
    return `${shortNames(p.editors)} (${label})`;
  }
  return "Unknown author";
}

export function subtitle(p) {
  return [p.publicationTitle, p.year].filter(Boolean).join(" · ");
}

// MARK: - Tag parsing --------------------------------------------------------

function isReadTag(tags) {
  return tags.some((t) => t === Tags.read || t.startsWith(Tags.read + ":"));
}
function parseReadDate(tags) {
  for (const t of tags) {
    if (t.startsWith(Tags.read + ":")) {
      const d = t.slice(Tags.read.length + 1);
      const parsed = new Date(d + "T00:00:00");
      return isNaN(parsed) ? null : parsed;
    }
  }
  return null;
}
function parsePos(tags) {
  for (const t of tags) {
    if (t.startsWith(Tags.posPrefix)) {
      const n = Number(t.slice(Tags.posPrefix.length));
      if (!isNaN(n)) return n;
    }
  }
  return null;
}
function parseQueueName(tags) {
  for (const t of tags) {
    if (t.startsWith(Tags.qnamePrefix)) {
      const name = t.slice(Tags.qnamePrefix.length);
      return name || null;
    }
  }
  return null;
}

// MARK: - Store --------------------------------------------------------------

export class Store {
  constructor() {
    this.papers = new Map(); // key → paper
    this.baselineVersion = null;
    this.config = { connected: false, demo: false, username: null };

    // User settings. The server (DATA_DIR/settings.json) is authoritative and
    // shared across devices; localStorage is only a cache. See loadSettings().
    this.settings = defaultSettings();

    this.pendingWrites = new Set(); // keys with an in-flight tag write
    this.listeners = new Set();
    this.isSyncing = false;
    this.syncProgress = null;
    this.lastError = null;

    // Server-side settings persistence (shared across devices). Gated until
    // loadSettings() has reconciled with the server, so early reconciles don't
    // push stale local settings over what another device saved.
    this._settingsReady = false;
    this._lastPersistedSettings = null;
    this._persistTimer = null;

    this._loadCache();
  }

  // -- Subscription ----------------------------------------------------------

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  notify() {
    for (const fn of this.listeners) fn();
  }

  // -- Persistence -----------------------------------------------------------

  _loadCache() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      this.settings = { ...this.settings, ...(data.settings || {}) };
      this.baselineVersion = data.baselineVersion ?? null;
      for (const p of data.papers || []) this.papers.set(p.key, p);
    } catch {
      /* corrupt cache — start fresh */
    }
  }

  _saveCache() {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          baselineVersion: this.baselineVersion,
          settings: this.settings,
          papers: [...this.papers.values()],
        })
      );
    } catch {
      /* quota — ignore */
    }
    this._maybePersistSettings();
  }

  // -- Server-side settings (shared across devices) --------------------------

  /**
   * Reconciles settings with the server on boot. The server (DATA_DIR) is the
   * source of truth: if it has settings we adopt them; if it's empty we seed it
   * from whatever this browser had locally. Falls back to local settings if the
   * server can't be reached.
   */
  async loadSettings() {
    try {
      const server = await api.settings();
      if (server && Object.keys(server).length) {
        // Server is the source of truth: adopt it (a fresh incognito window gets
        // the daily goal, queues, AI favourites… without any localStorage).
        this.settings = { ...defaultSettings(), ...server };
        this._saveCache(); // mirror into localStorage (persist still gated off)
      } else if (!isDefaultSettings(this.settings)) {
        // Server has nothing yet, but THIS browser holds real (non-default)
        // settings — seed the server from them. We deliberately do NOT seed from
        // a default/empty browser, so opening incognito can never overwrite the
        // settings another device already saved.
        await api.saveSettings(this.settings).catch(() => {});
      }
    } catch {
      /* server unavailable — keep local settings */
    }
    this._lastPersistedSettings = JSON.stringify(this.settings);
    this._settingsReady = true;
    this.notify();
  }

  /** Debounced push of settings to the server, only when they actually change. */
  _maybePersistSettings() {
    if (!this._settingsReady) return;
    const json = JSON.stringify(this.settings);
    if (json === this._lastPersistedSettings) return;
    this._lastPersistedSettings = json;
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(
      () => api.saveSettings(this.settings).catch(() => {}),
      600
    );
  }

  /** Flushes any pending settings write immediately (e.g. on tab hide/close so a
   *  quick edit isn't lost to the debounce). Uses a keepalive request so it still
   *  lands while the page is unloading. Safe to call any time. */
  flushSettings() {
    if (!this._settingsReady) return;
    const json = JSON.stringify(this.settings);
    if (json === this._lastPersistedSettings) return; // nothing new to push
    clearTimeout(this._persistTimer);
    this._lastPersistedSettings = json;
    try {
      fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: json,
        keepalive: true,
      });
    } catch {
      /* best effort */
    }
  }

  // -- Queues ----------------------------------------------------------------

  get availableQueues() {
    const custom = this.settings.customQueues.filter(
      (q) => q !== DEFAULT_QUEUE && q !== POSTPONED_QUEUE
    );
    return [DEFAULT_QUEUE, POSTPONED_QUEUE, ...custom];
  }
  get activeQueue() {
    const a = this.settings.activeQueue;
    return this.availableQueues.includes(a) ? a : DEFAULT_QUEUE;
  }
  setActiveQueue(name) {
    if (!this.availableQueues.includes(name)) return;
    this.settings.activeQueue = name;
    this._saveCache();
    this.notify();
  }
  storedName(display) {
    return display === DEFAULT_QUEUE ? null : display;
  }
  createQueue(rawName) {
    const name = (rawName || "").trim();
    if (
      !name ||
      this.availableQueues.some((q) => q.toLowerCase() === name.toLowerCase())
    )
      return false;
    this.settings.customQueues = uniq([...this.settings.customQueues, name]);
    this.settings.activeQueue = name;
    this._saveCache();
    this.notify();
    return true;
  }
  deleteQueue(name) {
    if (name === DEFAULT_QUEUE || name === POSTPONED_QUEUE) return;
    const stored = this.storedName(name);
    for (const p of this.papers.values()) {
      if (p.isPending && p.queueName === stored) this.addToQueue(p, DEFAULT_QUEUE);
    }
    this.settings.customQueues = this.settings.customQueues.filter(
      (q) => q !== name
    );
    if (this.settings.activeQueue === name)
      this.settings.activeQueue = DEFAULT_QUEUE;
    this._saveCache();
    this.notify();
  }
  _registerQueues(names) {
    const fresh = uniq(names).filter((n) => !this.availableQueues.includes(n));
    if (!fresh.length) return;
    this.settings.customQueues = uniq([...this.settings.customQueues, ...fresh]);
  }

  // -- Building papers from Zotero data --------------------------------------

  _makePaper(data) {
    const tags = (data.tags || []).map((t) => t.tag);
    const { authors, editors } = splitCreators(data.creators);
    const selfPdf =
      data.itemType === "attachment" && data.contentType === "application/pdf"
        ? data.key
        : null;
    return {
      key: data.key,
      version: data.version,
      itemType: data.itemType,
      title: data.title || "(untitled)",
      authors,
      editors,
      publicationTitle: data.publicationTitle || null,
      dateString: data.date || null,
      year: yearOf(data.date),
      doi: data.doi || data.DOI || null,
      url: data.url || null,
      pages: data.pages || null,
      pageCount: pageCount(data.pages),
      tags,
      collectionKeys: data.collections || [],
      addedAt: data.dateAdded || null,
      pdfAttachmentKey: selfPdf,
      // derived state (filled by _deriveState)
      readStatus: "unread",
      queueStatus: null,
      queueName: null,
      readDate: null,
      sortPriority: Infinity,
      isPending: false,
    };
  }

  _deriveState(paper) {
    const tags = paper.tags;
    const read = isReadTag(tags);
    const skipped = tags.includes(Tags.skip);
    const queued = tags.includes(Tags.queue);
    paper.readStatus = read ? "read" : skipped ? "skipped" : "unread";
    paper.readDate = read ? parseReadDate(tags) : null;
    paper.sortPriority = parsePos(tags) ?? Infinity;

    if (read) {
      paper.queueStatus = "read";
      paper.queueName = null;
      paper.isPending = false;
    } else if (skipped) {
      paper.queueStatus = "skipped";
      paper.queueName = null;
      paper.isPending = false;
    } else if (queued) {
      paper.queueName = parseQueueName(tags);
      paper.queueStatus = "pending";
      paper.isPending = true;
    } else {
      paper.queueStatus = null;
      paper.queueName = null;
      paper.isPending = false;
    }
  }

  reconcile(items, { replaceAll = true, deletedKeys = [] } = {}) {
    const tops = items.filter((i) => !i.data.parentItem);
    const incomingKeys = new Set(tops.map((i) => i.data.key));
    const discovered = [];

    for (const item of tops) {
      const data = item.data;
      const fresh = this._makePaper(data);
      const existing = this.papers.get(data.key);
      // Keep a lazily-resolved PDF key if we already had one.
      if (existing?.pdfAttachmentKey && !fresh.pdfAttachmentKey) {
        fresh.pdfAttachmentKey = existing.pdfAttachmentKey;
      }
      this.papers.set(data.key, fresh);

      // Items with an in-flight write keep their optimistic state this pass.
      if (this.pendingWrites.has(data.key) && existing) {
        fresh.readStatus = existing.readStatus;
        fresh.queueStatus = existing.queueStatus;
        fresh.queueName = existing.queueName;
        fresh.readDate = existing.readDate;
        fresh.sortPriority = existing.sortPriority;
        fresh.isPending = existing.isPending;
        fresh.tags = existing.tags;
        continue;
      }
      this._deriveState(fresh);
      if (fresh.isPending && fresh.queueName) discovered.push(fresh.queueName);
    }

    if (replaceAll) {
      for (const key of [...this.papers.keys()]) {
        if (!incomingKeys.has(key)) this.papers.delete(key);
      }
    } else {
      for (const key of deletedKeys) this.papers.delete(key);
    }

    this._registerQueues(discovered);
    this._saveCache();
  }

  // -- Sync ------------------------------------------------------------------

  async loadConfig() {
    this.config = await api.config();
    return this.config;
  }

  async syncLibrary({ silent = false, force = false } = {}) {
    if (!this.config.connected) return;
    if (!silent) {
      this.isSyncing = true;
      this.syncProgress = 0;
      this.lastError = null;
      this.notify();
    }
    try {
      const since = this.baselineVersion;
      const result = await api.library(since, force);
      if (result.notModified) {
        // Nothing changed remotely — nothing to do.
      } else if (since != null) {
        this.reconcile(result.items, {
          replaceAll: false,
          deletedKeys: result.deleted || [],
        });
        this.baselineVersion = result.version ?? this.baselineVersion;
      } else {
        this.reconcile(result.items, { replaceAll: true });
        this.baselineVersion = result.version ?? this.baselineVersion;
      }
      this._saveCache();
    } catch (err) {
      // A failed incremental read: drop the baseline and try a clean full sync.
      if (this.baselineVersion != null) {
        this.baselineVersion = null;
        try {
          const result = await api.library(null);
          this.reconcile(result.items, { replaceAll: true });
          this.baselineVersion = result.version ?? null;
          this._saveCache();
          this.lastError = null;
          return;
        } catch {
          /* fall through to error */
        }
      }
      this.lastError = err.message || "Sync failed.";
    } finally {
      if (!silent) {
        this.isSyncing = false;
        this.syncProgress = null;
      }
      this.notify();
    }
  }

  // -- Mutations -------------------------------------------------------------

  desiredTags(base, { queued, read, skipped, pos, queueName }) {
    let tags = base.filter((t) => !t.startsWith("pq:"));
    if (queued) {
      tags.push(Tags.queue);
      if (pos != null) tags.push(Tags.posPrefix + String(Math.trunc(pos)));
      if (queueName) tags.push(Tags.qnamePrefix + queueName);
    }
    if (read) {
      tags.push(Tags.read + ":" + todayTag());
      tags.push(...this.settings.readExtraTags);
    }
    if (skipped) tags.push(Tags.skip);
    return uniq(tags);
  }

  _nextPosition(stored) {
    let max = 0;
    for (const p of this.papers.values()) {
      if (p.isPending && p.queueName === stored && p.sortPriority < Infinity) {
        max = Math.max(max, p.sortPriority);
      }
    }
    return max + Tags.posGap;
  }

  async _applyState(paper, { queued, read, skipped, pos, queueName }) {
    const tags = this.desiredTags(paper.tags, {
      queued, read, skipped, pos, queueName,
    });
    paper.tags = tags;
    this._saveCache();
    this.notify();
    await this._writeTags(paper.key, tags);
  }

  async _writeTags(key, tags) {
    this.pendingWrites.add(key);
    try {
      await api.setTags(key, tags);
    } catch (err) {
      this.lastError = err.message || "Couldn't save to Zotero.";
      this.notify();
      // Reconcile against the truth so the UI doesn't lie.
      this.syncLibrary({ silent: true });
    } finally {
      // Hold the guard briefly so a live-sync echo doesn't clobber the write
      // before Zotero has propagated it.
      setTimeout(() => this.pendingWrites.delete(key), 1500);
    }
  }

  addToQueue(paper, queue = DEFAULT_QUEUE) {
    const stored = this.storedName(queue);
    const pos = this._nextPosition(stored);
    paper.readStatus = "unread";
    paper.queueStatus = "pending";
    paper.queueName = stored;
    paper.readDate = null;
    paper.isPending = true;
    paper.sortPriority = pos;
    this._applyState(paper, {
      queued: true, read: false, skipped: false, pos, queueName: stored,
    });
  }
  moveToQueue(paper, queue) {
    this.addToQueue(paper, queue);
  }
  markRead(paper) {
    paper.readStatus = "read";
    paper.queueStatus = "read";
    paper.queueName = null;
    paper.readDate = new Date();
    paper.isPending = false;
    this._applyState(paper, {
      queued: false, read: true, skipped: false, pos: null, queueName: null,
    });
  }
  skip(paper) {
    paper.readStatus = "skipped";
    paper.queueStatus = "skipped";
    paper.queueName = null;
    paper.readDate = null;
    paper.isPending = false;
    this._applyState(paper, {
      queued: false, read: false, skipped: true, pos: null, queueName: null,
    });
  }
  reset(paper) {
    this.addToQueue(paper);
  }
  removeFromQueue(paper) {
    this._clear(paper);
  }
  removeFromHistory(paper) {
    this._clear(paper);
  }
  _clear(paper) {
    paper.readStatus = "unread";
    paper.queueStatus = null;
    paper.queueName = null;
    paper.readDate = null;
    paper.isPending = false;
    this._applyState(paper, {
      queued: false, read: false, skipped: false, pos: null, queueName: null,
    });
  }
  /** Moves the paper into the built-in "Postponed" list. It stays there (a real
   *  queued item, tagged pq:qname:Postponed) until the user returns it to a
   *  reading queue. Syncs across devices like any other queue. */
  postpone(paper) {
    this.addToQueue(paper, POSTPONED_QUEUE);
  }
  /** Returns a postponed paper to the Default reading queue. */
  returnToQueue(paper) {
    this.addToQueue(paper, DEFAULT_QUEUE);
  }

  /** Sets the full tag list for a paper and persists to Zotero. */
  async setTags(paper, tags) {
    const cleaned = uniq(tags.filter((t) => !t.startsWith("pq:")));
    // Preserve pq: tags from current state.
    const pqTags = paper.tags.filter((t) => t.startsWith("pq:"));
    paper.tags = [...pqTags, ...cleaned];
    this._saveCache();
    this.notify();
    await this._writeTags(paper.key, paper.tags);
  }

  /** Adds one or more tags to a paper (skipping pq: tags). */
  async addTags(paper, tags) {
    const existing = new Set(paper.tags.filter((t) => !t.startsWith("pq:")));
    for (const t of tags) existing.add(t);
    await this.setTags(paper, [...existing]);
  }

  /** Removes one or more tags from a paper (never touches pq: tags). */
  async removeTags(paper, tags) {
    const remove = new Set(tags);
    const kept = paper.tags.filter((t) => !t.startsWith("pq:") && !remove.has(t));
    await this.setTags(paper, kept);
  }

  /** Adds tags to multiple papers at once. */
  async bulkAddTags(papers, tags) {
    for (const p of papers) await this.addTags(p, tags);
  }

  /** Removes tags from multiple papers at once. */
  async bulkRemoveTags(papers, tags) {
    for (const p of papers) await this.removeTags(p, tags);
  }

  reorderPending(ordered) {
    const writes = [];
    ordered.forEach((paper, index) => {
      const newPos = (index + 1) * Tags.posGap;
      if (paper.sortPriority === newPos) return;
      paper.sortPriority = newPos;
      const tags = this.desiredTags(paper.tags, {
        queued: true, read: false, skipped: false, pos: newPos,
        queueName: paper.queueName,
      });
      paper.tags = tags;
      writes.push([paper.key, tags]);
    });
    this._saveCache();
    this.notify();
    for (const [key, tags] of writes) this._writeTags(key, tags);
  }

  /** Adds a Zotero item picked from a collection to a queue. */
  enqueue(rawItem, queue = DEFAULT_QUEUE) {
    let paper = this.papers.get(rawItem.data.key);
    if (!paper) {
      paper = this._makePaper(rawItem.data);
      this.papers.set(paper.key, paper);
    }
    this.addToQueue(paper, queue);
  }

  isQueued(key) {
    const p = this.papers.get(key);
    return !!(p && p.isPending);
  }

  async addByDOI(doi) {
    try {
      await api.addByDOI(doi);
    } catch (err) {
      this.lastError = err.message || "Could not add that paper.";
      return false;
    }
    await this.syncLibrary();
    return true;
  }

  // -- Settings --------------------------------------------------------------

  setDailyGoal(n) {
    this.settings.dailyGoal = Math.max(1, Number(n) || 1);
    this._saveCache();
    this.notify();
  }
  setReadExtraTags(tags) {
    this.settings.readExtraTags = uniq(tags);
    this._saveCache();
    this.notify();
  }

  // -- AI assistant settings -------------------------------------------------

  isFavorite(provider, model) {
    return this.settings.aiFavorites.some((f) => f.provider === provider && f.model === model);
  }
  addFavorite(provider, model) {
    if (this.isFavorite(provider, model)) return;
    this.settings.aiFavorites = [...this.settings.aiFavorites, { provider, model }];
    if (!this.settings.aiDefault) this.settings.aiDefault = { provider, model };
    this._saveCache();
    this.notify();
  }
  removeFavorite(provider, model) {
    this.settings.aiFavorites = this.settings.aiFavorites.filter(
      (f) => !(f.provider === provider && f.model === model)
    );
    const d = this.settings.aiDefault;
    if (d && d.provider === provider && d.model === model) {
      this.settings.aiDefault = this.settings.aiFavorites[0] || null;
    }
    this._saveCache();
    this.notify();
  }
  setAiDefault(provider, model) {
    this.settings.aiDefault = { provider, model };
    this._saveCache();
    this.notify();
  }

  // -- Undo support (AI actions) ---------------------------------------------
  // AI actions (queue additions, reorder) only ever change pq: tags, so undo is
  // just "restore the exact tag set each affected paper had before". Capture
  // before applying; restore writes the snapshot back through the normal path.

  captureTags(keys) {
    const snap = new Map();
    for (const key of keys) {
      const p = this.papers.get(key);
      if (p) snap.set(key, p.tags.slice());
    }
    return snap;
  }
  restoreTags(snapshot) {
    for (const [key, tags] of snapshot) {
      const p = this.papers.get(key);
      if (!p) continue;
      p.tags = tags.slice();
      this._deriveState(p);
    }
    this._saveCache();
    this.notify();
    for (const [key, tags] of snapshot) this._writeTags(key, tags);
  }

  // -- Derived collections for views ----------------------------------------

  pendingInQueue(queueName) {
    const stored = queueName === DEFAULT_QUEUE ? null : queueName;
    return [...this.papers.values()]
      .filter((p) => p.isPending && p.queueName === stored)
      .sort((a, b) => a.sortPriority - b.sortPriority || a.key.localeCompare(b.key));
  }
  pendingInActiveQueue() {
    return this.pendingInQueue(this.activeQueue);
  }
  allPapers() {
    return [...this.papers.values()];
  }
  /** Every user tag in the library (excludes PaperQueue's `pq:` state tags),
   *  sorted case-insensitively. Used by the AI "exclude tags" picker. */
  libraryTags() {
    const set = new Set();
    for (const p of this.papers.values()) {
      for (const t of p.tags) if (!t.startsWith("pq:")) set.add(t);
    }
    return [...set].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }
  history() {
    return [...this.papers.values()]
      .filter((p) => p.readStatus === "read")
      .sort((a, b) => {
        const da = (a.readDate ? new Date(a.readDate).getTime() : 0);
        const db = (b.readDate ? new Date(b.readDate).getTime() : 0);
        return db - da;
      });
  }
}
