// Unit tests for the pure AI prompt/tag helpers (no DOM, no network).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PQ_TAG_LEGEND,
  userTags,
  excludedTagSet,
  hasExcludedTag,
  filterExcluded,
  buildReorderMessages,
  buildSuggestMessages,
} from "../public/js/ai-prompt.js";

test("userTags drops PaperQueue pq: state tags, keeps topic tags", () => {
  const tags = ["transformers", "pq:queue", "pq:pos:1024", "nlp", "pq:read:2026-01-02"];
  assert.deepEqual(userTags(tags), ["transformers", "nlp"]);
  assert.deepEqual(userTags(undefined), []);
});

test("excludedTagSet lowercases and dedupes", () => {
  const set = excludedTagSet(["NLP", "nlp", "Vision"]);
  assert.equal(set.size, 2);
  assert.ok(set.has("nlp"));
  assert.ok(set.has("vision"));
});

test("hasExcludedTag matches case-insensitively", () => {
  const set = excludedTagSet(["NLP"]);
  assert.ok(hasExcludedTag(["deep learning", "nlp"], set));
  assert.ok(!hasExcludedTag(["vision"], set));
  assert.ok(!hasExcludedTag(["anything"], new Set()));
});

test("filterExcluded removes items carrying an excluded tag", () => {
  const items = [
    { key: "A", tags: ["nlp"] },
    { key: "B", tags: ["vision"] },
    { key: "C", tags: ["nlp", "transformers"] },
    { key: "D", tags: [] },
  ];
  const kept = filterExcluded(items, ["NLP"]);
  assert.deepEqual(kept.map((i) => i.key), ["B", "D"]);
  // Empty exclusion list returns everything (a copy, not the same array).
  const all = filterExcluded(items, []);
  assert.equal(all.length, items.length);
  assert.notEqual(all, items);
});

test("PQ_TAG_LEGEND explains every pq: state tag", () => {
  for (const t of ["pq:queue", "pq:qname:", "pq:pos:", "pq:read:", "pq:skip"]) {
    assert.ok(PQ_TAG_LEGEND.includes(t), `legend should mention ${t}`);
  }
});

test("buildReorderMessages embeds keys, tags and the legend", () => {
  const msgs = buildReorderMessages({
    label: "reading queue",
    papers: [
      { key: "K1", title: "Paper One", authorLine: "Smith", year: "2020", tags: ["nlp", "pq:queue"] },
      { key: "K2", title: "Paper Two", authorLine: "Doe", year: "2021", tags: ["vision"] },
    ],
  });
  assert.equal(msgs.length, 2);
  const sys = msgs[0].content;
  assert.equal(msgs[0].role, "system");
  assert.ok(sys.includes("[K1]") && sys.includes("[K2]"));
  assert.ok(sys.includes("tags: nlp")); // pq:queue is filtered out of the topic list
  assert.ok(!sys.includes("tags: nlp, pq:queue"));
  assert.ok(sys.includes(PQ_TAG_LEGEND));
  assert.equal(msgs[1].role, "user");
});

test("buildSuggestMessages includes count, candidates, queue context and exclusions", () => {
  const msgs = buildSuggestMessages({
    count: 3,
    candidates: [
      { key: "C1", title: "Cand One", authors: "Lee", year: "2019", tags: ["graphs"] },
    ],
    queueContext: [{ title: "In Queue", tags: ["nlp"] }],
    excludedTags: ["surveys"],
  });
  const sys = msgs[0].content;
  assert.ok(sys.includes("up to 3 papers"));
  assert.ok(sys.includes("[C1]"));
  assert.ok(sys.includes("In Queue"));
  assert.ok(sys.includes("surveys")); // exclusion is stated to the model
  assert.ok(sys.includes(PQ_TAG_LEGEND));
});

test("buildSuggestMessages omits the exclusion line when there are none", () => {
  const msgs = buildSuggestMessages({
    count: 5,
    candidates: [{ key: "C1", title: "T", authors: "A", year: "2020", tags: [] }],
  });
  assert.ok(!msgs[0].content.includes("never suggest an item carrying"));
  assert.ok(msgs[0].content.includes("the queue is currently empty"));
});
