// Server-side AI provider client. A single OpenAI-compatible client that fronts
// OpenAI, OpenRouter, DeepSeek, Google Gemini and an optional custom endpoint —
// they all speak the same `/models` + `/chat/completions` (stream + tools)
// shape, so one client covers them. Gemini exposes an OpenAI-compatible surface
// at /v1beta/openai (https://ai.google.dev/gemini-api/docs/openai).
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
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
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
    case "gemini":
      return { id, label: "Gemini", base: BASES.gemini, apiKey: ai.gemini.apiKey };
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

const PROVIDER_IDS = ["openai", "openrouter", "deepseek", "gemini", "custom"];

/** Normalizes a raw model id from a provider's /models list. Gemini returns ids
 *  prefixed with `models/` (e.g. "models/gemini-2.5-flash"); its chat endpoint
 *  takes the bare name, so strip the prefix for a clean, usable id. */
export function normalizeModelId(providerId, id) {
  const s = String(id);
  if (providerId === "gemini") return s.replace(/^models\//, "");
  return s;
}

// Providers whose OpenAI-compatible API supports strict JSON-Schema Structured
// Outputs. OpenAI and OpenRouter take `response_format.json_schema` directly;
// Gemini's OpenAI-compat layer accepts the same shape (it's what the documented
// Zod helper emits). DeepSeek supports only `json_object`, and custom endpoints
// vary, so they fall back to `json_object` (the broadly-supported JSON mode).
const JSON_SCHEMA_PROVIDERS = new Set(["openai", "openrouter", "gemini"]);

/**
 * Builds the provider-appropriate `response_format` for a desired JSON schema,
 * or null when no schema was requested. `responseSchema` is `{ name, schema }`
 * where `schema` is a JSON Schema whose root is an object.
 */
export function responseFormatFor(providerId, responseSchema) {
  if (!responseSchema || !responseSchema.schema) return null;
  if (JSON_SCHEMA_PROVIDERS.has(providerId)) {
    return {
      type: "json_schema",
      json_schema: {
        name: responseSchema.name || "response",
        strict: true,
        schema: responseSchema.schema,
      },
    };
  }
  // DeepSeek's JSON mode (and most custom endpoints) only understand json_object;
  // the prompt already includes the word "json" and an example, as DeepSeek
  // requires, so the schema is enforced through the prompt instead.
  return { type: "json_object" };
}

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
    .filter(Boolean)
    .map((id) => normalizeModelId(providerId, id));
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

  // `responseSchema` is a PaperQueue concept, not an upstream field — pull it out
  // and translate it into the provider's concrete response_format.
  const { responseSchema, ...payloadBody } = body;
  let payload = payloadBody;
  const responseFormat = responseFormatFor(providerId, responseSchema);
  if (responseFormat) payload = { ...payload, response_format: responseFormat };

  // DeepSeek V4 models (and the legacy reasoner alias) default to thinking mode,
  // which rejects both a forced tool_choice and JSON mode. Disable thinking when
  // we use either, and let the caller decide whether to require a tool call.
  if (
    providerId === "deepseek" &&
    ((payload.tool_choice && typeof payload.tool_choice === "object") || responseFormat)
  ) {
    payload = { ...payload, thinking: { type: "disabled" } };
  }

  let upstream;
  try {
    upstream = await fetch(`${spec.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(spec) },
      body: JSON.stringify({ ...payload, stream: true }),
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
