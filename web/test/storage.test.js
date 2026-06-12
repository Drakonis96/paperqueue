// Tests for server-side settings persistence (the foundation of cross-device /
// incognito settings: the server, not localStorage, is the source of truth).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pq-storage-"));
process.env.DATA_DIR = tmpDir; // read by config.js at import time

let storage;
before(async () => {
  storage = await import("../src/storage.js");
});
after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("readSettings returns {} when nothing has been saved", () => {
  assert.deepEqual(storage.readSettings(), {});
});

test("writeSettings then readSettings round-trips the object", () => {
  const settings = {
    dailyGoal: 7,
    customQueues: ["Thesis"],
    aiFavorites: [{ provider: "gemini", model: "gemini-2.5-flash" }],
    aiDefault: { provider: "gemini", model: "gemini-2.5-flash" },
  };
  storage.writeSettings(settings);
  assert.deepEqual(storage.readSettings(), settings);
  // It really hit disk under DATA_DIR.
  assert.ok(fs.existsSync(path.join(tmpDir, "settings.json")));
});

test("writeSettings overwrites the previous value", () => {
  storage.writeSettings({ dailyGoal: 3 });
  assert.deepEqual(storage.readSettings(), { dailyGoal: 3 });
});

test("writeSettings coerces non-objects to an empty object", () => {
  storage.writeSettings(["not", "an", "object"]);
  assert.deepEqual(storage.readSettings(), {});
  storage.writeSettings(null);
  assert.deepEqual(storage.readSettings(), {});
});
