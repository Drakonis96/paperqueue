// PaperQueue — AI assistant (web edition). A floating chat that can take two
// concrete, always-confirmed, always-undoable actions on the reading queue:
//
//   1. Suggest papers from one or more "context" collections to add to the queue
//      (propose_queue_additions). The user confirms which suggestions to add.
//   2. Reorder the current queue by topical/author/chronological affinity
//      (reorder_queue). The user applies the proposed order.
//
// The browser never holds a provider key — every call goes through the server,
// which attaches the key from its environment. This module owns its own DOM
// (a FAB + panel appended to <body>), so the main app's full re-render never
// wipes the conversation.

import { authorLine, DEFAULT_QUEUE } from "./store.js";

// ---------------------------------------------------------------------------
// Tiny inline icons (stroke = currentColor)
// ---------------------------------------------------------------------------
const SVG = {
  spark:
    '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  undo: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  sort: '<polyline points="3 16 7 20 11 16"/><line x1="7" y1="20" x2="7" y2="4"/><polyline points="21 8 17 4 13 8"/><line x1="17" y1="4" x2="17" y2="20"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
};
function I(name, size = 18) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SVG[name] || ""}</svg>`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---------------------------------------------------------------------------
// Tool schemas + system prompt
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    type: "function",
    function: {
      name: "propose_queue_additions",
      description:
        "Propose papers from the provided Context items to add to the reading queue. The user will confirm which ones to add. Use ONLY keys that appear in Context items.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            description: "The papers you propose adding, best first.",
            items: {
              type: "object",
              properties: {
                key: { type: "string", description: "The exact item key from Context items." },
                title: { type: "string", description: "The item title (for display)." },
                reason: { type: "string", description: "One short sentence on why it fits the request." },
              },
              required: ["key", "reason"],
            },
          },
          note: { type: "string", description: "Optional one-line summary shown above the suggestions." },
        },
        required: ["items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reorder_queue",
      description:
        "Return a new order for the current queue. `order` MUST be a permutation of EXACTLY the queue keys you were given — same set, nothing added or removed.",
      parameters: {
        type: "object",
        properties: {
          order: {
            type: "array",
            items: { type: "string" },
            description: "Every queue key, in the new reading order.",
          },
          rationale: { type: "string", description: "Short explanation of the grouping logic." },
        },
        required: ["order"],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are PaperQueue's reading assistant. PaperQueue turns a Zotero library into a focused reading queue.

You can take exactly TWO actions, and ONLY by calling the matching tool. Do NOT answer with plain text when the user asks for additions or reordering — always call the appropriate tool.
1. propose_queue_additions — when the user asks to add, suggest, recommend, or pick papers for their queue. Choose only from the "Context items" the app gives you, matching each item by its exact \`key\`. Propose at most the number of items the user asked for (default 5 if they don't say). Give one short reason per item. NEVER invent keys or titles, and never include an item that isn't in Context items.
2. reorder_queue — when the user asks to order, sort, organise, or reorder the queue. Return \`order\` as a permutation of EXACTLY the queue keys you were given (the same set — none added, none removed), arranged so related papers sit together: by topic, then method, then author lineage, then chronology. Include a brief rationale.

Rules:
- You never change anything yourself. The app applies a change only after the user confirms it in the UI, and every change can be undone. Never claim you added or reordered anything — the UI will show the proposal.
- If the user asks you to add papers and also wants you to confirm, still call propose_queue_additions; the app will display the suggestions for the user to confirm.
- If you lack the context you need (e.g. no Context items were provided but the user wants additions), ask them to pick the collection(s) first.
- For anything else, reply normally and concisely. You may discuss the papers you have been given.`;

const MAX_CONTEXT_ITEMS = 200;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let store = null;
let api = null;
let toast = (m) => console.log(m);

const state = {
  open: false,
  messages: [], // { role, content } — text transcript sent to the model
  busy: false,
  abort: null,
  contextCollections: [], // [{ key, name }]
  collectionsCache: new Map(), // key -> [{ key, title, authors, year }]
};

let elFab, elPanel, elMessages, elComposer, elTextarea, elSendBtn, elModelSel, elContextBar;
const actions = new Map(); // actionId -> { type, ... } for confirm/undo buttons
let actionSeq = 0;

// ---------------------------------------------------------------------------
// Public init
// ---------------------------------------------------------------------------
export function initAi(opts) {
  store = opts.store;
  api = opts.api;
  if (opts.toast) toast = opts.toast;
  mount();
  // Keep the FAB visibility + model selector in sync with settings/config.
  store.subscribe(syncAvailability);
  syncAvailability();
  return {
    open: openPanel,
    close: closePanel,
    toggle: togglePanel,
    startReorder,
    syncAvailability,
  };
}

function aiReady() {
  return !!(store.config.connected && store.config.ai);
}

function syncAvailability() {
  if (!elFab) return;
  elFab.style.display = aiReady() ? "" : "none";
  if (state.open) {
    rebuildModelSelector();
    renderContextBar();
    updateComposerState();
  }
}

// ---------------------------------------------------------------------------
// Mount DOM
// ---------------------------------------------------------------------------
function mount() {
  elFab = document.createElement("button");
  elFab.className = "fab-chat";
  elFab.setAttribute("aria-label", "AI assistant");
  elFab.title = "AI assistant";
  elFab.innerHTML = I("spark", 24);
  elFab.addEventListener("click", togglePanel);
  document.body.appendChild(elFab);

  elPanel = document.createElement("div");
  elPanel.className = "ai-panel";
  elPanel.hidden = true;
  elPanel.innerHTML = `
    <div class="ai-head">
      <div class="ai-brand">${I("spark", 16)} <span>Assistant</span></div>
      <select class="ai-model" title="Model"></select>
      <div class="ai-head-actions">
        <button class="ai-icon" data-ai-act="context" title="Context collections">${I("layers", 16)}</button>
        <button class="ai-icon" data-ai-act="clear" title="New chat">${I("plus", 16)}</button>
        <button class="ai-icon" data-ai-act="close" title="Close">${I("x", 16)}</button>
      </div>
    </div>
    <div class="ai-context-bar"></div>
    <div class="ai-messages"></div>
    <div class="ai-composer">
      <textarea rows="1" placeholder="Ask, or pick a collection and say “add 5 papers about…”"></textarea>
      <button class="ai-send" data-ai-act="send">${I("send", 18)}</button>
    </div>`;
  document.body.appendChild(elPanel);

  elMessages = elPanel.querySelector(".ai-messages");
  elComposer = elPanel.querySelector(".ai-composer");
  elTextarea = elPanel.querySelector("textarea");
  elSendBtn = elPanel.querySelector(".ai-send");
  elModelSel = elPanel.querySelector(".ai-model");
  elContextBar = elPanel.querySelector(".ai-context-bar");

  elPanel.addEventListener("click", onPanelClick);
  elModelSel.addEventListener("change", onModelChange);
  elTextarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSendOrStop();
    }
  });
  elTextarea.addEventListener("input", autoGrow);
}

function autoGrow() {
  elTextarea.style.height = "auto";
  elTextarea.style.height = Math.min(elTextarea.scrollHeight, 140) + "px";
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------
function openPanel() {
  if (!aiReady()) return;
  state.open = true;
  elPanel.hidden = false;
  elFab.classList.add("active");
  rebuildModelSelector();
  renderContextBar();
  updateComposerState();
  if (!state.messages.length && !elMessages.children.length) renderEmptyState();
  setTimeout(() => elTextarea.focus(), 30);
}
function closePanel() {
  state.open = false;
  elPanel.hidden = true;
  elFab.classList.remove("active");
}
function togglePanel() {
  state.open ? closePanel() : openPanel();
}

// ---------------------------------------------------------------------------
// Model selector (from favourites)
// ---------------------------------------------------------------------------
function rebuildModelSelector() {
  const favs = store.settings.aiFavorites || [];
  if (!favs.length) {
    elModelSel.innerHTML = `<option value="">No favourite models</option>`;
    elModelSel.disabled = true;
    return;
  }
  elModelSel.disabled = false;
  const cur = currentSelection();
  elModelSel.innerHTML = favs
    .map((f) => {
      const val = `${f.provider}::${f.model}`;
      const sel = cur && cur.provider === f.provider && cur.model === f.model ? "selected" : "";
      return `<option value="${esc(val)}" ${sel}>${esc(providerLabel(f.provider))} · ${esc(f.model)}</option>`;
    })
    .join("");
}
function providerLabel(id) {
  return { openai: "OpenAI", openrouter: "OpenRouter", deepseek: "DeepSeek", custom: "Custom" }[id] || id;
}
function currentSelection() {
  const favs = store.settings.aiFavorites || [];
  const d = store.settings.aiDefault;
  if (d && favs.some((f) => f.provider === d.provider && f.model === d.model)) return d;
  return favs[0] || null;
}
function onModelChange() {
  const [provider, ...rest] = elModelSel.value.split("::");
  const model = rest.join("::");
  if (provider && model) store.setAiDefault(provider, model);
}

// ---------------------------------------------------------------------------
// Context collections
// ---------------------------------------------------------------------------
function renderContextBar() {
  if (!state.contextCollections.length) {
    elContextBar.innerHTML = `<span class="ai-context-empty">${I("layers", 13)} No context — tap the layers icon to pick collections the assistant can suggest from.</span>`;
    return;
  }
  elContextBar.innerHTML =
    `<span class="ai-context-label">Context:</span>` +
    state.contextCollections
      .map(
        (c, i) =>
          `<button class="ai-chip" data-ai-act="ctxRemove" data-ai-i="${i}">${esc(c.name)} ${I("x", 12)}</button>`
      )
      .join("");
}

async function openContextPicker() {
  let collections = [];
  try {
    collections = await api.collections();
  } catch {
    toast("Couldn't load collections", "error");
    return;
  }
  const selected = new Set(state.contextCollections.map((c) => c.key));

  // Build a tree from the flat list using parent references, sorted A-Z.
  const map = new Map();
  const roots = [];
  const sortByName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  for (const c of collections) {
    map.set(c.key, { ...c, children: [] });
  }
  for (const c of map.values()) {
    if (c.parent && map.has(c.parent)) {
      map.get(c.parent).children.push(c);
    } else {
      roots.push(c);
    }
  }
  for (const c of map.values()) c.children.sort(sortByName);
  roots.sort(sortByName);

  function renderTree(nodes, depth) {
    return nodes
      .map((c) => {
        const hasChildren = c.children && c.children.length > 0;
        const indent = depth * 18;
        const toggleHtml = hasChildren
          ? `<span class="ai-tree-toggle" data-expanded="0">▶</span>`
          : `<span class="ai-tree-toggle" style="visibility:hidden">▶</span>`;
        return (
          `<div class="ai-tree-node">` +
          `<div class="ai-tree-row" style="padding-left:${indent}px">${toggleHtml}<label class="ai-pick-row"><input type="checkbox" value="${esc(c.key)}" data-name="${esc(c.name)}" ${selected.has(c.key) ? "checked" : ""}/> ${esc(c.name)}</label></div>` +
          (hasChildren ? `<div class="ai-tree-children" hidden>${renderTree(c.children, depth + 1)}</div>` : "") +
          `</div>`
        );
      })
      .join("");
  }

  const body = collections.length
    ? renderTree(roots, 0)
    : `<div class="ai-muted">No collections in this library.</div>`;
  openMiniModal(
    "Context collections",
    `<div class="ai-muted" style="margin-bottom:10px">Pick the collection(s) the assistant may suggest papers from.</div><div class="ai-pick-list">${body}</div>`,
    (root) => {
      const picked = [...root.querySelectorAll('input[type="checkbox"]:checked')].map((cb) => ({
        key: cb.value,
        name: cb.dataset.name,
      }));
      state.contextCollections = picked;
      renderContextBar();
    }
  );
}

/** Fetches + caches the items of a collection (including subcollections recursively). */
async function collectionItems(key, _fetching = new Set()) {
  if (state.collectionsCache.has(key)) return state.collectionsCache.get(key);
  if (_fetching.has(key)) return []; // defensive cycle guard
  _fetching.add(key);
  const { items, subcollections } = await api.collection(key);
  const mapped = (items || []).map((it) => {
    const d = it.data || {};
    const names = (d.creators || [])
      .map((c) => c.lastName || c.name || "")
      .filter(Boolean);
    const year = (String(d.date || "").match(/\d{4}/) || [])[0] || "";
    return { key: d.key, title: d.title || "(untitled)", authors: names.slice(0, 3).join(", "), year };
  });
  if (subcollections && subcollections.length) {
    for (const sub of subcollections) {
      const subItems = await collectionItems(sub.key, _fetching);
      mapped.push(...subItems);
    }
  }
  state.collectionsCache.set(key, mapped);
  return mapped;
}

async function buildContextItems() {
  const seen = new Set();
  const out = [];
  for (const c of state.contextCollections) {
    let items = [];
    try {
      items = await collectionItems(c.key);
    } catch {
      continue;
    }
    for (const it of items) {
      if (!it.key || seen.has(it.key)) continue;
      seen.add(it.key);
      out.push(it);
      if (out.length >= MAX_CONTEXT_ITEMS) return out;
    }
  }
  return out;
}

function formatContextItems(items) {
  return items
    .map((it) => `- [${it.key}] ${it.title}${it.authors ? ` — ${it.authors}` : ""}${it.year ? ` (${it.year})` : ""}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Send / stop
// ---------------------------------------------------------------------------
function updateComposerState() {
  const favs = store.settings.aiFavorites || [];
  const hasModel = favs.length > 0;
  elTextarea.disabled = !hasModel || state.busy;
  if (!hasModel) {
    elTextarea.placeholder = "Add a model in Settings → AI assistant first.";
  } else {
    elTextarea.placeholder = "Ask, or pick a collection and say “add 5 papers about…”";
  }
  elSendBtn.innerHTML = state.busy ? I("stop", 18) : I("send", 18);
  elSendBtn.classList.toggle("stopping", state.busy);
  elSendBtn.dataset.aiAct = state.busy ? "stop" : "send";
}

function onSendOrStop() {
  if (state.busy) return stopGenerating();
  const text = elTextarea.value.trim();
  if (!text) return;
  elTextarea.value = "";
  autoGrow();
  sendUserMessage(text);
}

function stopGenerating() {
  if (state.abort) state.abort.abort();
}

async function sendUserMessage(text, { contextMode = "additions" } = {}) {
  const sel = currentSelection();
  if (!sel) {
    toast("Pick a model in Settings → AI assistant", "error");
    return;
  }
  removeEmptyState();
  addBubble("user", text);
  state.messages.push({ role: "user", content: text });

  await runTurn(sel, { contextMode });
}

/** Builds the message array (system + context + transcript) and streams a turn. */
async function runTurn(sel, { contextMode, forceReorder = false, queueItems = null } = {}) {
  let systemContent = SYSTEM_PROMPT;

  if (forceReorder && queueItems) {
    systemContent +=
      "\n\nCurrent queue (reorder must be a permutation of exactly these keys):\n" +
      queueItems
        .map((p) => `- [${p.key}] ${p.title}${p.authorLine ? ` — ${p.authorLine}` : ""}${p.year ? ` (${p.year})` : ""}`)
        .join("\n");
  } else if (state.contextCollections.length) {
    const items = await buildContextItems();
    if (items.length) {
      systemContent +=
        `\n\nContext items (the user selected ${state.contextCollections.map((c) => c.name).join(", ")}). ` +
        `Use these keys for propose_queue_additions:\n` +
        formatContextItems(items);
    }
  }
  const apiMessages = [{ role: "system", content: systemContent }];
  apiMessages.push(...state.messages);

  state.busy = true;
  state.abort = new AbortController();
  updateComposerState();
  const streamEl = addBubble("assistant", "");
  streamEl.classList.add("streaming");

  let textBuf = "";
  const toolAcc = {};
  let streamError = null;

  try {
    await api.aiChat(
      {
        provider: sel.provider,
        model: sel.model,
        messages: apiMessages,
        tools: TOOLS,
        tool_choice: forceReorder
          ? { type: "function", function: { name: "reorder_queue" } }
          : "auto",
        temperature: 0.2,
        signal: state.abort.signal,
      },
      (ev) => {
        if (ev.type === "delta") {
          const d = ev.delta || {};
          if (d.content) {
            textBuf += d.content;
            setBubbleText(streamEl, textBuf);
            scrollToBottom();
          }
          if (Array.isArray(d.tool_calls)) {
            for (const tc of d.tool_calls) {
              const i = tc.index ?? 0;
              toolAcc[i] = toolAcc[i] || { name: "", args: "" };
              if (tc.function?.name) toolAcc[i].name += tc.function.name;
              if (tc.function?.arguments) toolAcc[i].args += tc.function.arguments;
            }
          }
        } else if (ev.type === "error") {
          streamError = ev.error;
        }
      }
    );
  } catch (err) {
    if (err?.name === "AbortError") {
      textBuf += textBuf ? "\n\n[stopped]" : "[stopped]";
      setBubbleText(streamEl, textBuf);
    } else {
      streamError = err.message || "The assistant couldn't respond.";
    }
  }

  streamEl.classList.remove("streaming");
  const toolCalls = Object.values(toolAcc).filter((t) => t.name);

  if (streamError && !toolCalls.length && !textBuf) {
    setBubbleText(streamEl, "⚠ " + streamError);
    streamEl.classList.add("error");
  } else {
    if (textBuf && !toolCalls.length) {
      state.messages.push({ role: "assistant", content: textBuf });
    } else if (!toolCalls.length) {
      setBubbleText(streamEl, "(no response)");
    } else {
      // Tool-only turn: drop the empty text bubble.
      streamEl.remove();
    }
    for (const call of toolCalls) handleToolCall(call);
  }

  state.busy = false;
  state.abort = null;
  updateComposerState();
  scrollToBottom();
}

function handleToolCall(call) {
  let args = {};
  try {
    args = JSON.parse(call.args || "{}");
  } catch {
    addBubble("assistant", "The assistant proposed an action I couldn't read. Try rephrasing.").classList.add("error");
    console.error("AI tool_call parse error:", call.name, call.args);
    return;
  }
  if (call.name === "propose_queue_additions") renderAdditionsCard(args);
  else if (call.name === "reorder_queue") renderReorderCard(args);
  else console.warn("AI unknown tool_call:", call.name);
}

// ---------------------------------------------------------------------------
// Action: queue additions
// ---------------------------------------------------------------------------
function renderAdditionsCard(args) {
  const proposed = Array.isArray(args.items) ? args.items : [];
  // Keep only items we actually have, and tell the model what we did via transcript.
  const rows = proposed
    .map((it) => {
      const p = store.papers.get(it.key);
      if (!p) return null;
      return { key: it.key, paper: p, reason: it.reason || "", already: !!p.isPending };
    })
    .filter(Boolean);

  if (!rows.length) {
    const msg = proposed.length
      ? `The assistant suggested ${proposed.length} item(s), but none matched your library. Try refreshing the library or picking a different context collection.`
      : "The assistant didn't suggest any items. Try picking a context collection first.";
    addBubble("assistant", msg).classList.add("error");
    state.messages.push({ role: "assistant", content: "(No matching items found for the suggestion.)" });
    return;
  }

  const id = ++actionSeq;
  actions.set(id, { type: "add", rows });

  const note = args.note ? `<div class="ai-card-note">${esc(args.note)}</div>` : "";
  const list = rows
    .map((r, i) => {
      const disabled = r.already ? "disabled" : "checked";
      return `<label class="ai-sugg-row ${r.already ? "in-queue" : ""}">
        <input type="checkbox" data-i="${i}" ${disabled} />
        <span class="ai-sugg-body">
          <span class="ai-sugg-title">${esc(r.paper.title)}</span>
          <span class="ai-sugg-meta">${esc(authorLine(r.paper))}${r.reason ? ` · ${esc(r.reason)}` : ""}</span>
          ${r.already ? `<span class="ai-sugg-flag">already in queue</span>` : ""}
        </span>
      </label>`;
    })
    .join("");

  const card = document.createElement("div");
  card.className = "ai-card";
  card.dataset.aiId = String(id);
  card.innerHTML = `
    <div class="ai-card-head">${I("plus", 15)} Suggested for your queue</div>
    ${note}
    <div class="ai-sugg-list">${list}</div>
    <div class="ai-card-foot">
      <button class="ai-btn primary" data-ai-act="addConfirm" data-ai-id="${id}">Add selected</button>
      <button class="ai-btn" data-ai-act="dismissCard" data-ai-id="${id}">Dismiss</button>
    </div>`;
  elMessages.appendChild(card);
  scrollToBottom();
}

function confirmAdditions(id) {
  const card = elMessages.querySelector(`.ai-card[data-ai-id="${id}"]`);
  const action = actions.get(id);
  if (!card || !action) return;
  const checks = [...card.querySelectorAll('input[type="checkbox"]')];
  // Re-resolve fresh paper objects by key (live-sync may have replaced them),
  // and skip anything already queued in the meantime.
  const chosen = action.rows
    .filter((_, i) => checks[i] && checks[i].checked)
    .map((r) => ({ ...r, paper: store.papers.get(r.key) }))
    .filter((r) => r.paper && !r.paper.isPending);
  if (!chosen.length) {
    toast("Nothing to add", "error");
    return;
  }
  const keys = chosen.map((r) => r.key);
  const snapshot = store.captureTags(keys);
  for (const r of chosen) store.addToQueue(r.paper, DEFAULT_QUEUE);

  state.messages.push({
    role: "assistant",
    content: `(Added ${chosen.length} item(s) to the queue: ${chosen.map((r) => r.paper.title).join("; ")}.)`,
  });

  card.querySelectorAll("input,button").forEach((el) => (el.disabled = true));
  card.classList.add("done");
  const foot = card.querySelector(".ai-card-foot");
  foot.innerHTML = `<span class="ai-done-label">${I("check", 15)} Added ${chosen.length} to queue</span>
    <button class="ai-btn" data-ai-act="undo" data-ai-id="${id}">${I("undo", 14)} Undo</button>`;
  actions.set(id, { ...action, type: "add", snapshot });
  toast(`Added ${chosen.length} to queue`, "success");
  scrollToBottom();
}

// ---------------------------------------------------------------------------
// Action: reorder
// ---------------------------------------------------------------------------
function renderReorderCard(args) {
  const pending = store.pendingInQueue(store.activeQueue);
  const byKey = new Map(pending.map((p) => [p.key, p]));
  const given = Array.isArray(args.order) ? args.order : [];

  // Reconcile: keep the proposed order for keys we know, append any the model
  // dropped (so we never silently lose a queued paper).
  const ordered = [];
  const used = new Set();
  for (const k of given) {
    if (byKey.has(k) && !used.has(k)) {
      ordered.push(byKey.get(k));
      used.add(k);
    }
  }
  let adjusted = false;
  for (const p of pending) {
    if (!used.has(p.key)) {
      ordered.push(p);
      adjusted = true;
    }
  }

  if (ordered.length < 2) {
    addBubble("assistant", "There aren't enough papers in this queue to reorder.").classList.add("error");
    return;
  }

  const id = ++actionSeq;
  // Store keys, not paper objects: live-sync can replace the objects in
  // store.papers between proposing and applying, so we re-resolve by key.
  actions.set(id, { type: "reorder", keys: ordered.map((p) => p.key) });

  const rationale = args.rationale ? `<div class="ai-card-note">${esc(args.rationale)}</div>` : "";
  const list = ordered
    .map(
      (p, i) =>
        `<div class="ai-order-row"><span class="ai-order-n">${i + 1}</span><span class="ai-sugg-body"><span class="ai-sugg-title">${esc(p.title)}</span><span class="ai-sugg-meta">${esc(authorLine(p))}</span></span></div>`
    )
    .join("");

  const card = document.createElement("div");
  card.className = "ai-card";
  card.dataset.aiId = String(id);
  card.innerHTML = `
    <div class="ai-card-head">${I("sort", 15)} Proposed order</div>
    ${rationale}
    ${adjusted ? `<div class="ai-card-warn">Adjusted to keep every queued paper.</div>` : ""}
    <div class="ai-order-list">${list}</div>
    <div class="ai-card-foot">
      <button class="ai-btn primary" data-ai-act="reorderApply" data-ai-id="${id}">Apply order</button>
      <button class="ai-btn" data-ai-act="dismissCard" data-ai-id="${id}">Dismiss</button>
    </div>`;
  elMessages.appendChild(card);
  scrollToBottom();
}

function applyReorder(id) {
  const card = elMessages.querySelector(`.ai-card[data-ai-id="${id}"]`);
  const action = actions.get(id);
  if (!card || !action) return;
  // Re-resolve fresh paper objects from the store (see renderReorderCard).
  const ordered = action.keys.map((k) => store.papers.get(k)).filter(Boolean);
  if (ordered.length < 2) {
    toast("This queue changed — reorder no longer applies", "error");
    return;
  }
  const keys = ordered.map((p) => p.key);
  const snapshot = store.captureTags(keys);
  store.reorderPending(ordered);

  state.messages.push({ role: "assistant", content: "(Applied the proposed queue order.)" });

  card.classList.add("done");
  const foot = card.querySelector(".ai-card-foot");
  foot.innerHTML = `<span class="ai-done-label">${I("check", 15)} Order applied</span>
    <button class="ai-btn" data-ai-act="undo" data-ai-id="${id}">${I("undo", 14)} Undo</button>`;
  actions.set(id, { ...action, snapshot });
  toast("Queue reordered", "success");
}

function undoAction(id) {
  const action = actions.get(id);
  if (!action || !action.snapshot) return;
  store.restoreTags(action.snapshot);
  const card = elMessages.querySelector(`.ai-card[data-ai-id="${id}"]`);
  if (card) {
    const foot = card.querySelector(".ai-card-foot");
    if (foot) foot.innerHTML = `<span class="ai-done-label muted">${I("undo", 14)} Reverted</span>`;
    card.classList.add("reverted");
  }
  state.messages.push({ role: "assistant", content: "(The user undid the previous action.)" });
  toast("Reverted", "success");
}

// ---------------------------------------------------------------------------
// Entry: "Order with AI" button (from the Queue toolbar)
// ---------------------------------------------------------------------------
async function startReorder() {
  if (!aiReady()) return;
  const sel = currentSelection();
  if (!sel) {
    toast("Pick a model in Settings → AI assistant", "error");
    openPanel();
    return;
  }
  const pending = store.pendingInQueue(store.activeQueue);
  if (pending.length < 2) {
    toast("Add at least two papers to reorder", "error");
    return;
  }
  openPanel();
  removeEmptyState();
  const label = store.activeQueue === DEFAULT_QUEUE ? "reading queue" : `“${store.activeQueue}” queue`;
  addBubble("user", `Order my ${label} so related papers sit together.`);
  state.messages.push({ role: "user", content: `Order my ${label} so related papers are grouped together by topic and method.` });

  const queueItems = pending.map((p) => ({
    key: p.key,
    title: p.title,
    authorLine: authorLine(p),
    year: p.year || "",
  }));
  await runTurn(sel, { forceReorder: true, queueItems });
}

// ---------------------------------------------------------------------------
// Panel click delegation
// ---------------------------------------------------------------------------
function onPanelClick(e) {
  const btn = e.target.closest("[data-ai-act]");
  if (!btn) return;
  const act = btn.dataset.aiAct;
  const id = btn.dataset.aiId ? Number(btn.dataset.aiId) : null;
  switch (act) {
    case "close":
      return closePanel();
    case "clear":
      return clearChat();
    case "context":
      return openContextPicker();
    case "ctxRemove": {
      const i = Number(btn.dataset.aiI);
      state.contextCollections.splice(i, 1);
      state.collectionsCache.clear();
      return renderContextBar();
    }
    case "send":
    case "stop":
      return onSendOrStop();
    case "addConfirm":
      return confirmAdditions(id);
    case "reorderApply":
      return applyReorder(id);
    case "undo":
      return undoAction(id);
    case "dismissCard": {
      const card = elMessages.querySelector(`.ai-card[data-ai-id="${id}"]`);
      if (card) card.remove();
      actions.delete(id);
      return;
    }
    case "suggestPrompt":
      elTextarea.value = btn.dataset.aiPrompt || "";
      autoGrow();
      return elTextarea.focus();
  }
}

function clearChat() {
  if (state.busy) stopGenerating();
  state.messages = [];
  actions.clear();
  elMessages.innerHTML = "";
  renderEmptyState();
}

// ---------------------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------------------
function addBubble(role, text) {
  const el = document.createElement("div");
  el.className = `ai-msg ai-${role}`;
  setBubbleText(el, text);
  elMessages.appendChild(el);
  scrollToBottom();
  return el;
}
function setBubbleText(el, text) {
  el.textContent = text;
}
function scrollToBottom() {
  requestAnimationFrame(() => {
    elMessages.scrollTo({ top: elMessages.scrollHeight, behavior: "auto" });
  });
}

function renderEmptyState() {
  const prompts = [
    { label: "Add 5 papers from a collection", text: "Add 5 papers from my context collection about transformers." },
    { label: "Order my queue by topic", text: "Order my queue so related papers are grouped together." },
  ];
  const chips = prompts
    .map(
      (p) =>
        `<button class="ai-suggest" data-ai-act="suggestPrompt" data-ai-prompt="${esc(p.text)}">${esc(p.label)}</button>`
    )
    .join("");
  const el = document.createElement("div");
  el.className = "ai-empty";
  el.innerHTML = `
    <div class="ai-empty-ico">${I("spark", 26)}</div>
    <div class="ai-empty-title">Reading assistant</div>
    <div class="ai-empty-text">Pick context collections, then ask me to suggest papers — or reorder your queue. You confirm every change, and everything can be undone.</div>
    <div class="ai-suggests">${chips}</div>`;
  elMessages.appendChild(el);
}
function removeEmptyState() {
  elMessages.querySelector(".ai-empty")?.remove();
}

// ---------------------------------------------------------------------------
// Mini modal (context picker) — independent of the app's modal system
// ---------------------------------------------------------------------------
function openMiniModal(title, bodyHtml, onDone) {
  const back = document.createElement("div");
  back.className = "ai-mini-backdrop";
  back.innerHTML = `
    <div class="ai-mini">
      <div class="ai-mini-head"><h3>${esc(title)}</h3><button class="ai-icon" data-mini-close>${I("x", 16)}</button></div>
      <div class="ai-mini-body">${bodyHtml}</div>
      <div class="ai-mini-foot"><button class="ai-btn primary" data-mini-done>Done</button></div>
    </div>`;
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
    if (e.target === back || e.target.closest("[data-mini-close]")) close();
    else if (e.target.closest("[data-mini-done]")) {
      onDone?.(back);
      close();
    }
  });
  document.body.appendChild(back);
}
