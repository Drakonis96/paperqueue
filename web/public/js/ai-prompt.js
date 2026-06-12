// Pure helpers for the AI assistant: tag handling and prompt construction.
//
// Kept free of DOM / network / store dependencies so the logic that decides what
// the model sees — including how PaperQueue's own `pq:` tags are explained and
// how the user's tag exclusions are applied — can be unit-tested directly under
// `node --test` (see web/test/ai-prompt.test.js).

// A short legend so the model understands PaperQueue's namespaced tags when it
// sees them on a paper. These encode reading state, not topics.
export const PQ_TAG_LEGEND =
  "PaperQueue stores reading state in namespaced `pq:` tags. Interpret them as: " +
  "`pq:queue` = already in a reading queue; `pq:qname:<name>` = in the named queue " +
  "<name> (no qname ⇒ the Default queue; `pq:qname:Postponed` ⇒ set aside); " +
  "`pq:pos:<n>` = position within its queue; `pq:read:<YYYY-MM-DD>` = already read " +
  "on that date; `pq:skip` = the user chose to skip it. All other tags are the " +
  "user's own topic/keyword tags — use them to judge subject matter and affinity.";

/** Tags the user actually applied (topics/keywords) — i.e. everything that is
 *  not one of PaperQueue's internal `pq:` state tags. */
export function userTags(tags) {
  return (tags || []).filter((t) => typeof t === "string" && !t.startsWith("pq:"));
}

/** Lower-cased, de-duplicated set of tags to exclude (for case-insensitive
 *  matching against a paper's tags). */
export function excludedTagSet(tags) {
  return new Set((tags || []).map((t) => String(t).toLowerCase()));
}

/** True if a paper carries any of the excluded tags (case-insensitive). */
export function hasExcludedTag(paperTags, excludedLowerSet) {
  if (!excludedLowerSet || !excludedLowerSet.size) return false;
  return (paperTags || []).some((t) => excludedLowerSet.has(String(t).toLowerCase()));
}

/** Drops candidate items that carry any excluded tag. Each item is expected to
 *  expose a `tags` array. */
export function filterExcluded(items, excludedTags) {
  const set = excludedTagSet(excludedTags);
  if (!set.size) return items.slice();
  return items.filter((it) => !hasExcludedTag(it.tags, set));
}

/** Compact one-line description of an item's user tags, or "" if none. */
function tagSuffix(tags) {
  const t = userTags(tags);
  return t.length ? ` · tags: ${t.join(", ")}` : "";
}

/**
 * Builds the chat messages for reordering a queue. Papers carry their user tags
 * so the model can group by topic as well as by author/chronology.
 * @param {{label:string, papers:{key:string,title:string,authorLine:string,year:string,tags:string[]}[]}} opts
 */
export function buildReorderMessages({ label, papers }) {
  const listText = papers
    .map(
      (p, i) =>
        `${i + 1}. [${p.key}] ${p.title}` +
        `${p.authorLine ? ` — ${p.authorLine}` : ""}${p.year ? ` (${p.year})` : ""}` +
        tagSuffix(p.tags)
    )
    .join("\n");

  return [
    {
      role: "system",
      content:
        `You are PaperQueue's reading assistant. The user wants to reorder their ${label}.\n\n` +
        `${PQ_TAG_LEGEND}\n\n` +
        `Current queue (each line is: number. [key] title — authors (year) · tags):\n${listText}\n\n` +
        `Return ONLY a JSON array containing EXACTLY the keys above in the new reading order. ` +
        `Group related papers together by topic (use the tags), method, author lineage, and chronology. ` +
        `Do not add, remove, or invent keys. Output must be valid JSON inside a markdown code block, like:\n\n` +
        "```json\n[\"KEY1\", \"KEY2\", \"KEY3\"]\n```",
    },
    { role: "user", content: `Order my ${label} so related papers sit together.` },
  ];
}

/**
 * Builds the chat messages for suggesting additions. Candidates carry their user
 * tags; the current queue is summarised (titles + tags) so the model suggests
 * complementary papers. Excluded tags are stated for transparency even though
 * the caller also hard-filters candidates that carry them.
 * @param {{count:number, candidates:{key:string,title:string,authors:string,year:string,tags:string[]}[], queueContext?:{title:string,tags:string[]}[], excludedTags?:string[]}} opts
 */
export function buildSuggestMessages({ count, candidates, queueContext = [], excludedTags = [] }) {
  const candidateText = candidates
    .map(
      (it) =>
        `- [${it.key}] ${it.title}` +
        `${it.authors ? ` — ${it.authors}` : ""}${it.year ? ` (${it.year})` : ""}` +
        tagSuffix(it.tags)
    )
    .join("\n");

  const queueText = queueContext.length
    ? queueContext
        .map((p) => `- ${p.title}${tagSuffix(p.tags)}`)
        .join("\n")
    : "(the queue is currently empty)";

  const excludeLine = excludedTags.length
    ? `\n\nThe user does NOT want papers about these tags — never suggest an item carrying any of them: ${excludedTags.join(", ")}.`
    : "";

  return [
    {
      role: "system",
      content:
        `You are PaperQueue's reading assistant. Suggest up to ${count} papers from the Candidate items below to add to the user's reading queue. ` +
        `Choose items that complement what's already queued (similar or adjacent topics, methods, authors).\n\n` +
        `${PQ_TAG_LEGEND}${excludeLine}\n\n` +
        `Current reading queue (for context — titles and the user's tags):\n${queueText}\n\n` +
        `Candidate items (each line is: - [key] title — authors (year) · tags):\n${candidateText}\n\n` +
        `Return ONLY a JSON array of objects with keys \`key\`, \`title\`, and \`reason\`. ` +
        `Every \`key\` must come from the Candidate items. Do not include items already in the queue. ` +
        `Output must be valid JSON inside a markdown code block, like:\n\n` +
        "```json\n[\n  {\"key\": \"KEY1\", \"title\": \"Title 1\", \"reason\": \"Short reason\"}\n]\n```",
    },
    { role: "user", content: "Recommend papers to add to my reading queue." },
  ];
}
