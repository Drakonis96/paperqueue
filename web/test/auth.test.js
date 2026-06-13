// Integration test for the optional basic-auth layer: boots the real server in
// DEMO mode with AUTH_ENABLED=1 and exercises the login flow, the API gate, and
// brute-force rate limiting end-to-end.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const serverEntry = fileURLToPath(new URL("../src/server.js", import.meta.url));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pq-auth-"));

const USER = "tester";
const PASS = "s3cret-pass";
const MAX_ATTEMPTS = 3;

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

/** Pulls the pq_session value out of a response's Set-Cookie header(s). */
function sessionCookie(res) {
  const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")];
  for (const c of all.filter(Boolean)) {
    const m = /pq_session=([^;]+)/.exec(c);
    if (m) return `pq_session=${m[1]}`;
  }
  return null;
}

function login(username, password) {
  return fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
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
      AUTH_ENABLED: "1",
      AUTH_USERNAME: USER,
      AUTH_PASSWORD: PASS,
      AUTH_MAX_ATTEMPTS: String(MAX_ATTEMPTS),
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  await waitForHealth();
});

after(() => {
  if (child) child.kill("SIGKILL");
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("auth status reports enabled + unauthenticated before login", async () => {
  const a = await (await fetch(`${base}/api/auth`)).json();
  assert.equal(a.enabled, true);
  assert.equal(a.authenticated, false);
});

test("protected API is blocked without a session", async () => {
  const res = await fetch(`${base}/api/library`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.authRequired, true);
});

test("wrong password is rejected with a remaining count", async () => {
  const res = await login(USER, "nope");
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(typeof body.remaining, "number");
});

test("correct credentials grant a working session", async () => {
  const res = await login(USER, PASS);
  assert.equal(res.status, 200);
  const cookie = sessionCookie(res);
  assert.ok(cookie, "a session cookie should be set");

  // The cookie unlocks the protected API…
  const lib = await fetch(`${base}/api/library`, { headers: { cookie } });
  assert.equal(lib.status, 200);
  const data = await lib.json();
  assert.ok(Array.isArray(data.items) && data.items.length > 0);

  // …and /api/auth now reports authenticated.
  const a = await (await fetch(`${base}/api/auth`, { headers: { cookie } })).json();
  assert.equal(a.authenticated, true);

  // Logout invalidates it.
  await fetch(`${base}/api/logout`, { method: "POST", headers: { cookie } });
  const after = await fetch(`${base}/api/library`, { headers: { cookie } });
  assert.equal(after.status, 401);
});

test("repeated failures trip the rate limiter (429)", async () => {
  // A correct login above cleared this IP's counter. Now exhaust it.
  let last;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    last = await login(USER, "wrong-" + i);
  }
  assert.equal(last.status, 429);
  const body = await last.json();
  assert.equal(typeof body.retryAfter, "number");
  assert.ok(body.retryAfter > 0);

  // Even the *correct* password is refused while blocked.
  const blocked = await login(USER, PASS);
  assert.equal(blocked.status, 429);
});
