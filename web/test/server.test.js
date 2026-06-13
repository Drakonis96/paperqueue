// Integration test: boots the real server in DEMO mode in a child process and
// exercises the HTTP API end-to-end — settings persistence (the incognito fix)
// and Gemini surfacing through /api/ai/config and /api/config.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const serverEntry = fileURLToPath(new URL("../src/server.js", import.meta.url));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pq-server-"));

let child;
let base;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error("server did not become healthy in time");
    await new Promise((r) => setTimeout(r, 150));
  }
}

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      DEMO_MODE: "1",
      PORT: String(port),
      DATA_DIR: tmpDir,
      UPDATE_CHECK: "0",
      GEMINI_API_KEY: "test-gemini-key",
      OPENAI_API_KEY: "",
      OPENROUTER_API_KEY: "",
      DEEPSEEK_API_KEY: "",
      GOOGLE_API_KEY: "",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  await waitForHealth();
});

after(() => {
  if (child) child.kill("SIGKILL");
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("health reports demo + connected", async () => {
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.status, "ok");
  assert.equal(health.demo, true);
  assert.equal(health.connected, true);
});

test("config advertises AI enabled (Gemini key present)", async () => {
  const cfg = await (await fetch(`${base}/api/config`)).json();
  assert.equal(cfg.ai, true);
});

test("ai/config lists Gemini as configured", async () => {
  const { providers } = await (await fetch(`${base}/api/ai/config`)).json();
  const gem = providers.find((p) => p.id === "gemini");
  assert.ok(gem, "gemini provider should be present");
  assert.equal(gem.configured, true);
});

test("settings persist server-side across requests (incognito-proof)", async () => {
  // A fresh DATA_DIR starts empty.
  const initial = await (await fetch(`${base}/api/settings`)).json();
  assert.deepEqual(initial, {});

  // Save like a configured browser would.
  const payload = { dailyGoal: 9, customQueues: ["Reading"], aiDefault: { provider: "gemini", model: "gemini-2.5-flash" } };
  const put = await fetch(`${base}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(put.status, 204);

  // A brand-new client (no shared localStorage) reads them straight back.
  const fresh = await (await fetch(`${base}/api/settings`)).json();
  assert.deepEqual(fresh, payload);
  // And they survived to disk.
  assert.ok(fs.existsSync(path.join(tmpDir, "settings.json")));
});

test("settings PUT rejects a non-object body", async () => {
  const res = await fetch(`${base}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(["nope"]),
  });
  assert.equal(res.status, 400);
});

test("library serves the demo data, and force-sync still works", async () => {
  const full = await (await fetch(`${base}/api/library`)).json();
  assert.ok(Array.isArray(full.items) && full.items.length > 0);
  assert.equal(typeof full.version, "number");

  // The manual Sync button hits force=1 — it must keep working.
  const forced = await (await fetch(`${base}/api/library?force=1`)).json();
  assert.ok(Array.isArray(forced.items) && forced.items.length > 0);

  // Polling at the current version is a no-op.
  const nm = await (await fetch(`${base}/api/library?since=${full.version}`)).json();
  assert.equal(nm.notModified, true);
});

test("update endpoint returns a well-formed payload", async () => {
  const u = await (await fetch(`${base}/api/update`)).json();
  assert.equal(typeof u.current, "string");
  assert.equal(typeof u.updateAvailable, "boolean");
});

test("security headers are present on responses", async () => {
  const res = await fetch(`${base}/api/health`);
  const csp = res.headers.get("content-security-policy");
  assert.ok(csp, "CSP header should be set");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.ok(res.headers.get("referrer-policy"));
  // The Express fingerprint should be suppressed.
  assert.equal(res.headers.get("x-powered-by"), null);
});

test("PQ_FRAME_ANCESTORS would relax framing (default is locked down)", async () => {
  // The running instance uses the default, so this just asserts the safe default
  // is in effect (the override path is covered by config.js parsing).
  const res = await fetch(`${base}/`);
  assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

test("PWA assets are served", async () => {
  const manifest = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifest.status, 200);
  const json = await manifest.json();
  assert.equal(json.name, "PaperQueue");
  assert.equal(json.display, "standalone");
  assert.ok(Array.isArray(json.icons) && json.icons.length >= 2);

  const sw = await fetch(`${base}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get("content-type") || "", /javascript/);
});
