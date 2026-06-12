// Server-side Zotero Web API v3 client.
//
// This mirrors the native app's `ZoteroAPI` (app/PaperQueue/Networking/
// ZoteroAPI.swift): the same tag-based state model, the same incremental sync
// (If-Modified-Since-Version → 304 fast path), and the same version-guarded
// tag writes (If-Unmodified-Since-Version → 412 retry). The browser never sees
// the API key — it only ever talks to this server.

const PAGE_LIMIT = 100; // largest page Zotero serves at once
const MAX_CONCURRENT_PAGES = 5; // keep a few page reads in flight

export class ZoteroError extends Error {
  constructor(status, message) {
    super(message || `Zotero error ${status}`);
    this.name = "ZoteroError";
    this.status = status;
  }
}

export class ZoteroClient {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey   Zotero Web API key.
   * @param {string} opts.library  e.g. "users/12114468" or "groups/123456".
   * @param {string} opts.apiBase  Base URL (default api.zotero.org).
   */
  constructor({ apiKey, library, apiBase }) {
    this.apiKey = apiKey;
    this.library = library;
    this.apiBase = (apiBase || "https://api.zotero.org").replace(/\/+$/, "");
    this.demo = false;
  }

  // MARK: - Identity

  /** Validates a key and returns { userID, username, canRead, canWrite }. */
  static async verifyKey(apiKey, apiBase = "https://api.zotero.org") {
    const res = await fetch(`${apiBase}/keys/current`, {
      headers: { "Zotero-API-Version": "3", "Zotero-API-Key": apiKey },
    });
    if (!res.ok) {
      throw new ZoteroError(
        res.status,
        "Zotero rejected that API key. Check you copied it correctly."
      );
    }
    const json = await res.json();
    const user = json?.access?.user || {};
    return {
      userID: json.userID,
      username: json.username || null,
      canRead: !!user.library,
      canWrite: !!user.write,
    };
  }

  // MARK: - Request helpers

  _url(suffix) {
    return `${this.apiBase}/${this.library}/${suffix}`;
  }

  _headers(extra = {}) {
    return {
      "Zotero-API-Version": "3",
      "Zotero-API-Key": this.apiKey,
      ...extra,
    };
  }

  // MARK: - Reads

  /**
   * Reads top-level library items. When `since` is null this is a full
   * snapshot (pages fetched concurrently); when it's a known version it's an
   * incremental read — a 304 short-circuits to { notModified:true }.
   * @returns {Promise<{items:object[], version:number|null, notModified:boolean}>}
   */
  async librarySync(since = null) {
    const first = await this._fetchItemPage("items/top", 0, since, true);
    if (first.notModified) {
      return { items: [], version: since, notModified: true };
    }
    const version = first.version;
    if (first.items.length >= first.total || first.items.length === 0) {
      return { items: first.items, version, notModified: false };
    }

    const starts = [];
    for (let s = PAGE_LIMIT; s < first.total; s += PAGE_LIMIT) starts.push(s);

    const pages = { 0: first.items };
    for (let i = 0; i < starts.length; i += MAX_CONCURRENT_PAGES) {
      const window = starts.slice(i, i + MAX_CONCURRENT_PAGES);
      const batches = await Promise.all(
        window.map(async (start) => {
          const page = await this._fetchItemPage("items/top", start, since, false);
          return [start, page.items];
        })
      );
      for (const [start, items] of batches) pages[start] = items;
    }

    const ordered = Object.keys(pages)
      .map(Number)
      .sort((a, b) => a - b)
      .flatMap((k) => pages[k]);
    return { items: ordered, version, notModified: false };
  }

  /** Keys of items deleted since `version` (so incremental sync can drop them). */
  async deletedItemKeys(version) {
    const res = await fetch(this._url(`deleted?since=${version}`), {
      headers: this._headers(),
    });
    if (!res.ok) return [];
    const json = await res.json().catch(() => ({}));
    return Array.isArray(json.items) ? json.items : [];
  }

  async children(itemKey) {
    return this._paginatedItems(`items/${itemKey}/children`);
  }

  async topCollections() {
    return this._collections("collections/top");
  }

  async allCollections() {
    return this._collections("collections");
  }

  async subcollections(key) {
    return this._collections(`collections/${key}/collections`);
  }

  async collectionItems(key) {
    return this._paginatedItems(`collections/${key}/items/top`);
  }

  // MARK: - Writes

  /** Creates items from an array of Zotero item-data dictionaries. */
  async createItems(items) {
    const res = await fetch(this._url("items"), {
      method: "POST",
      headers: this._headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(items),
    });
    if (res.status === 403) {
      throw new ZoteroError(403, "Your key can't write. Use a write-enabled key.");
    }
    if (res.status !== 200) {
      throw new ZoteroError(res.status, "Zotero rejected the item.");
    }
    const json = await res.json().catch(() => ({}));
    if (json.failed && Object.keys(json.failed).length > 0) {
      const reason = Object.values(json.failed)[0]?.message;
      throw new ZoteroError(400, reason || "Zotero rejected the item.");
    }
    return json;
  }

  /**
   * Replaces an item's tags. Reads its current version then PATCHes guarded by
   * If-Unmodified-Since-Version; on a 412 conflict it re-reads and retries once.
   */
  async setTags(itemKey, tags) {
    for (let attempt = 0; attempt <= 1; attempt++) {
      const getRes = await fetch(this._url(`items/${itemKey}`), {
        headers: this._headers(),
      });
      if (getRes.status !== 200) {
        throw new ZoteroError(getRes.status, "Couldn't read the item.");
      }
      const item = await getRes.json();
      const version = item.data.version;

      const patchRes = await fetch(this._url(`items/${itemKey}`), {
        method: "PATCH",
        headers: this._headers({
          "Content-Type": "application/json",
          "If-Unmodified-Since-Version": String(version),
        }),
        body: JSON.stringify({ tags: tags.map((t) => ({ tag: t })) }),
      });
      if (patchRes.status === 204) return;
      if (patchRes.status === 412 && attempt === 0) continue; // conflict: retry
      throw new ZoteroError(patchRes.status, "Couldn't update tags.");
    }
  }

  // MARK: - Internals

  async _fetchItemPage(path, start, since, isFirst) {
    const params = new URLSearchParams({
      include: "data",
      limit: String(PAGE_LIMIT),
      start: String(start),
    });
    if (since != null) params.set("since", String(since));

    const headers = this._headers();
    // Only the first page short-circuits on 304.
    if (since != null && isFirst) {
      headers["If-Modified-Since-Version"] = String(since);
    }

    const res = await fetch(`${this._url(path)}?${params}`, {
      headers,
      cache: "no-store",
    });
    if (res.status === 304) {
      return { items: [], total: 0, version: since, notModified: true };
    }
    if (res.status !== 200) {
      throw new ZoteroError(res.status, "Couldn't read your library.");
    }
    const items = await res.json();
    const total = Number(res.headers.get("Total-Results")) || start + items.length;
    const version = Number(res.headers.get("Last-Modified-Version")) || null;
    return { items, total, version, notModified: false };
  }

  async _paginatedItems(path) {
    const first = await this._fetchItemPage(path, 0, null, false);
    if (first.items.length >= first.total || first.items.length === 0) {
      return first.items;
    }
    const starts = [];
    for (let s = PAGE_LIMIT; s < first.total; s += PAGE_LIMIT) starts.push(s);
    const pages = { 0: first.items };
    for (let i = 0; i < starts.length; i += MAX_CONCURRENT_PAGES) {
      const window = starts.slice(i, i + MAX_CONCURRENT_PAGES);
      const batches = await Promise.all(
        window.map(async (start) => {
          const page = await this._fetchItemPage(path, start, null, false);
          return [start, page.items];
        })
      );
      for (const [start, items] of batches) pages[start] = items;
    }
    return Object.keys(pages)
      .map(Number)
      .sort((a, b) => a - b)
      .flatMap((k) => pages[k]);
  }

  async _collections(path) {
    const all = [];
    let start = 0;
    for (;;) {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT), start: String(start) });
      const res = await fetch(`${this._url(path)}?${params}`, { headers: this._headers() });
      if (res.status !== 200) {
        throw new ZoteroError(res.status, "Couldn't read collections.");
      }
      const list = await res.json();
      if (!list.length) break;
      all.push(...list);
      const total = Number(res.headers.get("Total-Results")) || start + list.length;
      if (start + list.length >= total) break;
      start += PAGE_LIMIT;
    }
    return all
      .map((c) => ({ key: c.key, name: c.data.name, parent: c.data.parentCollection || null }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }
}
