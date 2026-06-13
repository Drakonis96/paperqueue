// Tests for the server-side AI provider client (provider registry, Gemini
// support, model-id normalization). Env is set before importing so config.js
// picks the key up.
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.GEMINI_API_KEY = "test-gemini-key";
// Make sure other providers stay unconfigured for deterministic assertions.
for (const k of ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "GOOGLE_API_KEY"]) {
  delete process.env[k];
}

let ai;
before(async () => {
  ai = await import("../src/ai.js");
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("aiConfig lists Gemini and reports it configured", () => {
  const cfg = ai.aiConfig();
  const ids = cfg.map((p) => p.id);
  assert.deepEqual(ids, ["openai", "openrouter", "deepseek", "gemini", "custom"]);
  const gem = cfg.find((p) => p.id === "gemini");
  assert.equal(gem.label, "Gemini");
  assert.equal(gem.configured, true);
  assert.equal(cfg.find((p) => p.id === "openai").configured, false);
});

test("aiEnabled is true when only Gemini is configured", () => {
  assert.equal(ai.aiEnabled(), true);
});

test("normalizeModelId strips the models/ prefix for Gemini only", () => {
  assert.equal(ai.normalizeModelId("gemini", "models/gemini-2.5-flash"), "gemini-2.5-flash");
  assert.equal(ai.normalizeModelId("gemini", "gemini-2.5-pro"), "gemini-2.5-pro");
  assert.equal(ai.normalizeModelId("openai", "models/foo"), "models/foo");
});

test("listModels normalizes, dedupes and sorts Gemini models", async () => {
  let calledUrl = null;
  globalThis.fetch = async (url, opts) => {
    calledUrl = url;
    // Gemini uses Bearer auth on its OpenAI-compatible endpoint.
    assert.equal(opts.headers.Authorization, "Bearer test-gemini-key");
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          data: [
            { id: "models/gemini-2.5-pro" },
            { id: "models/gemini-2.5-flash" },
            { id: "models/gemini-2.5-flash" }, // duplicate
          ],
        };
      },
      async text() {
        return "";
      },
    };
  };
  const models = await ai.listModels("gemini");
  assert.ok(calledUrl.startsWith("https://generativelanguage.googleapis.com/v1beta/openai/models"));
  assert.deepEqual(models, [{ id: "gemini-2.5-flash" }, { id: "gemini-2.5-pro" }]);
});

test("listModels rejects an unconfigured provider", async () => {
  await assert.rejects(() => ai.listModels("openai"), /isn't configured/);
});

test("responseFormatFor uses strict json_schema for schema-capable providers", () => {
  const schema = { name: "queue_order", schema: { type: "object", properties: {}, required: [], additionalProperties: false } };
  for (const p of ["openai", "openrouter", "gemini"]) {
    const rf = ai.responseFormatFor(p, schema);
    assert.equal(rf.type, "json_schema");
    assert.equal(rf.json_schema.name, "queue_order");
    assert.equal(rf.json_schema.strict, true);
    assert.equal(rf.json_schema.schema, schema.schema);
  }
});

test("responseFormatFor falls back to json_object for DeepSeek and custom", () => {
  const schema = { name: "x", schema: { type: "object" } };
  for (const p of ["deepseek", "custom"]) {
    assert.deepEqual(ai.responseFormatFor(p, schema), { type: "json_object" });
  }
});

test("responseFormatFor returns null when no schema is requested", () => {
  assert.equal(ai.responseFormatFor("openai", null), null);
  assert.equal(ai.responseFormatFor("openai", {}), null);
});
