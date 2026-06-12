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

  // -- User settings (server-side, shared across devices) --------------------
  settings: () => request("/api/settings"),
  saveSettings: (settings) =>
    request("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),

  // -- AI assistant ----------------------------------------------------------
  // The browser never holds provider keys; these only ever exchange model lists
  // and streamed completions with the server.

  aiConfig: () => request("/api/ai/config"),
  aiModels: (provider) =>
    request(`/api/ai/models?provider=${encodeURIComponent(provider)}`),

  /**
   * Streams a chat completion. Calls `onEvent` with structured events:
   *   { type: "delta", delta, finish_reason }  — an incremental chunk
   *   { type: "done" }                          — provider sent [DONE]
   *   { type: "error", error }                  — a mid-stream error frame
   * Pass `signal` (AbortSignal) to support a Stop button.
   */
  async aiChat({ provider, model, messages, tools, tool_choice, temperature, signal }, onEvent) {
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, model, messages, tools, tool_choice, temperature }),
      signal,
    });
    if (!res.ok || !res.body) {
      let msg = `Request failed (${res.status})`;
      try {
        const j = await res.json();
        msg = j?.error || msg;
      } catch {
        /* non-JSON */
      }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const flush = (frame) => {
      let event = "message";
      const dataLines = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      }
      if (!dataLines.length) return; // comment / keep-alive
      const data = dataLines.join("\n");
      if (data === "[DONE]") return onEvent({ type: "done" });
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        return;
      }
      if (event === "error" || json.error) {
        return onEvent({ type: "error", error: json.error?.message || json.error || "AI error" });
      }
      const choice = json.choices?.[0] || {};
      const delta = choice.delta || {};
      // Some providers send the completed tool call on the final chunk inside
      // message.tool_calls rather than delta.tool_calls.
      if (!delta.tool_calls && Array.isArray(choice.message?.tool_calls)) {
        delta.tool_calls = choice.message.tool_calls;
      }
      onEvent({ type: "delta", delta, finish_reason: choice.finish_reason || null });
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        flush(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
      }
    }
    if (buf.trim()) flush(buf);
  },

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
