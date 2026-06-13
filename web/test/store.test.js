// Unit tests for the client store's queue-position memory: a paper marked read
// (or skipped) remembers the slot it held, so sending it back from History
// restores it to its original position instead of dumping it at the bottom.
//
// The store talks to the server through api.js, but these tests only exercise
// the synchronous tag/state logic — writes fail fast (no server) and are caught,
// leaving the in-memory model to assert against.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Store, POSTPONED_QUEUE } from "../public/js/store.js";

function item(key, tags) {
  return { data: { key, title: key, tags: tags.map((tag) => ({ tag })), collections: [] } };
}

/** A store seeded with three papers queued in Default at 1024 / 2048 / 3072. */
function seeded() {
  const store = new Store();
  store.config = { connected: false }; // keep syncLibrary() a no-op
  store.reconcile([
    item("A", ["pq:queue", "pq:pos:1024"]),
    item("B", ["pq:queue", "pq:pos:2048"]),
    item("C", ["pq:queue", "pq:pos:3072"]),
  ]);
  return store;
}

const titles = (store, queue = "Default") =>
  store.pendingInQueue(queue).map((p) => p.key);

test("marking read keeps the position as memory tags", () => {
  const store = seeded();
  store.markRead(store.papers.get("B"));
  const b = store.papers.get("B");
  assert.equal(b.readStatus, "read");
  assert.equal(b.isPending, false);
  assert.ok(b.tags.some((t) => t.startsWith("pq:read")), "has a read tag");
  assert.ok(b.tags.includes("pq:pos:2048"), "retains its position as memory");
});

test("reset restores a read paper to its original slot, not the bottom", () => {
  const store = seeded();
  store.markRead(store.papers.get("B")); // B leaves the queue → [A, C]
  assert.deepEqual(titles(store), ["A", "C"]);

  store.reset(store.papers.get("B")); // back to its slot between A and C
  const b = store.papers.get("B");
  assert.equal(b.isPending, true);
  assert.equal(b.sortPriority, 2048);
  assert.deepEqual(titles(store), ["A", "B", "C"]);
});

test("reset restores into the remembered named queue", () => {
  const store = new Store();
  store.config = { connected: false };
  store.reconcile([
    item("X", ["pq:queue", "pq:qname:Work", "pq:pos:5000"]),
  ]);
  assert.ok(store.availableQueues.includes("Work"));

  store.markRead(store.papers.get("X"));
  assert.ok(store.papers.get("X").tags.includes("pq:qname:Work"));

  store.reset(store.papers.get("X"));
  const x = store.papers.get("X");
  assert.equal(x.isPending, true);
  assert.equal(x.queueName, "Work");
  assert.equal(x.sortPriority, 5000);
  assert.deepEqual(titles(store, "Work"), ["X"]);
});

test("a paper read without ever being queued just appends on reset", () => {
  const store = seeded();
  store.reconcile([item("D", ["pq:read:2026-01-01"])], { replaceAll: false });
  const d = store.papers.get("D");
  assert.equal(d.readStatus, "read");

  store.reset(d); // no remembered slot → Default, appended after the gap
  assert.equal(d.isPending, true);
  assert.equal(d.queueName, null);
  // Appended past the existing max position (3072) rather than colliding.
  assert.ok(d.sortPriority > 3072, `expected > 3072, got ${d.sortPriority}`);
});

test("skip also remembers the slot for a later reset", () => {
  const store = seeded();
  store.skip(store.papers.get("A"));
  const a = store.papers.get("A");
  assert.equal(a.readStatus, "skipped");
  assert.ok(a.tags.includes("pq:pos:1024"));
  store.reset(a);
  assert.equal(a.sortPriority, 1024);
  assert.deepEqual(titles(store), ["A", "B", "C"]);
});

test("marking read applies both add-on-read and remove-on-read tags", () => {
  const store = seeded();
  store.settings.readExtraTags = ["done"];
  store.settings.readRemoveTags = ["toread"];
  const b = store.papers.get("B");
  b.tags = ["toread", "pq:queue", "pq:pos:2048"]; // has the tag to strip

  store.markRead(b);
  assert.ok(b.tags.includes("done"), "adds the add-on-read tag");
  assert.ok(!b.tags.includes("toread"), "strips the remove-on-read tag");
  assert.ok(b.tags.some((t) => t.startsWith("pq:read")), "still marked read");
  assert.ok(b.tags.includes("pq:pos:2048"), "still remembers its slot");
});

test("remove-on-read is a no-op when the paper doesn't have the tag", () => {
  const store = seeded();
  store.settings.readRemoveTags = ["toread"];
  const a = store.papers.get("A"); // never had 'toread'
  store.markRead(a);
  assert.equal(a.readStatus, "read");
  assert.ok(!a.tags.includes("toread"));
});

// Guard: the Postponed list is a normal named queue, so its papers don't leak
// into Default's positions.
test("postpone keeps a paper out of the Default queue", () => {
  const store = seeded();
  store.postpone(store.papers.get("C"));
  assert.deepEqual(titles(store), ["A", "B"]);
  assert.deepEqual(titles(store, POSTPONED_QUEUE), ["C"]);
});
