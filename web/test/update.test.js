// Tests for the update-check module (version comparison + cached fetch).
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.UPDATE_CHECK = "1";
process.env.UPDATE_REPO = "Drakonis96/paperqueue";

let mod;
before(async () => {
  mod = await import("../src/update.js");
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("isNewer compares semver-ish versions, ignoring a leading v", () => {
  const { isNewer } = mod;
  assert.equal(isNewer("1.19.5", "1.19.4"), true);
  assert.equal(isNewer("v1.20.0", "1.19.9"), true);
  assert.equal(isNewer("2.0.0", "1.99.99"), true);
  assert.equal(isNewer("1.19.4", "1.19.4"), false);
  assert.equal(isNewer("1.19.3", "1.19.4"), false);
  assert.equal(isNewer("1.19", "1.19.0"), false);
});

test("checkForUpdate reports an available update from the latest tag", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { tag_name: "v999.0.0" };
    },
  });
  const r = await mod.checkForUpdate();
  assert.equal(r.latest, "999.0.0");
  assert.equal(r.updateAvailable, true);
  assert.ok(r.url.includes("Drakonis96/paperqueue"));
});

test("checkForUpdate never throws on network failure", async () => {
  // The previous test cached a result for 6h, so reset the module to force a
  // fresh fetch in this isolated import.
  const fresh = await import("../src/update.js?fail");
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  const r = await fresh.checkForUpdate();
  assert.equal(r.updateAvailable, false);
  assert.equal(r.latest, r.current);
});
