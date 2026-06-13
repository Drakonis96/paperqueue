// Unit tests for the pure AI prompt/tag helpers (no DOM, no network).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PQ_TAG_LEGEND,
  userTags,
  excludedTagSet,
  hasExcludedTag,
  filterExcluded,
  filterIncluded,
  buildReorderMessages,
  buildSuggestMessages,
  buildTopicMessages,
  ORDER_SCHEMA,
  SUGGEST_SCHEMA,
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

test("filterIncluded keeps only items carrying an included tag", () => {
  const items = [
    { key: "A", tags: ["nlp"] },
    { key: "B", tags: ["vision"] },
    { key: "C", tags: ["nlp", "graphs"] },
    { key: "D", tags: [] },
  ];
  const kept = filterIncluded(items, ["NLP"]);
  assert.deepEqual(kept.map((i) => i.key), ["A", "C"]);
  // Empty include list = no restriction (everything, as a copy).
  const all = filterIncluded(items, []);
  assert.equal(all.length, items.length);
  assert.notEqual(all, items);
});

test("ORDER_SCHEMA and SUGGEST_SCHEMA are strict-compatible object roots", () => {
  for (const s of [ORDER_SCHEMA, SUGGEST_SCHEMA]) {
    assert.equal(typeof s.name, "string");
    assert.equal(s.schema.type, "object");
    assert.equal(s.schema.additionalProperties, false);
    assert.ok(Array.isArray(s.schema.required) && s.schema.required.length);
  }
  assert.deepEqual(SUGGEST_SCHEMA.schema.properties.suggestions.items.required, [
    "key",
    "title",
    "reason",
  ]);
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
  assert.ok(sys.includes('{"order":')); // object-wrapped output example (works with JSON mode)
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
  assert.ok(sys.includes('{"suggestions":')); // object-wrapped output example
});

test("buildSuggestMessages states an include constraint when given one", () => {
  const msgs = buildSuggestMessages({
    count: 4,
    candidates: [{ key: "C1", title: "T", authors: "A", year: "2020", tags: ["nlp"] }],
    includedTags: ["nlp", "graphs"],
  });
  const sys = msgs[0].content;
  assert.ok(/only wants papers related to these tags/i.test(sys));
  assert.ok(sys.includes("nlp, graphs"));
});

test("buildSuggestMessages omits the exclusion line when there are none", () => {
  const msgs = buildSuggestMessages({
    count: 5,
    candidates: [{ key: "C1", title: "T", authors: "A", year: "2020", tags: [] }],
  });
  assert.ok(!msgs[0].content.includes("never suggest an item carrying"));
  assert.ok(msgs[0].content.includes("the queue is currently empty"));
});

test("buildTopicMessages embeds the topic, candidates and the legend", () => {
  const msgs = buildTopicMessages({
    topic: "  diffusion models  ",
    count: 6,
    candidates: [
      { key: "C1", title: "Denoising Diffusion", authors: "Ho", year: "2020", tags: ["genai", "pq:queue"] },
      { key: "C2", title: "Score-Based Models", authors: "Song", year: "2021", tags: ["genai"] },
    ],
  });
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "system");
  const sys = msgs[0].content;
  assert.ok(sys.includes("up to 6 papers"));
  assert.ok(sys.includes("diffusion models")); // topic is trimmed and embedded
  assert.ok(!sys.includes("  diffusion models  ")); // trimmed, not raw
  assert.ok(sys.includes("[C1]") && sys.includes("[C2]"));
  assert.ok(sys.includes("tags: genai")); // pq: state tags are filtered out
  assert.ok(!sys.includes("tags: genai, pq:queue")); // not in the candidate's tag list
  assert.ok(sys.includes(PQ_TAG_LEGEND));
  assert.ok(sys.includes('{"suggestions":')); // reuses the suggestion output shape
  // The user turn names the topic.
  assert.equal(msgs[1].role, "user");
  assert.ok(msgs[1].content.includes("diffusion models"));
});

test("buildTopicMessages applies include/exclude tag constraints", () => {
  const withFilters = buildTopicMessages({
    topic: "graph neural networks",
    count: 5,
    candidates: [{ key: "C1", title: "T", authors: "A", year: "2020", tags: ["graphs"] }],
    includedTags: ["graphs"],
    excludedTags: ["surveys"],
  })[0].content;
  assert.ok(/only wants papers related to these tags/i.test(withFilters));
  assert.ok(withFilters.includes("graphs"));
  assert.ok(/never suggest an item carrying/i.test(withFilters));
  assert.ok(withFilters.includes("surveys"));

  // No filters ⇒ neither constraint line appears.
  const plain = buildTopicMessages({
    topic: "x",
    count: 3,
    candidates: [{ key: "C1", title: "T", authors: "A", year: "2020", tags: [] }],
  })[0].content;
  assert.ok(!/only wants papers related to these tags/i.test(plain));
  assert.ok(!/never suggest an item carrying/i.test(plain));
});
