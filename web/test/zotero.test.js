// Unit tests for the Zotero client's rate-limit handling (the 429/503 + Backoff
// retry logic added in src/zotero.js). fetch() is stubbed so no network is hit.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ZoteroClient, ZoteroError } from "../src/zotero.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function client() {
  return new ZoteroClient({ apiKey: "k", library: "users/1", apiBase: "https://api.zotero.test" });
}

// A minimal Response-ish stub with the headers a test cares about.
function reply(status, { headers = {}, json = {}, body = "" } = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (h.has(name.toLowerCase()) ? h.get(name.toLowerCase()) : null) },
    json: async () => json,
    text: async () => body,
  };
}

test("retries a 429 (honouring Retry-After) then succeeds", async () => {
  const calls = [];
  let n = 0;
  globalThis.fetch = async (url) => {
    calls.push(url);
    n += 1;
    // First call is throttled, second succeeds. Retry-After:0 so the test is fast.
    if (n === 1) return reply(429, { headers: { "Retry-After": "0" } });
    return reply(200, {
      headers: { "Total-Results": "1", "Last-Modified-Version": "42" },
      json: [{ data: { key: "AAA", version: 42 } }],
    });
  };

  const c = client();
  const result = await c.librarySync(null);
  assert.equal(n, 2, "should have retried exactly once");
  assert.equal(result.items.length, 1);
  assert.equal(result.version, 42);
});

test("retries a 503 then succeeds", async () => {
  let n = 0;
  globalThis.fetch = async () => {
    n += 1;
    if (n === 1) return reply(503, { headers: { "Retry-After": "0" } });
    return reply(200, {
      headers: { "Total-Results": "0", "Last-Modified-Version": "7" },
      json: [],
    });
  };
  const c = client();
  const result = await c.librarySync(null);
  assert.equal(n, 2);
  assert.equal(result.notModified, false);
});

test("gives up after MAX_RETRIES and surfaces a ZoteroError", async () => {
  let n = 0;
  globalThis.fetch = async () => {
    n += 1;
    return reply(429, { headers: { "Retry-After": "0" } });
  };
  const c = client();
  await assert.rejects(() => c.librarySync(null), (err) => {
    assert.ok(err instanceof ZoteroError);
    return true;
  });
  // 1 initial attempt + MAX_RETRIES (4) retries = 5 calls.
  assert.equal(n, 5);
});

test("a Backoff header gates the next request without failing it", async () => {
  const times = [];
  let n = 0;
  globalThis.fetch = async () => {
    times.push(Date.now());
    n += 1;
    if (n === 1) {
      // 200 OK but asks us to slow down for ~50ms before the next request.
      return reply(200, {
        headers: { "Total-Results": "200", "Last-Modified-Version": "9", Backoff: "0.05" },
        json: Array.from({ length: 100 }, (_, i) => ({ data: { key: "K" + i, version: 9 } })),
      });
    }
    return reply(200, {
      headers: { "Total-Results": "200", "Last-Modified-Version": "9" },
      json: Array.from({ length: 100 }, (_, i) => ({ data: { key: "J" + i, version: 9 } })),
    });
  };
  const c = client();
  const result = await c.librarySync(null);
  assert.equal(result.items.length, 200);
  // The second page request must have waited for the advertised backoff.
  assert.ok(times[1] - times[0] >= 40, `expected a backoff delay, got ${times[1] - times[0]}ms`);
});
