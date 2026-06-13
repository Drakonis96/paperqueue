// PaperQueue — AI assistant (web edition), simplified modal-based flow.
//
// Two entry points, no persistent chat:
//   1. orderQueue()  → asks the model to return a JSON array of queue keys in
//                      the desired order; previewed in a modal; user applies.
//   2. addSuggestions() → user picks one or more collections; model returns a
//                         JSON array of suggested item keys; previewed in a
//                         modal; user selects which ones to add.
//
// The browser never holds a provider key — every call goes through the server.

import { authorLine, DEFAULT_QUEUE } from "./store.js";
import {
  buildReorderMessages,
  buildSuggestMessages,
  buildTopicMessages,
  filterExcluded,
  filterIncluded,
  ORDER_SCHEMA,
  SUGGEST_SCHEMA,
} from "./ai-prompt.js";

const SVG = {
  spark:
    '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  undo: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  sort: '<polyline points="3 16 7 20 11 16"/><line x1="7" y1="20" x2="7" y2="4"/><polyline points="21 8 17 4 13 8"/><line x1="17" y1="4" x2="17" y2="20"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
};
function I(name, size = 18) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SVG[name] || ""}</svg>`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

const MAX_CONTEXT_ITEMS = 300;

let store = null;
let api = null;
let toast = (m) => console.log(m);

let collectionsCache = new Map(); // collection key → items (recursive)

export function initAi(opts) {
  store = opts.store;
  api = opts.api;
  if (opts.toast) toast = opts.toast;
  return { orderQueue, addSuggestions, studyTopic };
}

function aiReady() {
  return !!(store.config.connected && store.config.ai);
}

function currentModel() {
  const favs = store.settings.aiFavorites || [];
  const d = store.settings.aiDefault;
  if (d && favs.some((f) => f.provider === d.provider && f.model === d.model)) return d;
  return favs[0] || null;
}

function providerLabel(id) {
  return { openai: "OpenAI", openrouter: "OpenRouter", deepseek: "DeepSeek", gemini: "Gemini", custom: "Custom" }[id] || id;
}

function modelSelectorHtml(id = "ai-model-select") {
  const favs = store.settings.aiFavorites || [];
  if (!favs.length) return `<span class="ai-muted">No favourite models</span>`;
  const d = store.settings.aiDefault;
  const options = favs
    .map((f) => {
      const val = `${f.provider}::${f.model}`;
      const sel = d && d.provider === f.provider && d.model === f.model ? "selected" : "";
      return `<option value="${esc(val)}" ${sel}>${esc(providerLabel(f.provider))} · ${esc(f.model)}</option>`;
    })
    .join("");
  return `<select id="${id}" class="ai-model-select">${options}</select>`;
}

function bindModelSelector(root, id = "ai-model-select") {
  const sel = root.querySelector(`#${id}`);
  if (!sel) return;
  sel.addEventListener("change", () => {
    const [provider, ...rest] = sel.value.split("::");
    const model = rest.join("::");
    if (provider && model) store.setAiDefault(provider, model);
  });
}

function currentModelFrom(root, id = "ai-model-select") {
  const sel = root?.querySelector(`#${id}`);
  if (sel) {
    const [provider, ...rest] = sel.value.split("::");
    const model = rest.join("::");
    if (provider && model) return { provider, model };
  }
  return currentModel();
}

// ---------------------------------------------------------------------------
// Generic non-streaming AI call
// ---------------------------------------------------------------------------

async function askAi(messages, { sel = currentModel(), temperature = 0.2, timeoutMs = 300000, responseSchema = null } = {}) {
  if (!sel) throw new Error("Pick a model in Settings → AI assistant.");
  const abort = new AbortController();
  // Cap the wait so a stuck request can't hang forever, but keep it generous —
  // reasoning models with a big context legitimately take a couple of minutes.
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, timeoutMs);
  let text = "";
  try {
    await api.aiChat(
      {
        provider: sel.provider,
        model: sel.model,
        messages,
        temperature,
        responseSchema,
        signal: abort.signal,
      },
      (ev) => {
        if (ev.type === "delta") {
          const d = ev.delta || {};
          if (d.content) text += d.content;
        } else if (ev.type === "error") {
          throw new Error(ev.error || "AI error");
        }
      }
    );
  } catch (err) {
    // A timeout (or any abort) surfaces from fetch as a raw "BodyStreamBuffer was
    // aborted" — translate it into something actionable.
    const aborted =
      err?.name === "AbortError" || /abort/i.test(err?.message || "");
    if (timedOut) {
      throw new Error(
        `The model took too long (over ${Math.round(timeoutMs / 1000)}s) and the request was cancelled. ` +
          `Try a faster model (e.g. gemini-2.5-flash) or pick fewer collections/items.`
      );
    }
    if (aborted) throw new Error("The AI request was cancelled.");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  return text;
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

function extractJson(text) {
  if (!text) return null;
  // Try fenced code block first.
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = block ? block[1].trim() : text.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // Fallback: find the first JSON array/object in the text.
    const arrayMatch = candidate.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch {
        /* ignore */
      }
    }
    const objMatch = candidate.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Collections tree (shared)
// ---------------------------------------------------------------------------

async function loadCollections() {
  const list = await api.collections();
  const sortByName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const map = new Map();
  const roots = [];
  for (const c of list) map.set(c.key, { ...c, children: [] });
  for (const c of map.values()) {
    if (c.parent && map.has(c.parent)) map.get(c.parent).children.push(c);
    else roots.push(c);
  }
  for (const c of map.values()) c.children.sort(sortByName);
  roots.sort(sortByName);
  return { roots, flat: list };
}

async function collectionItems(key, fetching = new Set()) {
  if (collectionsCache.has(key)) return collectionsCache.get(key);
  if (fetching.has(key)) return [];
  fetching.add(key);
  const { items, subcollections } = await api.collection(key);
  const mapped = (items || []).map((it) => {
    const d = it.data || {};
    const names = (d.creators || []).map((c) => c.lastName || c.name || "").filter(Boolean);
    return {
      key: d.key,
      title: d.title || "(untitled)",
      authors: names.slice(0, 3).join(", "),
      year: (String(d.date || "").match(/\d{4}/) || [])[0] || "",
      // Carry tags so the model can reason about topics and we can apply the
      // user's tag exclusions before sending anything.
      tags: (d.tags || []).map((t) => t.tag).filter(Boolean),
    };
  });
  // Fetch subcollections concurrently rather than one-at-a-time — a deep tree
  // used to serialise dozens of round-trips, which is what made "Suggest" drag.
  if (subcollections?.length) {
    const subResults = await Promise.all(
      subcollections.map((sub) => collectionItems(sub.key, fetching))
    );
    for (const subItems of subResults) mapped.push(...subItems);
  }
  collectionsCache.set(key, mapped);
  return mapped;
}

function renderCollectionTree(nodes, depth, selected) {
  return nodes
    .map((c) => {
      const hasChildren = c.children?.length > 0;
      const indent = depth * 18;
      const toggle = hasChildren
        ? `<span class="ai-tree-toggle" data-expanded="0">▶</span>`
        : `<span class="ai-tree-toggle" style="visibility:hidden">▶</span>`;
      return (
        `<div class="ai-tree-node">` +
        `<div class="ai-tree-row" style="padding-left:${indent}px">${toggle}` +
        `<label class="ai-pick-row"><input type="checkbox" value="${esc(c.key)}" data-name="${esc(c.name)}" ${selected.has(c.key) ? "checked" : ""}/> ${esc(c.name)}</label></div>` +
        (hasChildren ? `<div class="ai-tree-children" hidden>${renderCollectionTree(c.children, depth + 1, selected)}</div>` : "") +
        `</div>`
      );
    })
    .join("");
}

function openPickerModal(title, bodyHtml, onDone) {
  const back = document.createElement("div");
  back.className = "ai-mini-backdrop";
  back.innerHTML = `
    <div class="ai-mini">
      <div class="ai-mini-head"><h3>${esc(title)}</h3>${modelSelectorHtml()}</div>
      <div class="ai-mini-body">${bodyHtml}</div>
      <div class="ai-mini-foot"><button class="ai-btn primary" data-ai-done>Continue</button></div>
    </div>`;
  bindModelSelector(back);
  const close = () => back.remove();
  back.addEventListener("click", async (e) => {
    const toggle = e.target.closest(".ai-tree-toggle");
    if (toggle) {
      const node = toggle.closest(".ai-tree-node");
      const children = node.querySelector(":scope > .ai-tree-children");
      if (children) {
        const expanded = toggle.dataset.expanded === "1";
        toggle.dataset.expanded = expanded ? "0" : "1";
        toggle.textContent = expanded ? "▶" : "▼";
        children.hidden = expanded;
      }
      return;
    }
    if (e.target === back || e.target.closest("[data-ai-close]")) close();
    else if (e.target.closest("[data-ai-done]")) {
      const button = back.querySelector("[data-ai-done]");
      const originalLabel = button?.textContent;
      if (button) {
        button.disabled = true;
        button.textContent = "Working…";
      }
      try {
        const shouldClose = await onDone?.(back);
        if (shouldClose !== false) close();
      } finally {
        if (button?.isConnected) {
          button.disabled = false;
          button.textContent = originalLabel || "Continue";
        }
      }
    }
  });
  document.body.appendChild(back);
  return back;
}

function openPreviewModal(title, bodyHtml, onApply, onDismiss) {
  const back = document.createElement("div");
  back.className = "ai-mini-backdrop";
  back.innerHTML = `
    <div class="ai-mini ai-preview">
      <div class="ai-mini-head"><h3>${esc(title)}</h3><button class="ai-icon" data-ai-close>${I("x", 16)}</button></div>
      <div class="ai-mini-body">${bodyHtml}</div>
      <div class="ai-mini-foot">
        <button class="ai-btn primary" data-ai-apply>${I("check", 15)} Apply</button>
        <button class="ai-btn" data-ai-dismiss>${I("x", 15)} Dismiss</button>
      </div>
    </div>`;
  const close = () => back.remove();
  back.addEventListener("click", (e) => {
    if (e.target === back || e.target.closest("[data-ai-close]") || e.target.closest("[data-ai-dismiss]")) close();
    else if (e.target.closest("[data-ai-apply]")) {
      onApply?.();
      close();
    }
  });
  document.body.appendChild(back);
  return back;
}

function busyModal(title, message, { showElapsed = false } = {}) {
  const back = document.createElement("div");
  back.className = "ai-mini-backdrop";
  const elapsed = showElapsed
    ? `<div class="ai-busy-elapsed" style="color:var(--text-3);font-size:12px;margin-top:10px">0s</div>`
    : "";
  back.innerHTML = `<div class="ai-mini"><div class="ai-mini-body" style="text-align:center;padding:28px"><div class="ai-busy-icon">${I("spark", 32)}</div><div style="font-weight:700">${esc(title)}</div><div style="color:var(--text-2);font-size:13px;margin-top:6px">${esc(message)}</div>${elapsed}</div></div>`;
  document.body.appendChild(back);
  // A live elapsed counter reassures the user the request is still working
  // during a long generation (and hints that reasoning models are just slow).
  let timer = null;
  if (showElapsed) {
    const start = Date.now();
    const el = back.querySelector(".ai-busy-elapsed");
    timer = setInterval(() => {
      if (!el) return;
      const s = Math.round((Date.now() - start) / 1000);
      el.textContent = s < 20 ? `${s}s` : `${s}s · reasoning models can take a minute or two`;
    }, 1000);
  }
  return () => {
    if (timer) clearInterval(timer);
    back.remove();
  };
}

// ---------------------------------------------------------------------------
// Entry 1: order queue
// ---------------------------------------------------------------------------

export async function orderQueue() {
  if (!aiReady()) return;
  const defaultModel = currentModel();
  if (!defaultModel) {
    toast("Pick a model in Settings → AI assistant", "error");
    return;
  }
  const pending = store.pendingInActiveQueue();
  if (pending.length < 2) {
    toast("Add at least two papers to reorder", "error");
    return;
  }

  const confirmed = await new Promise((resolve) => {
    const selector = document.createElement("div");
    selector.innerHTML = modelSelectorHtml();
    const back = document.createElement("div");
    back.className = "ai-mini-backdrop";
    back.innerHTML = `
      <div class="ai-mini">
        <div class="ai-mini-head"><h3>Order with AI</h3></div>
        <div class="ai-mini-body">
          <div class="ai-muted" style="margin-bottom:12px">Choose the model to reorder <strong>${pending.length}</strong> papers.</div>
          ${selector.innerHTML}
        </div>
        <div class="ai-mini-foot">
          <button class="ai-btn primary" data-ai-confirm>Start</button>
          <button class="ai-btn" data-ai-cancel>Cancel</button>
        </div>
      </div>`;
    bindModelSelector(back);
    back.addEventListener("click", (e) => {
      if (e.target.closest("[data-ai-cancel]") || e.target === back) {
        back.remove();
        resolve(null);
      } else if (e.target.closest("[data-ai-confirm]")) {
        const sel = currentModelFrom(back);
        back.remove();
        resolve(sel);
      }
    });
    document.body.appendChild(back);
  });

  if (!confirmed) return;
  const sel = confirmed;

  const label = store.activeQueue === DEFAULT_QUEUE ? "reading queue" : `“${store.activeQueue}” queue`;
  const messages = buildReorderMessages({
    label,
    papers: pending.map((p) => ({
      key: p.key,
      title: p.title,
      authorLine: p.authors.length || p.editors.length ? authorLine(p) : "",
      year: p.year || "",
      tags: p.tags,
    })),
  });

  const done = busyModal("Ordering queue", `Asking ${providerLabel(sel.provider)} · ${sel.model}…`, { showElapsed: true });
  let raw = "";
  try {
    raw = await askAi(messages, { sel, responseSchema: ORDER_SCHEMA });
  } catch (err) {
    done();
    toast(err.message || "Couldn't order queue", "error");
    return;
  }
  done();

  // Structured outputs return { order: [...] }; tolerate a bare array too.
  const parsed = extractJson(raw);
  const order = Array.isArray(parsed) ? parsed : parsed?.order;
  if (!Array.isArray(order) || order.length !== pending.length || !order.every((k) => pending.some((p) => p.key === k))) {
    openPreviewModal(
      "Reorder failed",
      `<div class="ai-error">The assistant didn't return a valid reordering.</div><pre class="ai-raw">${esc(raw)}</pre>`,
      null,
      null
    );
    return;
  }

  const byKey = new Map(pending.map((p) => [p.key, p]));
  const ordered = order.map((k) => byKey.get(k)).filter(Boolean);

  const rows = ordered
    .map(
      (p, i) =>
        `<div class="ai-order-row"><span class="ai-order-n">${i + 1}</span><span class="ai-sugg-body"><span class="ai-sugg-title">${esc(p.title)}</span><span class="ai-sugg-meta">${esc(authorLine(p))}</span></span></div>`
    )
    .join("");

  openPreviewModal(
    "Proposed order",
    `<div class="ai-order-list" style="max-height:min(520px,60vh)">${rows}</div>`,
    () => {
      store.reorderPending(ordered);
      toast("Queue reordered", "success");
    },
    null
  );
}

// ---------------------------------------------------------------------------
// Entry 2: suggest additions from collections
// ---------------------------------------------------------------------------

export async function addSuggestions() {
  if (!aiReady()) return;
  if (!currentModel()) {
    toast("Pick a model in Settings → AI assistant", "error");
    return;
  }

  // Loading the full collection list can take a beat on big libraries — show a
  // spinner immediately so the button never feels frozen.
  const loading = busyModal("Suggest with AI", "Loading your collections…");
  let roots;
  try {
    ({ roots } = await loadCollections());
  } catch {
    loading();
    toast("Couldn't load collections", "error");
    return;
  }
  loading();

  const selected = new Set();
  const tree = roots.length
    ? renderCollectionTree(roots, 0, selected)
    : `<div class="ai-muted">No collections in this library.</div>`;

  // Optional tag filters: include = only candidates carrying a selected tag;
  // exclude = drop candidates carrying a selected tag (exclude wins). Both are
  // always shown (with an empty state) so they're discoverable, and the
  // collections list above is height-bounded so they stay visible.
  const tags = store.libraryTags();
  const chipCloud = (kind, attrName) =>
    tags.length
      ? `<div class="ai-xtags">${tags
          .map((t) => `<button type="button" class="ai-xtag ${kind}" ${attrName}="${esc(t)}">${esc(t)}</button>`)
          .join("")}</div>`
      : `<div class="ai-muted">No tags in your library yet.</div>`;

  const includeSection = `<div class="ai-include">
         <label class="ai-field-label">Only papers tagged (optional)</label>
         <div class="ai-muted" style="margin:2px 0 8px">Tap tags to suggest only papers carrying at least one of them.</div>
         ${chipCloud("inc", "data-itag")}
       </div>`;
  const excludeSection = `<div class="ai-exclude">
         <label class="ai-field-label">Exclude papers tagged (optional)</label>
         <div class="ai-muted" style="margin:2px 0 8px">Tap tags to drop any suggestion that carries them.</div>
         ${chipCloud("exc", "data-xtag")}
       </div>`;

  const modal = openPickerModal(
    "Suggest with AI",
    `<div class="ai-muted" style="margin-bottom:10px">Pick one or more collections to suggest papers from.</div>
     <div style="margin:0 0 12px">
       <label class="ai-field-label">Number of suggestions</label>
       <input type="number" class="ai-count-input" min="1" max="50" value="5" data-ai-count style="width:80px">
     </div>
     <label class="ai-field-label">Collections</label>
     <div class="ai-pick-list" style="max-height:210px;overflow-y:auto">${tree}</div>
     ${includeSection}
     ${excludeSection}`,
    async (root) => {
      const picked = [...root.querySelectorAll('.ai-pick-list input[type="checkbox"]:checked')].map((cb) => ({
        key: cb.value,
        name: cb.dataset.name,
      }));
      if (!picked.length) {
        toast("Pick at least one collection", "error");
        return false;
      }
      const sel = currentModelFrom(root);
      const countInput = root.querySelector("[data-ai-count]");
      const count = Math.max(1, Math.min(50, parseInt(countInput?.value || "5", 10)));
      const includedTags = [...root.querySelectorAll(".ai-include .ai-xtag.sel")].map((b) => b.dataset.itag);
      const excludedTags = [...root.querySelectorAll(".ai-exclude .ai-xtag.sel")].map((b) => b.dataset.xtag);
      await runSuggestions(sel, picked, count, excludedTags, includedTags);
      return true;
    }
  );

  // Toggle filter chips (the picker's own click handler ignores them).
  modal.addEventListener("click", (e) => {
    const chip = e.target.closest(".ai-xtag");
    if (chip) chip.classList.toggle("sel");
  });
}

// ---------------------------------------------------------------------------
// Entry 3: study a topic — suggest readings from collections to learn a topic
// ---------------------------------------------------------------------------

export async function studyTopic() {
  if (!aiReady()) return;
  if (!currentModel()) {
    toast("Pick a model in Settings → AI assistant", "error");
    return;
  }

  const loading = busyModal("Study a topic", "Loading your collections…");
  let roots;
  try {
    ({ roots } = await loadCollections());
  } catch {
    loading();
    toast("Couldn't load collections", "error");
    return;
  }
  loading();

  const selected = new Set();
  const tree = roots.length
    ? renderCollectionTree(roots, 0, selected)
    : `<div class="ai-muted">No collections in this library.</div>`;

  const tags = store.libraryTags();
  const chipCloud = (kind, attrName) =>
    tags.length
      ? `<div class="ai-xtags">${tags
          .map((t) => `<button type="button" class="ai-xtag ${kind}" ${attrName}="${esc(t)}">${esc(t)}</button>`)
          .join("")}</div>`
      : `<div class="ai-muted">No tags in your library yet.</div>`;

  const includeSection = `<div class="ai-include">
         <label class="ai-field-label">Only papers tagged (optional)</label>
         <div class="ai-muted" style="margin:2px 0 8px">Tap tags to consider only papers carrying at least one of them.</div>
         ${chipCloud("inc", "data-itag")}
       </div>`;
  const excludeSection = `<div class="ai-exclude">
         <label class="ai-field-label">Exclude papers tagged (optional)</label>
         <div class="ai-muted" style="margin:2px 0 8px">Tap tags to drop any suggestion that carries them.</div>
         ${chipCloud("exc", "data-xtag")}
       </div>`;

  const modal = openPickerModal(
    "Study a topic",
    `<div class="ai-muted" style="margin-bottom:10px">Tell the assistant what you want to study, then pick the collections to draw from. It suggests readings to go deeper, based on the titles.</div>
     <div style="margin:0 0 12px">
       <label class="ai-field-label">Topic to study</label>
       <input type="text" class="ai-topic-input" placeholder="e.g. diffusion models for image generation" data-ai-topic style="width:100%;box-sizing:border-box" autofocus>
     </div>
     <div style="margin:0 0 12px">
       <label class="ai-field-label">Number of suggestions</label>
       <input type="number" class="ai-count-input" min="1" max="50" value="5" data-ai-count style="width:80px">
     </div>
     <label class="ai-field-label">Collections</label>
     <div class="ai-pick-list" style="max-height:210px;overflow-y:auto">${tree}</div>
     ${includeSection}
     ${excludeSection}`,
    async (root) => {
      const topic = (root.querySelector("[data-ai-topic]")?.value || "").trim();
      if (!topic) {
        toast("Type a topic to study", "error");
        return false;
      }
      const picked = [...root.querySelectorAll('.ai-pick-list input[type="checkbox"]:checked')].map((cb) => ({
        key: cb.value,
        name: cb.dataset.name,
      }));
      if (!picked.length) {
        toast("Pick at least one collection", "error");
        return false;
      }
      const sel = currentModelFrom(root);
      const countInput = root.querySelector("[data-ai-count]");
      const count = Math.max(1, Math.min(50, parseInt(countInput?.value || "5", 10)));
      const includedTags = [...root.querySelectorAll(".ai-include .ai-xtag.sel")].map((b) => b.dataset.itag);
      const excludedTags = [...root.querySelectorAll(".ai-exclude .ai-xtag.sel")].map((b) => b.dataset.xtag);
      await runSuggestions(sel, picked, count, excludedTags, includedTags, topic);
      return true;
    }
  );

  modal.addEventListener("click", (e) => {
    const chip = e.target.closest(".ai-xtag");
    if (chip) chip.classList.toggle("sel");
  });
}

async function runSuggestions(sel, pickedCollections, count, excludedTags = [], includedTags = [], topic = "") {
  const studying = !!topic;
  const flowTitle = studying ? "Studying topic" : "Suggesting papers";
  let close = busyModal(flowTitle, "Reading the selected collections…");

  // Fetch every picked collection concurrently, then dedupe.
  let lists;
  try {
    lists = await Promise.all(
      pickedCollections.map((c) => collectionItems(c.key).catch(() => []))
    );
  } catch {
    close();
    toast("Couldn't read the selected collections", "error");
    return;
  }

  const seen = new Set();
  let contextItems = [];
  for (const items of lists) {
    for (const it of items) {
      if (!it.key || seen.has(it.key)) continue;
      seen.add(it.key);
      // Skip anything the user has already acted on (queued, read or skipped).
      const known = store.papers.get(it.key);
      if (known && (known.isPending || known.readStatus === "read" || known.readStatus === "skipped")) {
        continue;
      }
      contextItems.push(it);
    }
  }

  // Apply the user's tag filters before anything is sent to the model: keep only
  // papers carrying an included tag (if any), then drop excluded ones.
  contextItems = filterIncluded(contextItems, includedTags);
  contextItems = filterExcluded(contextItems, excludedTags).slice(0, MAX_CONTEXT_ITEMS);

  if (!contextItems.length) {
    close();
    toast(
      includedTags.length || excludedTags.length
        ? "No papers left after applying your tag filters"
        : "No new papers found in the selected collections",
      "error"
    );
    return;
  }

  // In topic mode the focus is the user's topic, so the queue isn't used as
  // context; in suggest mode we summarise the queue (titles + tags) so the model
  // recommends papers that complement what's already queued.
  const messages = studying
    ? buildTopicMessages({ topic, count, candidates: contextItems, excludedTags, includedTags })
    : buildSuggestMessages({
        count,
        candidates: contextItems,
        queueContext: store
          .pendingInActiveQueue()
          .slice(0, 40)
          .map((p) => ({ title: p.title, tags: p.tags })),
        excludedTags,
        includedTags,
      });

  // Swap the spinner message now that we're actually asking the model.
  close();
  close = busyModal(flowTitle, `Asking ${providerLabel(sel.provider)} · ${sel.model}…`, { showElapsed: true });
  let raw = "";
  try {
    raw = await askAi(messages, { sel, responseSchema: SUGGEST_SCHEMA });
  } catch (err) {
    close();
    toast(err.message || "Couldn't get suggestions", "error");
    return;
  }
  close();

  // Structured outputs return { suggestions: [...] }; tolerate a bare array too.
  const parsedRaw = extractJson(raw);
  const parsed = Array.isArray(parsedRaw) ? parsedRaw : parsedRaw?.suggestions;
  if (!Array.isArray(parsed) || !parsed.length) {
    openPreviewModal(
      "Suggestions failed",
      `<div class="ai-error">The assistant didn't return valid suggestions.</div><pre class="ai-raw">${esc(raw)}</pre>`,
      null,
      null
    );
    return;
  }

  const rows = parsed
    .map((it) => {
      const p = store.papers.get(it.key);
      if (!p) return null;
      return {
        key: it.key,
        paper: p,
        reason: it.reason || "",
        checked: true,
      };
    })
    .filter(Boolean);

  if (!rows.length) {
    openPreviewModal(
      "No matches",
      `<div class="ai-error">The assistant suggested ${parsed.length} item(s), but none matched your library.</div>`,
      null,
      null
    );
    return;
  }

  const list = rows
    .map(
      (r, i) =>
        `<label class="ai-sugg-row"><input type="checkbox" data-i="${i}" checked />` +
        `<span class="ai-sugg-body"><span class="ai-sugg-title">${esc(r.paper.title)}</span>` +
        `<span class="ai-sugg-meta">${esc(authorLine(r.paper))}${r.reason ? ` · ${esc(r.reason)}` : ""}</span></span></label>`
    )
    .join("");

  const modal = openPreviewModal(
    studying ? `Readings to study “${topic}” (${rows.length})` : `Suggested additions (${rows.length})`,
    `<div class="ai-sugg-list" style="max-height:min(520px,60vh)">${list}</div>`,
    () => {
      const checks = [...modal.querySelectorAll('input[type="checkbox"]')];
      const chosen = rows.filter((_, i) => checks[i]?.checked).map((r) => r.paper);
      if (!chosen.length) {
        toast("No items selected", "error");
        return;
      }
      for (const p of chosen) store.addToQueue(p, DEFAULT_QUEUE);
      toast(`Added ${chosen.length} to queue`, "success");
    },
    null
  );
}
