// Thin fetch wrapper around the server's REST API + the live (SSE) channel.
// The server holds the Zotero key; the browser only ever talks to the server.

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = new Error(body?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export const api = {
  config: () => request("/api/config"),

  library: (since) =>
    request(`/api/library${since != null ? `?since=${since}` : ""}`),

  collections: () => request("/api/collections"),
  topCollections: () => request("/api/collections/top"),
  collection: (key) => request(`/api/collections/${encodeURIComponent(key)}`),

  setTags: (key, tags) =>
    request(`/api/items/${encodeURIComponent(key)}/tags`, {
      method: "POST",
      body: JSON.stringify({ tags }),
    }),

  addByDOI: (doi) =>
    request("/api/doi", { method: "POST", body: JSON.stringify({ doi }) }),

  /** Subscribes to live "library changed" events. Returns an unsubscribe fn. */
  liveUpdates(onChanged) {
    let es;
    const connect = () => {
      es = new EventSource("/api/events");
      es.addEventListener("changed", (e) => {
        let version = null;
        try {
          version = JSON.parse(e.data).version;
        } catch {
          /* ignore */
        }
        onChanged(version);
      });
      es.onerror = () => {
        // EventSource reconnects automatically; nothing to do.
      };
    };
    connect();
    return () => es && es.close();
  },
};
