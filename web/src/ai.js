// Server-side AI provider client. A single OpenAI-compatible client that fronts
// OpenAI, OpenRouter, DeepSeek and an optional custom endpoint — all four speak
// the same `/models` + `/chat/completions` (stream + tools) shape, so one client
// covers them.
//
// SECURITY: provider API keys live ONLY here, read from the server environment
// (see config.js). They are never sent to the browser and never logged. The
// browser only ever posts { provider, model, messages, … } and this module
// attaches the key from env before calling the provider.

import { config } from "./config.js";

// Default OpenAI-compatible base URLs (verified against each provider's docs).
const BASES = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com",
};

export class AiError extends Error {
  constructor(status, message) {
    super(message || `AI error ${status}`);
    this.name = "AiError";
    this.status = status;
  }
}

/** Resolves a provider id to its concrete spec (label, base URL, key). */
function specFor(id) {
  const ai = config.ai;
  switch (id) {
    case "openai":
      return { id, label: "OpenAI", base: BASES.openai, apiKey: ai.openai.apiKey };
    case "openrouter":
      return {
        id,
        label: "OpenRouter",
        base: BASES.openrouter,
        apiKey: ai.openrouter.apiKey,
        // Optional attribution headers recommended by OpenRouter.
        extraHeaders: {
          "HTTP-Referer": "https://github.com/Drakonis96/paperqueue",
          "X-Title": "PaperQueue",
        },
      };
    case "deepseek":
      return { id, label: "DeepSeek", base: BASES.deepseek, apiKey: ai.deepseek.apiKey };
    case "custom":
      return {
        id,
        label: ai.custom.name || "Custom",
        base: (ai.custom.baseUrl || "").replace(/\/+$/, ""),
        apiKey: ai.custom.apiKey,
      };
    default:
      return null;
  }
}

const PROVIDER_IDS = ["openai", "openrouter", "deepseek", "custom"];

/** A provider is usable only when it has a key (and, for custom, a base URL). */
function isConfigured(spec) {
  return !!(spec && spec.apiKey && spec.base);
}

function authHeaders(spec) {
  return { Authorization: `Bearer ${spec.apiKey}`, ...(spec.extraHeaders || {}) };
}

/** Pulls a human-readable message out of a provider error body without leaking
 *  anything sensitive (provider error bodies never contain the API key). */
function providerMessage(text) {
  try {
    const json = JSON.parse(text);
    return json?.error?.message || json?.message || null;
  } catch {
    return null;
  }
}

// MARK: - Public API ----------------------------------------------------------

/** Lists providers and whether each is configured — never exposes keys. */
export function aiConfig() {
  return PROVIDER_IDS.map((id) => {
    const s = specFor(id);
    return { id, label: s.label, configured: isConfigured(s) };
  });
}

/** True if at least one provider is ready to use. */
export function aiEnabled() {
  return PROVIDER_IDS.some((id) => isConfigured(specFor(id)));
}

/**
 * Lists every model the provider exposes, sorted alphabetically (case-insensitive).
 * @returns {Promise<{id:string}[]>}
 */
export async function listModels(providerId) {
  const spec = specFor(providerId);
  if (!isConfigured(spec)) {
    throw new AiError(400, "That AI provider isn't configured on the server.");
  }
  let res;
  try {
    res = await fetch(`${spec.base}/models`, { headers: authHeaders(spec) });
  } catch {
    throw new AiError(502, `Couldn't reach ${spec.label}.`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AiError(res.status, providerMessage(text) || `Couldn't load models from ${spec.label}.`);
  }
  const json = await res.json().catch(() => ({}));
  const list = Array.isArray(json) ? json : json.data || json.models || [];
  const ids = list
    .map((m) => (typeof m === "string" ? m : m?.id || m?.name))
    .filter(Boolean);
  return [...new Set(ids)]
    .sort((a, b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase()))
    .map((id) => ({ id }));
}

/**
 * Streams a chat completion straight through to the browser. The provider's
 * SSE bytes are piped verbatim into `res` (the client parses content + tool_call
 * deltas). `signal` aborts the upstream request when the browser disconnects or
 * hits "Stop".
 *
 * @param {string} providerId
 * @param {object} body  { model, messages, tools?, tool_choice?, temperature? }
 * @param {import('http').ServerResponse} res
 * @param {AbortSignal} signal
 */
export async function streamChat(providerId, body, res, signal) {
  const spec = specFor(providerId);
  if (!isConfigured(spec)) {
    throw new AiError(400, "That AI provider isn't configured on the server.");
  }
  if (!body || typeof body.model !== "string" || !Array.isArray(body.messages)) {
    throw new AiError(400, "Request needs { model, messages }.");
  }

  // DeepSeek V4 models (and the legacy reasoner alias) default to thinking
  // mode, which rejects a forced tool_choice. Disable thinking when we were
  // going to force a specific function, and let the caller decide whether to
  // require a tool call.
  if (
    providerId === "deepseek" &&
    body.tool_choice &&
    typeof body.tool_choice === "object"
  ) {
    body = { ...body, thinking: { type: "disabled" } };
  }

  let upstream;
  try {
    upstream = await fetch(`${spec.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(spec) },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return; // client went away
    throw new AiError(502, `Couldn't reach ${spec.label}.`);
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    throw new AiError(
      upstream.status || 502,
      providerMessage(text) || `${spec.label} returned an error (${upstream.status}).`
    );
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch (err) {
    if (err?.name !== "AbortError") {
      // Surface a final SSE error frame the client can show.
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ error: "Stream interrupted." })}\n\n`);
      } catch {
        /* ignore */
      }
    }
  } finally {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
}
