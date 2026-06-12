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
const MAX_ADD_SUGGESTIONS = 20;

let store = null;
let api = null;
let toast = (m) => console.log(m);

let collectionsCache = new Map(); // collection key → items (recursive)

export function initAi(opts) {
  store = opts.store;
  api = opts.api;
  if (opts.toast) toast = opts.toast;
  return { orderQueue, addSuggestions };
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
  return { openai: "OpenAI", openrouter: "OpenRouter", deepseek: "DeepSeek", custom: "Custom" }[id] || id;
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

async function askAi(messages, { sel = currentModel(), temperature = 0.2 } = {}) {
  if (!sel) throw new Error("Pick a model in Settings → AI assistant.");
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 120000); // 2 min max
  let text = "";
  try {
    await api.aiChat(
      {
        provider: sel.provider,
        model: sel.model,
        messages,
        temperature,
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
    };
  });
  if (subcollections?.length) {
    for (const sub of subcollections) {
      const subItems = await collectionItems(sub.key, fetching);
      mapped.push(...subItems);
    }
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
  back.addEventListener("click", (e) => {
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
      onDone?.(back);
      close();
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

function busyModal(title, message) {
  const back = document.createElement("div");
  back.className = "ai-mini-backdrop";
  back.innerHTML = `<div class="ai-mini"><div class="ai-mini-body" style="text-align:center;padding:28px"><div style="color:var(--accent);margin-bottom:10px">${I("spark", 32)}</div><div style="font-weight:700">${esc(title)}</div><div style="color:var(--text-2);font-size:13px;margin-top:6px">${esc(message)}</div></div></div>`;
  document.body.appendChild(back);
  return () => back.remove();
}

// ---------------------------------------------------------------------------
// Entry 1: order queue
// ---------------------------------------------------------------------------

export async function orderQueue() {
  if (!aiReady()) return;
  const sel = currentModel();
  if (!sel) {
    toast("Pick a model in Settings → AI assistant", "error");
    return;
  }
  const pending = store.pendingInActiveQueue();
  if (pending.length < 2) {
    toast("Add at least two papers to reorder", "error");
    return;
  }

  const label = store.activeQueue === DEFAULT_QUEUE ? "reading queue" : `“${store.activeQueue}” queue`;
  const listText = pending
    .map((p, i) => `${i + 1}. [${p.key}] ${p.title}${p.authors.length ? ` — ${authorLine(p)}` : ""}${p.year ? ` (${p.year})` : ""}`)
    .join("\n");

  const done = busyModal("Ordering queue", `Asking ${providerLabel(sel.provider)} · ${sel.model}…`);
  let raw = "";
  try {
    raw = await askAi([
      {
        role: "system",
        content:
          `You are PaperQueue's reading assistant. The user wants to reorder their ${label}.\n\n` +
          `Current queue (each line is: number. [key] title — authors (year)):\n${listText}\n\n` +
          `Return ONLY a JSON array containing EXACTLY the keys above in the new reading order. ` +
          `Group related papers together by topic, method, author lineage, and chronology. ` +
          `Do not add, remove, or invent keys. Output must be valid JSON inside a markdown code block, like:\n\n` +
          `\`\`\`json\n["KEY1", "KEY2", "KEY3"]\n\`\`\``,
      },
      { role: "user", content: `Order my ${label} so related papers sit together.` },
    ]);
  } catch (err) {
    done();
    toast(err.message || "Couldn't order queue", "error");
    return;
  }
  done();

  const order = extractJson(raw);
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

  let roots;
  try {
    ({ roots } = await loadCollections());
  } catch {
    toast("Couldn't load collections", "error");
    return;
  }

  const selected = new Set();
  const body = roots.length
    ? renderCollectionTree(roots, 0, selected)
    : `<div class="ai-muted">No collections in this library.</div>`;

  const modal = openPickerModal(
    "Choose collections",
    `<div class="ai-muted" style="margin-bottom:10px">Pick one or more collections to suggest papers from.</div><div class="ai-pick-list">${body}</div>`,
    async (root) => {
      const picked = [...root.querySelectorAll('input[type="checkbox"]:checked')].map((cb) => ({
        key: cb.value,
        name: cb.dataset.name,
      }));
      if (!picked.length) {
        toast("Pick at least one collection", "error");
        return;
      }
      const sel = currentModelFrom(modal);
      await runSuggestions(sel, picked);
    }
  );
}

async function runSuggestions(sel, pickedCollections) {
  const queuedKeys = new Set(store.pendingInActiveQueue().map((p) => p.key));
  const seen = new Set();
  const contextItems = [];
  for (const c of pickedCollections) {
    let items = [];
    try {
      items = await collectionItems(c.key);
    } catch {
      continue;
    }
    for (const it of items) {
      if (!it.key || seen.has(it.key) || queuedKeys.has(it.key)) continue;
      seen.add(it.key);
      contextItems.push(it);
      if (contextItems.length >= MAX_CONTEXT_ITEMS) break;
    }
    if (contextItems.length >= MAX_CONTEXT_ITEMS) break;
  }

  if (!contextItems.length) {
    toast("No new papers found in the selected collections", "error");
    return;
  }

  const listText = contextItems
    .map((it) => `- [${it.key}] ${it.title}${it.authors ? ` — ${it.authors}` : ""}${it.year ? ` (${it.year})` : ""}`)
    .join("\n");

  const done = busyModal("Suggesting papers", `Asking ${providerLabel(sel.provider)} · ${sel.model}…`);
  let raw = "";
  try {
    raw = await askAi([
      {
        role: "system",
        content:
          `You are PaperQueue's reading assistant. Suggest up to ${MAX_ADD_SUGGESTIONS} papers from the Context items below to add to the user's reading queue. ` +
          `Choose items that complement the current queue. Return ONLY a JSON array of objects with keys \`key\`, \`title\`, and \`reason\`. ` +
          `Every \`key\` must come from the Context items. Do not include items already in the queue. ` +
          `Output must be valid JSON inside a markdown code block, like:\n\n` +
          `\`\`\`json\n[\n  {"key": "KEY1", "title": "Title 1", "reason": "Short reason"}\n]\n\`\`\`\n\n` +
          `Context items:\n${listText}`,
      },
      { role: "user", content: "Recommend papers to add to my reading queue." },
    ], { sel });
  } catch (err) {
    done();
    toast(err.message || "Couldn't get suggestions", "error");
    return;
  }
  done();

  const parsed = extractJson(raw);
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
    `Suggested additions (${rows.length})`,
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
