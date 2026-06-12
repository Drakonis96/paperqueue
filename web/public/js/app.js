// PaperQueue — web edition UI controller. Renders the five tabs (Queue,
// Library, History, Stats, Settings) with the same actions and behaviour as the
// iOS/macOS apps: mark read, postpone, skip, reorder, multiple queues, filters,
// add-by-DOI, live sync. Vanilla JS + ES modules, no build step.

import { Store, authorLine, subtitle, POSTPONED_QUEUE } from "./store.js";
import { computeStats, dayStatus, dayKey, startOfDay } from "./stats.js";
import { api } from "./api.js";

// ---------------------------------------------------------------------------
// Icons (Feather-style, stroke = currentColor)
// ---------------------------------------------------------------------------
const ICONS = {
  queue: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  library: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  history: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/><polyline points="12 7 12 12 15 14"/>',
  stats: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  minusCircle: '<circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  plusCircle: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  uturn: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  sort: '<polyline points="3 16 7 20 11 16"/><line x1="7" y1="20" x2="7" y2="4"/><polyline points="21 8 17 4 13 8"/><line x1="17" y1="4" x2="17" y2="20"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  chevron: '<polyline points="6 9 12 15 18 9"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
  chevronUp: '<polyline points="18 15 12 9 6 15"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  grip: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  key: '<path d="M21 2l-2 2"/><path d="M11.39 11.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><polyline points="9 13 11 15 15 11"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/>',
};

function I(name, size = 20) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function attr(s) {
  return esc(s).replace(/`/g, "&#96;");
}

let toastTimer;
function toast(message, kind = "") {
  let host = $(".toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.innerHTML = `${kind === "error" ? I("info", 16) : kind === "success" ? I("check", 16) : ""}<span>${esc(message)}</span>`;
  host.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const store = new Store();
const ui = {
  tab: "queue",
  // Library
  search: "",
  filter: "all", // all | queue | unread | read
  sort: "recentlyAdded",
  collection: null,
  authors: new Set(),
  tags: new Set(),
  years: new Set(),
  collections: [], // cached flat list
  historySearch: "",
  historyRange: "all", // all | today | week | month | year | custom
  historyFrom: "", // YYYY-MM-DD (custom range)
  historyTo: "",
  // Stats calendar: first day of the displayed month (defaults to this month).
  calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
};

const TABS = [
  { id: "queue", title: "Queue", icon: "queue" },
  { id: "library", title: "Library", icon: "library" },
  { id: "history", title: "History", icon: "history" },
  { id: "stats", title: "Stats", icon: "stats" },
  { id: "settings", title: "Settings", icon: "settings" },
];

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
init();

async function init() {
  await store.loadConfig();
  store.subscribe(scheduleRender);
  render();

  if (store.config.connected) {
    await store.syncLibrary({ silent: store.papers.size > 0 });
    loadCollections();
    // Live updates: server pushes "changed" → cheap incremental resync.
    api.liveUpdates(() => store.syncLibrary({ silent: true }));
  }
  scheduleReminderCheck();
}

async function loadCollections() {
  try {
    ui.collections = await api.collections();
    scheduleRender();
  } catch {
    /* non-fatal */
  }
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  const app = $("#app");
  // Preserve focus + caret across re-render (search inputs).
  const active = document.activeElement;
  const focusId = active && active.id ? active.id : null;
  const selStart = focusId ? active.selectionStart : null;
  const selEnd = focusId ? active.selectionEnd : null;

  if (!store.config.connected) {
    app.innerHTML = setupScreen();
  } else {
    app.innerHTML = shell();
  }

  if (focusId) {
    const elNow = document.getElementById(focusId);
    if (elNow) {
      elNow.focus();
      try {
        elNow.setSelectionRange(selStart, selEnd);
      } catch {
        /* not a text input */
      }
    }
  }
  bindDynamic();
}

function shell() {
  // The nav badge tracks the main reading list (Default), not whatever queue is
  // open — postponed papers are deliberately set aside, not "to read now".
  const pendingCount = store.pendingInQueue("Default").length;
  const navButtons = (cls, withBadge) =>
    TABS.map((t) => {
      const badge =
        withBadge && t.id === "queue" && pendingCount > 0
          ? `<span class="${cls === "nav" ? "badge" : "mini-badge"}">${pendingCount}</span>`
          : "";
      return `<button data-act="nav:${t.id}" class="${ui.tab === t.id ? "active" : ""}">${I(t.icon)}<span>${t.title}</span>${badge}</button>`;
    }).join("");

  const live = store.config.connected && !store.config.demo
    ? `<span class="live-dot" title="Live sync with Zotero"></span>`
    : "";
  const demoPill = store.config.demo
    ? `<span class="demo-pill">${I("info", 13)} Demo library</span>`
    : "";

  return `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="logo">${I("layers", 20)}</div>
        <div>
          <div class="name">PaperQueue</div>
          <div class="tag">for the web</div>
        </div>
      </div>
      <nav class="nav">${navButtons("nav", true)}</nav>
      <div class="sidebar-footer">
        ${demoPill}
        <div style="display:flex;align-items:center;gap:7px">
          ${live}
          <span>${store.config.demo ? "Sample data" : esc(store.config.username || "Connected")}</span>
        </div>
        <span>v${esc(store.config.version || "1.0")} · syncs via Zotero tags</span>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div>
          <h1>${topTitle()}</h1>
          <div class="sub">${topSub()}</div>
        </div>
        <div class="spacer"></div>
        ${live}
        <button class="icon-btn ${store.isSyncing ? "spin" : ""}" data-act="sync" title="Sync now">${I("refresh", 18)}</button>
      </header>
      <div class="progress-bar"><i style="width:${store.isSyncing ? Math.round((store.syncProgress ?? 0.1) * 100) : 0}%"></i></div>
      <div class="content">${view()}</div>
    </main>
    <nav class="bottom-nav">${navButtons("bottom", true)}</nav>
    <button class="fab-top" data-act="scrollTop" aria-label="Scroll to top" title="Scroll to top">${I("chevronUp", 22)}</button>
  </div>`;
}

function topTitle() {
  switch (ui.tab) {
    case "queue":
      return esc(store.activeQueue === "Default" ? "Reading Queue" : store.activeQueue);
    case "library":
      return "Library";
    case "history":
      return "History";
    case "stats":
      return "Stats";
    case "settings":
      return "Settings";
  }
}
function topSub() {
  if (ui.tab === "queue") {
    const n = store.pendingInActiveQueue().length;
    if (store.activeQueue === POSTPONED_QUEUE)
      return n ? `${n} postponed` : "Nothing postponed";
    return n ? `${n} to read` : "Queue clear";
  }
  if (ui.tab === "library") return `${store.papers.size} items`;
  if (ui.tab === "history") return `${store.history().length} read`;
  return "";
}

function view() {
  switch (ui.tab) {
    case "queue":
      return queueView();
    case "library":
      return libraryView();
    case "history":
      return historyView();
    case "stats":
      return statsView();
    case "settings":
      return settingsView();
  }
}

// ---------------------------------------------------------------------------
// Paper row
// ---------------------------------------------------------------------------
function paperRow(p, { position, actions = "", draggable = false, showStatus = false, meta = null } = {}) {
  const pdf = p.pdfAttachmentKey ? "pdf" : "";
  const posBadge =
    position != null
      ? `<button class="pos-badge" data-act="movePos:${p.key}" title="Move to position">${position}</button>`
      : "";
  const sub = subtitle(p);
  let statusBadge = "";
  if (showStatus) {
    if (p.readStatus === "read")
      statusBadge = `<span class="check-icon">${I("checkCircle", 21)}</span>`;
    else if (p.readStatus === "skipped")
      statusBadge = `<span class="status-chip skipped">Skipped</span>`;
    else if (p.isPending)
      statusBadge = `<span class="status-chip queued">${p.queueName ? esc(p.queueName) : "In queue"} ✓</span>`;
  }
  return `
  <div class="row" ${draggable ? `draggable="true" data-key="${p.key}"` : ""}>
    <div class="lead ${pdf}">
      ${I("doc", 20)}
      ${posBadge}
    </div>
    <div class="body" data-act="open:${p.key}">
      <div class="title">${esc(p.title)}</div>
      <div class="meta">${esc(authorLine(p))}</div>
      ${sub ? `<div class="meta2">${esc(sub)}</div>` : ""}
      ${meta ? `<div class="meta2 read-meta">${I("clock", 12)} ${esc(meta)}</div>` : ""}
    </div>
    <div class="actions">${statusBadge}${actions}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Queue view
// ---------------------------------------------------------------------------
function queueView() {
  const papers = store.pendingInActiveQueue();
  const queueSelector = `
    <div class="toolbar">
      <button class="select" data-act="queueMenu" style="display:inline-flex;align-items:center;gap:8px">
        ${I("layers", 16)} ${esc(store.activeQueue)} ${I("chevron", 14)}
      </button>
      <div class="spacer" style="flex:1"></div>
    </div>`;

  const isPostponed = store.activeQueue === POSTPONED_QUEUE;

  if (!papers.length) {
    if (isPostponed) {
      return (
        queueSelector +
        empty("clock", "No postponed papers",
          "Papers you postpone land here and wait until you put them back in a queue.")
      );
    }
    return (
      queueSelector +
      empty("queue", "Queue clear", store.papers.size
        ? "Add papers from your library to build a reading queue."
        : "Sync your Zotero library, then add papers to your queue.", [
        `<button class="btn primary" data-act="nav:library">${I("library", 16)} Browse Library</button>`,
        `<button class="btn" data-act="sync">${I("refresh", 16)} Sync</button>`,
      ])
    );
  }

  const rows = papers
    .map((p, i) =>
      paperRow(p, {
        position: i + 1,
        draggable: true,
        actions: isPostponed
          ? `
          <button class="act green" data-act="markRead:${p.key}" title="Mark read">${I("check", 18)}</button>
          <button class="act accent" data-act="returnToQueue:${p.key}" title="Move back to reading queue">${I("uturn", 18)}</button>
          <button class="act" data-act="skip:${p.key}" title="Skip">${I("x", 18)}</button>
          <button class="act red" data-act="remove:${p.key}" title="Remove">${I("minusCircle", 18)}</button>
          <span class="act drag" title="Drag to reorder">${I("grip", 18)}</span>`
          : `
          <button class="act green" data-act="markRead:${p.key}" title="Mark read">${I("check", 18)}</button>
          <button class="act orange" data-act="postpone:${p.key}" title="Postpone">${I("clock", 18)}</button>
          <button class="act" data-act="skip:${p.key}" title="Skip">${I("x", 18)}</button>
          <button class="act red" data-act="remove:${p.key}" title="Remove from queue">${I("minusCircle", 18)}</button>
          <span class="act drag" title="Drag to reorder">${I("grip", 18)}</span>`,
      })
    )
    .join("");

  return (
    queueSelector +
    `<div class="list" id="queue-list">
      <div class="list-head">${papers.length} ${isPostponed ? "postponed" : "to read"} · drag the handle, or tap a number, to reorder</div>
      ${rows}
    </div>`
  );
}

// ---------------------------------------------------------------------------
// Library view
// ---------------------------------------------------------------------------
const SORTS = {
  recentlyAdded: "Recently added",
  oldestAdded: "Oldest added",
  titleAZ: "Title (A–Z)",
  authorAZ: "Author (A–Z)",
  yearNewest: "Year (newest)",
  yearOldest: "Year (oldest)",
};

function applySort(papers) {
  const arr = [...papers];
  switch (ui.sort) {
    case "recentlyAdded":
      return arr.sort((a, b) => (b.addedAt || "").localeCompare(a.addedAt || ""));
    case "oldestAdded":
      return arr.sort((a, b) => (a.addedAt || "~").localeCompare(b.addedAt || "~"));
    case "titleAZ":
      return arr.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    case "authorAZ":
      return arr.sort((a, b) => {
        const ca = (a.authors[0] || a.editors[0] || "~");
        const cb = (b.authors[0] || b.editors[0] || "~");
        const c = ca.localeCompare(cb, undefined, { sensitivity: "base" });
        return c !== 0 ? c : a.title.localeCompare(b.title);
      });
    case "yearNewest":
      return arr.sort((a, b) => (b.year || "").localeCompare(a.year || ""));
    case "yearOldest":
      return arr.sort((a, b) => (a.year || "~").localeCompare(b.year || "~"));
  }
  return arr;
}

function libraryFiltered() {
  let result = store.allPapers();
  switch (ui.filter) {
    case "queue":
      result = result.filter((p) => p.isPending);
      break;
    case "unread":
      result = result.filter((p) => p.readStatus === "unread" && !p.isPending);
      break;
    case "read":
      result = result.filter((p) => p.readStatus === "read");
      break;
  }
  if (ui.collection)
    result = result.filter((p) => (p.collectionKeys || []).includes(ui.collection));
  if (ui.authors.size)
    result = result.filter((p) => [...p.authors, ...p.editors].some((a) => ui.authors.has(a)));
  if (ui.tags.size) result = result.filter((p) => p.tags.some((t) => ui.tags.has(t)));
  if (ui.years.size) result = result.filter((p) => p.year && ui.years.has(p.year));
  if (ui.search) {
    const q = ui.search.toLowerCase();
    result = result.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        authorLine(p).toLowerCase().includes(q) ||
        (p.publicationTitle || "").toLowerCase().includes(q)
    );
  }
  return applySort(result);
}

function activeFilterCount() {
  let n = ui.authors.size + ui.tags.size + ui.years.size;
  if (ui.filter !== "all") n++;
  if (ui.collection) n++;
  return n;
}

function libraryView() {
  if (!store.papers.size) {
    return empty(
      "library",
      store.isSyncing ? "Loading library…" : "Empty library",
      store.isSyncing ? "Fetching your Zotero items…" : "Sync your Zotero library or add a paper by DOI.",
      store.isSyncing ? [] : [`<button class="btn primary" data-act="sync">${I("refresh", 16)} Sync Library</button>`]
    );
  }

  const filtered = libraryFiltered();
  const filterCount = activeFilterCount();

  const toolbar = `
    <div class="toolbar">
      <div class="search">
        ${I("search", 17)}
        <input id="lib-search" type="text" placeholder="Search title, author, journal" value="${attr(ui.search)}" />
      </div>
      <div class="seg">
        ${["all", "queue", "unread", "read"]
          .map(
            (f) =>
              `<button class="${ui.filter === f ? "active" : ""}" data-act="filter:${f}">${f === "all" ? "All" : f === "queue" ? "Queue" : f === "unread" ? "Unread" : "Read"}</button>`
          )
          .join("")}
      </div>
      <select class="select" id="lib-sort">
        ${Object.entries(SORTS)
          .map(([k, v]) => `<option value="${k}" ${ui.sort === k ? "selected" : ""}>${v}</option>`)
          .join("")}
      </select>
      <button class="btn" data-act="filters">${I("filter", 16)} Filters${filterCount ? ` (${filterCount})` : ""}</button>
      <button class="btn" data-act="collections">${I("folder", 16)} Collections</button>
      <button class="btn primary" data-act="doi">${I("plus", 16)} DOI</button>
    </div>`;

  let chips = "";
  if (filterCount) {
    const parts = [];
    if (ui.filter !== "all") parts.push(chip("status", ui.filter, ui.filter));
    if (ui.collection) {
      const name = ui.collections.find((c) => c.key === ui.collection)?.name || "Collection";
      parts.push(chip("collection", ui.collection, name));
    }
    [...ui.authors].forEach((a) => parts.push(chip("author", a, a)));
    [...ui.tags].forEach((t) => parts.push(chip("tag", t, "#" + t)));
    [...ui.years].sort((a, b) => b - a).forEach((y) => parts.push(chip("year", y, y)));
    chips = `<div class="chips">${parts.join("")}</div>`;
  }

  const rows = filtered
    .map((p) => paperRow(p, { showStatus: true, actions: libraryAction(p) }))
    .join("");

  return (
    toolbar +
    chips +
    `<div class="list">
      <div class="list-head"><span>${filtered.length} item${filtered.length === 1 ? "" : "s"}</span><span class="spacer"></span><span>${I("sort", 14)} ${SORTS[ui.sort]}</span></div>
      ${rows || `<div class="empty"><p>No items match your filters.</p></div>`}
    </div>`
  );
}

function libraryAction(p) {
  if (p.readStatus === "read")
    return `<button class="act" data-act="reset:${p.key}" title="Back to queue">${I("uturn", 18)}</button>`;
  if (p.isPending)
    return `<button class="act green" data-act="markRead:${p.key}" title="Mark read">${I("check", 18)}</button>`;
  return `<button class="act accent" data-act="${store.availableQueues.length > 1 ? "addQueueTo" : "addQueue"}:${p.key}" title="Add to queue">${I("plusCircle", 20)}</button>`;
}

function chip(type, value, label) {
  return `<button class="chip" data-act="chipRemove:${type}:${attr(value)}">${esc(label)} ${I("x", 13)}</button>`;
}

// ---------------------------------------------------------------------------
// History view
// ---------------------------------------------------------------------------
const HISTORY_RANGES = {
  all: "All time",
  today: "Today",
  week: "This week",
  month: "This month",
  year: "This year",
  custom: "Custom dates…",
};

function historyDateMatch(p) {
  const range = ui.historyRange;
  if (range === "all") return true;
  const d = p.readDate ? new Date(p.readDate) : null;
  if (!d) return false;
  const day = startOfDay(d);
  const now = new Date();
  if (range === "today") return day.getTime() === startOfDay(now).getTime();
  if (range === "week") {
    const ws = startOfDay(now);
    ws.setDate(ws.getDate() - ((ws.getDay() + 6) % 7)); // Monday
    return day >= ws;
  }
  if (range === "month")
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (range === "year") return d.getFullYear() === now.getFullYear();
  if (range === "custom") {
    if (ui.historyFrom && day < startOfDay(new Date(ui.historyFrom + "T00:00:00")))
      return false;
    if (ui.historyTo && day > startOfDay(new Date(ui.historyTo + "T00:00:00")))
      return false;
    return true;
  }
  return true;
}

function historyView() {
  if (!store.history().length) {
    return empty("history", "Nothing read yet", "Papers you finish show up here.");
  }

  let papers = store.history().filter(historyDateMatch);
  if (ui.historySearch) {
    const q = ui.historySearch.toLowerCase();
    papers = papers.filter(
      (p) => p.title.toLowerCase().includes(q) || authorLine(p).toLowerCase().includes(q)
    );
  }

  const rangeActive = ui.historyRange !== "all";
  const customRow =
    ui.historyRange === "custom"
      ? `<div class="toolbar" style="margin-top:-6px">
          <label class="date-field">From <input type="date" id="hist-from" value="${attr(ui.historyFrom)}" /></label>
          <label class="date-field">To <input type="date" id="hist-to" value="${attr(ui.historyTo)}" /></label>
        </div>`
      : "";

  const rows = papers
    .map((p) =>
      paperRow(p, {
        showStatus: true,
        meta: p.readDate ? `Read ${formatReadDate(p.readDate)}` : null,
        actions: `
          <button class="act" data-act="reset:${p.key}" title="Send back to queue">${I("uturn", 18)}</button>
          <button class="act red" data-act="removeHistory:${p.key}" title="Remove from history">${I("trash", 18)}</button>`,
      })
    )
    .join("");

  return `
    <div class="toolbar">
      <div class="search">${I("search", 17)}<input id="hist-search" type="text" placeholder="Search read papers" value="${attr(ui.historySearch)}" /></div>
      <select class="select ${rangeActive ? "active" : ""}" id="hist-range">
        ${Object.entries(HISTORY_RANGES)
          .map(([k, v]) => `<option value="${k}" ${ui.historyRange === k ? "selected" : ""}>${v}</option>`)
          .join("")}
      </select>
    </div>
    ${customRow}
    <div class="list">
      <div class="list-head"><span>${papers.length} read${rangeActive ? ` · ${esc(HISTORY_RANGES[ui.historyRange])}` : ""}</span></div>
      ${rows || `<div class="empty"><p>No reads match your filters.</p></div>`}
    </div>`;
}

function formatReadDate(d) {
  const date = new Date(d);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Stats view
// ---------------------------------------------------------------------------
function statsView() {
  const s = computeStats(store.allPapers(), { goal: store.settings.dailyGoal });
  const pct = Math.round(s.todayProgress * 100);
  const remaining = Math.max(s.dailyGoal - s.readToday, 0);

  const hero = `
    <div class="card hero">
      <div class="ring ${s.goalMetToday ? "done" : ""}" style="--p:${pct}">
        <div class="inner">
          ${s.goalMetToday ? `<div style="color:var(--green)">${I("check", 20)}</div>` : I("book", 20)}
          <b>${s.readToday}/${s.dailyGoal}</b>
        </div>
      </div>
      <div>
        <h2 style="margin:0 0 6px;font-size:18px">${s.goalMetToday ? "Goal reached 🎉" : "Today's goal"}</h2>
        <p style="margin:0;color:var(--text-2)">${
          s.goalMetToday
            ? "Nice work — you hit today's goal."
            : `${remaining} more ${remaining === 1 ? "paper" : "papers"} to reach your goal of ${s.dailyGoal}.`
        }</p>
      </div>
    </div>`;

  const streaks = `
    <div class="streak-row">
      <div class="card streak-card"><div style="color:var(--orange)">${I("flame", 24)}</div><div class="num">${s.currentStreakDays}</div><div class="cap">${s.currentStreakDays === 1 ? "day" : "days"} · current streak</div></div>
      <div class="card streak-card"><div style="color:var(--yellow)">${I("trophy", 24)}</div><div class="num">${s.longestStreakDays}</div><div class="cap">${s.longestStreakDays === 1 ? "day" : "days"} · best streak</div></div>
    </div>`;

  const card = (label, value, unit, icon, color) => `
    <div class="stat-card">
      <div class="label" style="color:${color}">${I(icon, 15)} ${label}</div>
      <div class="value">${value}</div>
      <div class="unit">${unit}</div>
    </div>`;

  const grid = `<div class="stats-grid">
    ${card("Read today", s.readToday, "works", "sun", "var(--orange)")}
    ${card("Pages today", s.pagesToday, "pages", "book", "var(--orange)")}
    ${card("This week", s.readThisWeek, "works", "calendar", "var(--blue)")}
    ${card("Pages / week", s.pagesThisWeek, "pages", "calendar", "var(--teal)")}
    ${card("Total read", s.papersReadTotal, "works", "checkCircle", "var(--green)")}
    ${card("Total pages", s.pagesReadTotal, "pages", "doc", "var(--green)")}
    ${card("Avg / day", s.averagePerActiveDay.toFixed(1), "per active day", "stats", "var(--indigo)")}
    ${card("Pending", s.pendingCount, "to read", "queue", "var(--purple)")}
    ${card("Library", s.libraryCount, "items", "library", "var(--blue)")}
  </div>`;

  return hero + streaks + grid + calendar(s) + weeklyChart(s, "papers") + weeklyChart(s, "pages");
}

function calendar(s) {
  const now = new Date();
  const view = ui.calMonth;
  const year = view.getFullYear();
  const month = view.getMonth();
  const monthName = view.toLocaleString("en-US", { month: "long", year: "numeric" });

  const startDow = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();

  const dows = ["M", "T", "W", "T", "F", "S", "S"];
  const head = dows.map((d) => `<div class="cal-dow">${d}</div>`).join("");

  let cells = "";
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const st = dayStatus(d, {
      countsByDay: s.countsByDay,
      goal: s.dailyGoal,
      firstActiveDay: s.firstActiveDay,
      now,
    });
    const isToday = dayKey(d) === dayKey(now);
    const count = s.countsByDay[dayKey(d)] || 0;
    cells += `<button class="cal-cell ${st}${isToday ? " today" : ""}" data-act="calDay:${dayKey(d)}" title="${dayKey(d)} · ${count} read">${day}</button>`;
  }

  return `<div class="card section-card cal-card">
    <div class="cal-head">
      <h3>${I("calendar", 17)} Calendar</h3>
      <div class="cal-nav">
        <button class="icon-btn sm" data-act="calPrev" title="Previous month">${I("chevronLeft", 16)}</button>
        <span class="cal-title">${monthName}</span>
        <button class="icon-btn sm" data-act="calNext" title="Next month" ${isCurrentMonth ? "disabled" : ""}>${I("chevronRight", 16)}</button>
      </div>
    </div>
    <div class="cal-grid-head">${head}</div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-legend">
      <span><i class="dot green"></i> Goal met</span>
      <span><i class="dot orange"></i> Partial</span>
      <span><i class="dot red"></i> Missed</span>
    </div>
  </div>`;
}

function weeklyChart(s, kind) {
  const max = Math.max(1, ...s.perWeek.map((b) => (kind === "papers" ? b.papersRead : b.pagesRead)));
  const bars = s.perWeek
    .map((b) => {
      const val = kind === "papers" ? b.papersRead : b.pagesRead;
      const h = Math.round((val / max) * 100);
      const [, mm, dd] = b.weekStart.split("-");
      return `<div class="bar-col"><div class="bar-v">${val || ""}</div><div class="bar" style="height:${h}%"></div><div class="bar-x">${mm}/${dd}</div></div>`;
    })
    .join("");
  const title = kind === "papers" ? "Papers read per week" : "Pages read per week";
  return `<div class="card section-card"><h3>${I(kind === "papers" ? "stats" : "book", 17)} ${title}</h3><div class="bars ${kind === "pages" ? "teal" : ""}">${bars}</div>${
    kind === "pages" ? `<p style="font-size:12px;color:var(--text-3);margin:12px 0 0">Estimated from Zotero page ranges (e.g. 134–136 = 2 pages).</p>` : ""
  }</div>`;
}

// ---------------------------------------------------------------------------
// Settings view
// ---------------------------------------------------------------------------
function settingsView() {
  const goal = store.settings.dailyGoal;
  const tags = store.settings.readExtraTags;
  const demo = store.config.demo;

  const account = `
    <div class="card settings-section">
      <h3>Account</h3>
      <div class="settings-row">
        <div class="grow">
          <div style="font-weight:600">${demo ? "Demo library" : esc(store.config.username || "Zotero")}</div>
          <div style="font-size:12.5px;color:var(--text-3)">${
            demo
              ? "Sample data — set ZOTERO_API_KEY to connect your real library."
              : `Connected · ${esc(store.config.library || "")}`
          }</div>
        </div>
        ${!demo && !store.config.demo ? `<span class="status-chip read">${I("cloud", 14)} Synced</span>` : ""}
      </div>
      <div class="settings-row">
        <div class="grow">Sync library now</div>
        <button class="btn sm" data-act="sync" ${store.isSyncing ? "disabled" : ""}>${I("refresh", 15)} Sync</button>
      </div>
    </div>`;

  const goalSection = `
    <div class="card settings-section">
      <h3>Reading goal</h3>
      <div class="settings-row">
        <div style="color:var(--green)">${I("target", 18)}</div>
        <div class="grow"><div style="font-weight:600">Daily goal</div><div style="font-size:12.5px;color:var(--text-3)">Hit it to build a streak. The Stats calendar turns green.</div></div>
        <div class="stepper">
          <button data-act="goalDec">−</button>
          <span class="val">${goal}</span>
          <button data-act="goalInc">+</button>
        </div>
      </div>
      <div class="settings-row">
        <div style="color:var(--orange)">${I("bell", 18)}</div>
        <div class="grow"><div style="font-weight:600">Daily reminder</div><div style="font-size:12.5px;color:var(--text-3)">A browser notification when you haven't read today.</div></div>
        <button class="btn sm" data-act="reminder">Enable</button>
      </div>
    </div>`;

  const tagSection = `
    <div class="card settings-section">
      <h3>Tags on read</h3>
      <div style="font-size:13px;color:var(--text-2);margin-bottom:10px">When you mark a paper read, these Zotero tags are added alongside PaperQueue's own tag.</div>
      <div>
        ${tags.length ? tags.map((t) => `<span class="tag-pill sel">${I("tag", 13)} ${esc(t)} <button data-act="removeReadTag:${attr(t)}" style="border:none;background:none;color:inherit;cursor:pointer;padding:0">${I("x", 12)}</button></span>`).join("") : `<span style="font-size:13px;color:var(--text-3)">No extra tags.</span>`}
      </div>
      <button class="btn sm" style="margin-top:12px" data-act="addReadTags">${I("tag", 15)} Choose tags…</button>
    </div>`;

  const how = `
    <div class="card settings-section">
      <h3>How it works</h3>
      <div style="font-size:13.5px;color:var(--text-2);line-height:1.6">
        PaperQueue stores its state in namespaced Zotero tags (<code>pq:queue</code>, <code>pq:read:&lt;date&gt;</code>, <code>pq:pos:&lt;n&gt;</code>…), so your queue, order and reading history sync across every device — this web app, the iPhone/iPad app and the Mac app — through Zotero itself.
      </div>
      <div class="settings-row" style="margin-top:8px">
        <div style="color:var(--text-3)">${I("info", 18)}</div>
        <div class="grow" style="font-size:12.5px;color:var(--text-3)">PaperQueue Web v${esc(store.config.version || "1.0")} · single service, single port. The Zotero key lives only on the server.</div>
      </div>
    </div>`;

  return account + goalSection + tagSection + how;
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
function empty(icon, title, text, actions = []) {
  return `<div class="empty">
    <div class="ico">${I(icon, 30)}</div>
    <h2>${esc(title)}</h2>
    <p>${esc(text)}</p>
    ${actions.length ? `<div class="row-actions">${actions.join("")}</div>` : ""}
  </div>`;
}

function setupScreen() {
  return `<div class="setup">
    <div class="hero-logo">${I("layers", 34)}</div>
    <h1>Welcome to PaperQueue</h1>
    <p class="lede">Turn your Zotero library into a focused reading queue — in your browser.</p>
    <div class="card" style="padding:8px 22px">
      <div class="step"><div class="n">1</div><div class="st-body"><h4>Create a Zotero API key</h4><p>Open <a href="https://www.zotero.org/settings/keys/new" target="_blank" rel="noopener">zotero.org/settings/keys</a> and create a key with library <b>read &amp; write</b> access.</p></div></div>
      <div class="step"><div class="n">2</div><div class="st-body"><h4>Give it to the server</h4><p>Set it as an environment variable — via <code>.env</code> or docker-compose — then restart. No IP or extra config: one port, one service.</p>
        <pre class="code"># .env
ZOTERO_API_KEY=your_key_here
PORT=5954</pre>
        <pre class="code"># docker-compose.yml
services:
  paperqueue:
    image: paperqueue-web
    ports: ["5954:5954"]
    environment:
      ZOTERO_API_KEY: your_key_here</pre>
      </div></div>
      <div class="step" style="border-bottom:none"><div class="n">3</div><div class="st-body"><h4>Reload</h4><p>Your whole library, queue, history and stats appear here — and stay in sync with the iOS/macOS apps through Zotero.</p></div></div>
    </div>
    <p style="text-align:center;color:var(--text-3);margin-top:22px;font-size:13px">Tip: leave the key unset to explore a built-in <b>demo library</b> first.</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
function openModal(html) {
  closeModal();
  const back = document.createElement("div");
  back.className = "modal-backdrop";
  back.innerHTML = `<div class="modal">${html}</div>`;
  back.addEventListener("click", (e) => {
    if (e.target === back) closeModal();
  });
  document.body.appendChild(back);
  return back;
}
function closeModal() {
  $(".modal-backdrop")?.remove();
}

function modalShell(title, body, foot = "") {
  return `
    <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-act="closeModal">${I("x", 18)}</button></div>
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ""}`;
}

function queueMenuModal() {
  const items = store.availableQueues
    .map(
      (q) =>
        `<button data-act="setQueue:${attr(q)}">${I(q === POSTPONED_QUEUE ? "clock" : "layers", 18)} ${esc(q)} ${q === store.activeQueue ? I("check", 16) : ""}</button>`
    )
    .join("");
  const del =
    store.activeQueue !== "Default" && store.activeQueue !== POSTPONED_QUEUE
      ? `<button class="danger" data-act="deleteQueue">${I("trash", 18)} Delete “${esc(store.activeQueue)}”</button>`
      : "";
  openModal(
    modalShell(
      "Queues",
      `<div class="menu-list">${items}<hr style="border:none;border-top:1px solid var(--border);margin:8px 0">
        <button data-act="newQueue">${I("plus", 18)} New queue…</button>${del}</div>`
    )
  );
}

function newQueueModal() {
  openModal(
    modalShell(
      "New queue",
      `<div class="field"><label>Queue name</label><input id="queue-name" type="text" placeholder="e.g. Teaching, Reviews" /></div>
       <div class="hint">Group papers into a separate reading queue.</div>`,
      `<button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="createQueue">Create</button>`
    )
  );
  setTimeout(() => $("#queue-name")?.focus(), 50);
}

function doiModal() {
  openModal(
    modalShell(
      "Add paper by DOI",
      `<div class="field"><label>DOI</label><input id="doi-input" type="text" placeholder="10.1000/xyz123" /></div>
       <div class="hint">We fetch the title, authors and journal from Crossref and add it to your Zotero library.</div>
       <div id="doi-error" style="color:var(--red);font-size:13px;margin-top:8px"></div>`,
      `<button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="submitDOI" id="doi-submit">Add to library</button>`
    )
  );
  setTimeout(() => $("#doi-input")?.focus(), 50);
}

function pickQueueModal(key, mode) {
  // mode: "add" | "move"
  const items = store.availableQueues
    .map(
      (q) =>
        `<button data-act="${mode === "move" ? "doMove" : "doAdd"}:${key}:${attr(q)}">${I("layers", 18)} ${esc(q)}</button>`
    )
    .join("");
  openModal(modalShell(mode === "move" ? "Move to queue" : "Add to queue", `<div class="menu-list">${items}</div>`));
}

function filtersModal() {
  const allAuthors = uniqueSorted(store.allPapers().flatMap((p) => [...p.authors, ...p.editors]));
  const allTags = uniqueSorted(
    store.allPapers().flatMap((p) => p.tags).filter((t) => !t.startsWith("pq:") && !t.startsWith("_"))
  );
  const allYears = uniqueSorted(store.allPapers().map((p) => p.year).filter(Boolean)).sort((a, b) => b - a);

  const collOptions = `<option value="">All collections</option>` +
    ui.collections.map((c) => `<option value="${attr(c.key)}" ${ui.collection === c.key ? "selected" : ""}>${esc(c.name)}</option>`).join("");

  const tagList = (title, options, selected, type) => `
    <div style="margin-bottom:18px">
      <div style="font-weight:650;font-size:13px;margin-bottom:8px">${esc(title)} ${selected.size ? `<span style="color:var(--accent)">(${selected.size})</span>` : ""}</div>
      <div style="max-height:130px;overflow:auto">${
        options.length
          ? options.map((o) => `<button class="tag-pill ${selected.has(String(o)) ? "sel" : ""}" data-act="toggleFilter:${type}:${attr(o)}">${esc(o)}</button>`).join("")
          : `<span style="font-size:12.5px;color:var(--text-3)">None</span>`
      }</div>
    </div>`;

  openModal(
    modalShell(
      "Filters",
      `<div class="field"><label>Collection</label><select class="select" id="filter-collection" style="height:42px">${collOptions}</select></div>
       ${tagList("Authors", allAuthors, ui.authors, "author")}
       ${tagList("Tags", allTags, ui.tags, "tag")}
       ${tagList("Year", allYears, ui.years, "year")}`,
      `<button class="btn danger" data-act="clearFilters">Clear all</button><span style="flex:1"></span><button class="btn primary" data-act="closeModal">Done</button>`
    )
  );
}

async function collectionsModal() {
  openModal(modalShell("Collections", `<div id="coll-body" class="menu-list"><div style="padding:20px;text-align:center;color:var(--text-3)">Loading…</div></div>`));
  try {
    const top = await api.topCollections();
    renderCollectionList(top, []);
  } catch (e) {
    const b = $("#coll-body");
    if (b) b.innerHTML = `<div style="padding:20px;color:var(--red)">${esc(e.message)}</div>`;
  }
}

function renderCollectionList(collections, breadcrumb) {
  const b = $("#coll-body");
  if (!b) return;
  const crumb = breadcrumb.length
    ? `<button data-coll-back="1" style="display:flex;align-items:center;gap:8px;background:none;border:none;color:var(--accent);font-weight:600;padding:8px 4px;cursor:pointer">${I("uturn", 16)} Back</button>`
    : "";
  b.innerHTML =
    crumb +
    (collections.length
      ? collections.map((c) => `<button data-coll-open="${attr(c.key)}" data-coll-name="${attr(c.name)}">${I("folder", 18)} ${esc(c.name)}</button>`).join("")
      : `<div style="padding:16px;color:var(--text-3)">No collections.</div>`);
}

async function detailModal(key) {
  const p = store.papers.get(key);
  if (!p) return;
  const sub = subtitle(p);
  // Hide PaperQueue's own state tags and Zotero's hidden `_` tags.
  const visibleTags = p.tags.filter((t) => !t.startsWith("_") && !t.startsWith("pq:"));
  const links = [];
  links.push(
    `<a class="btn primary" href="zotero://select/library/items/${attr(p.key)}" target="_blank" rel="noopener">${I("external", 16)} Open in Zotero</a>`
  );
  if (p.doi) links.push(`<a class="btn" href="https://doi.org/${attr(p.doi)}" target="_blank" rel="noopener">${I("external", 16)} Open DOI</a>`);
  else if (p.url) links.push(`<a class="btn" href="${attr(p.url)}" target="_blank" rel="noopener">${I("external", 16)} Open link</a>`);

  let statusChip = "";
  if (p.readStatus === "read") statusChip = `<span class="status-chip read">Read</span>`;
  else if (p.readStatus === "skipped") statusChip = `<span class="status-chip skipped">Skipped</span>`;
  else if (p.queueStatus === "postponed") statusChip = `<span class="status-chip postponed">Postponed</span>`;
  else if (p.isPending) statusChip = `<span class="status-chip queued">${p.queueName ? "In “" + esc(p.queueName) + "”" : "In queue"}</span>`;

  let actions = "";
  if (p.readStatus === "read" || p.readStatus === "skipped") {
    actions = `
      <button class="btn" data-act="reset:${p.key}" data-close>${I("uturn", 16)} Move back to queue</button>
      <button class="btn danger" data-act="removeHistory:${p.key}" data-close>${I("trash", 16)} Remove from history</button>`;
  } else if (p.isPending) {
    actions = `
      <button class="btn primary" data-act="markRead:${p.key}" data-close>${I("check", 16)} Mark as read</button>
      ${
        p.queueName === POSTPONED_QUEUE
          ? `<button class="btn" data-act="returnToQueue:${p.key}" data-close>${I("uturn", 16)} Move back to reading queue</button>`
          : `<button class="btn" data-act="postpone:${p.key}" data-close>${I("clock", 16)} Postpone</button>`
      }
      ${store.availableQueues.length > 1 ? `<button class="btn" data-act="moveQueue:${p.key}">${I("layers", 16)} Move to another queue</button>` : ""}
      <button class="btn" data-act="skip:${p.key}" data-close>${I("x", 16)} Skip</button>
      <button class="btn danger" data-act="remove:${p.key}" data-close>${I("minusCircle", 16)} Remove from queue</button>`;
  } else {
    actions = `
      <button class="btn primary" data-act="${store.availableQueues.length > 1 ? "addQueueTo" : "addQueue"}:${p.key}">${I("plusCircle", 16)} Add to reading queue</button>
      <button class="btn" data-act="markRead:${p.key}" data-close>${I("check", 16)} Mark as read</button>`;
  }

  openModal(
    modalShell(
      "Paper",
      `<h2 style="font-size:19px;margin:0 0 8px;line-height:1.3">${esc(p.title)}</h2>
       <div style="color:var(--text-2);font-weight:550;margin-bottom:4px">${esc(authorLine(p))}</div>
       ${sub ? `<div style="color:var(--text-3);font-size:13.5px">${esc(sub)}</div>` : ""}
       <div style="margin:14px 0">${statusChip}</div>
       ${visibleTags.length ? `<div class="detail-tags">${visibleTags.map((t) => `<span class="tag-pill">${esc(t)}</span>`).join("")}</div>` : ""}
       <div class="detail-actions">${links.join("")}</div>
       <div class="detail-actions">${actions}</div>`
    )
  );
}

function tagPickerModal() {
  const allTags = uniqueSorted(
    store.allPapers().flatMap((p) => p.tags).filter((t) => !t.startsWith("pq:") && !t.startsWith("_"))
  );
  const sel = new Set(store.settings.readExtraTags);
  openModal(
    modalShell(
      "Tags on read",
      `<div class="hint" style="margin-bottom:12px">Pick tags to add automatically when a paper is marked read.</div>
       <div style="max-height:320px;overflow:auto">${
         allTags.length
           ? allTags.map((t) => `<button class="tag-pill ${sel.has(t) ? "sel" : ""}" data-act="toggleReadTag:${attr(t)}">${esc(t)}</button>`).join("")
           : `<span style="color:var(--text-3)">No tags in your library yet.</span>`
       }</div>`,
      `<button class="btn primary" data-act="closeModal">Done</button>`
    )
  );
}

function uniqueSorted(arr) {
  return [...new Set(arr.filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { sensitivity: "base" })
  );
}

// ---------------------------------------------------------------------------
// Event handling (delegation)
// ---------------------------------------------------------------------------
document.addEventListener("click", (e) => {
  const target = e.target.closest("[data-act]");
  // Collections modal navigation (separate data attrs).
  const back = e.target.closest("[data-coll-back]");
  const openColl = e.target.closest("[data-coll-open]");
  if (back) return collBack();
  if (openColl) return collOpen(openColl.dataset.collOpen, openColl.dataset.collName);
  if (!target) return;
  const act = target.dataset.act;
  const close = target.hasAttribute("data-close");
  handleAction(act, target);
  if (close) closeModal();
});

document.addEventListener("input", (e) => {
  const id = e.target.id;
  if (id === "lib-search") {
    ui.search = e.target.value;
    scheduleRender();
  } else if (id === "hist-search") {
    ui.historySearch = e.target.value;
    scheduleRender();
  }
});

document.addEventListener("change", (e) => {
  const id = e.target.id;
  if (id === "lib-sort") {
    ui.sort = e.target.value;
    scheduleRender();
  } else if (id === "filter-collection") {
    ui.collection = e.target.value || null;
    scheduleRender();
  } else if (id === "hist-range") {
    ui.historyRange = e.target.value;
    scheduleRender();
  } else if (id === "hist-from") {
    ui.historyFrom = e.target.value;
    scheduleRender();
  } else if (id === "hist-to") {
    ui.historyTo = e.target.value;
    scheduleRender();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
  if (e.key === "Enter") {
    if ($("#queue-name") && document.activeElement === $("#queue-name")) createQueueFromModal();
    if ($("#doi-input") && document.activeElement === $("#doi-input")) submitDOI();
    if ($("#move-pos") && document.activeElement === $("#move-pos")) submitMovePos();
  }
});

let collStack = [];
async function collOpen(key, name) {
  collStack.push({ key, name });
  const b = $("#coll-body");
  if (b) b.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-3)">Loading…</div>`;
  try {
    const { subcollections, items } = await api.collection(key);
    renderCollectionContents(name, subcollections, items);
  } catch (err) {
    if (b) b.innerHTML = `<div style="padding:20px;color:var(--red)">${esc(err.message)}</div>`;
  }
}
async function collBack() {
  collStack.pop();
  if (!collStack.length) {
    const top = await api.topCollections();
    renderCollectionList(top, []);
  } else {
    const cur = collStack[collStack.length - 1];
    collStack.pop();
    collOpen(cur.key, cur.name);
  }
}
function renderCollectionContents(name, subs, items) {
  const b = $("#coll-body");
  if (!b) return;
  const head = `<button data-coll-back="1" style="display:flex;align-items:center;gap:8px;background:none;border:none;color:var(--accent);font-weight:600;padding:8px 4px;cursor:pointer">${I("uturn", 16)} Back</button>
    <div style="font-weight:700;padding:4px 8px">${esc(name)}</div>`;
  const subHtml = subs.length
    ? subs.map((c) => `<button data-coll-open="${attr(c.key)}" data-coll-name="${attr(c.name)}">${I("folder", 18)} ${esc(c.name)}</button>`).join("")
    : "";
  const itemHtml = items.length
    ? items
        .map((it) => {
          const queued = store.isQueued(it.data.key);
          return `<button data-act="enqueue:${it.data.key}" ${queued ? "disabled" : ""} style="${queued ? "opacity:.6" : ""}">${queued ? `<span style="color:var(--green)">${I("checkCircle", 18)}</span>` : I("plusCircle", 18)} <span style="flex:1;text-align:left">${esc(it.data.title || "(untitled)")}</span></button>`;
        })
        .join("")
    : `<div style="padding:14px;color:var(--text-3)">No papers.</div>`;
  b.innerHTML =
    head +
    (subHtml ? `<div style="font-size:11px;color:var(--text-3);padding:8px 8px 2px;text-transform:uppercase">Subcollections</div>${subHtml}` : "") +
    `<div style="font-size:11px;color:var(--text-3);padding:8px 8px 2px;text-transform:uppercase">Papers (${items.length})</div>${itemHtml}`;
}

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------
function handleAction(act, target) {
  const [cmd, ...rest] = act.split(":");
  const key = rest[0];
  const p = key ? store.papers.get(key) : null;

  switch (cmd) {
    case "nav":
      ui.tab = key;
      render();
      window.scrollTo({ top: 0 });
      return;
    case "sync":
      store.syncLibrary();
      return;
    case "closeModal":
      return closeModal();

    // Queue mgmt
    case "queueMenu":
      return queueMenuModal();
    case "setQueue":
      store.setActiveQueue(decodeArg(rest));
      return closeModal();
    case "newQueue":
      return newQueueModal();
    case "createQueue":
      return createQueueFromModal();
    case "deleteQueue":
      store.deleteQueue(store.activeQueue);
      return closeModal();

    // Paper actions
    case "open":
      return detailModal(key);
    case "markRead":
      if (p) {
        store.markRead(p);
        toast("Marked read", "success");
      }
      return;
    case "postpone":
      if (p) {
        store.postpone(p);
        toast("Postponed to tomorrow");
      }
      return;
    case "skip":
      if (p) store.skip(p);
      return;
    case "remove":
      if (p) store.removeFromQueue(p);
      return;
    case "reset":
      if (p) {
        store.reset(p);
        toast("Back in your queue", "success");
      }
      return;
    case "returnToQueue":
      if (p) {
        store.returnToQueue(p);
        toast("Back in your reading queue", "success");
      }
      return;
    case "removeHistory":
      if (p) store.removeFromHistory(p);
      return;
    case "addQueue":
      if (p) {
        store.addToQueue(p);
        toast("Added to queue", "success");
      }
      return;
    case "addQueueTo":
      return pickQueueModal(key, "add");
    case "moveQueue":
      return pickQueueModal(key, "move");
    case "doAdd": {
      const q = decodeArg(rest.slice(1));
      if (p) store.addToQueue(p, q);
      toast("Added to " + q, "success");
      return closeModal();
    }
    case "doMove": {
      const q = decodeArg(rest.slice(1));
      if (p) store.moveToQueue(p, q);
      return closeModal();
    }
    case "movePos":
      return movePosModal(key);
    case "submitMovePos":
      return submitMovePos();
    case "enqueue": {
      // From collections modal — need the raw item; re-fetch from cache or build.
      return enqueueFromCollections(key, target);
    }

    // Library
    case "filter":
      ui.filter = key;
      return scheduleRender();
    case "filters":
      return filtersModal();
    case "collections":
      collStack = [];
      return collectionsModal();
    case "doi":
      return doiModal();
    case "submitDOI":
      return submitDOI();
    case "chipRemove":
      return removeChip(rest[0], decodeArg(rest.slice(1)));
    case "toggleFilter":
      return toggleFilter(rest[0], decodeArg(rest.slice(1)));
    case "clearFilters":
      ui.filter = "all";
      ui.collection = null;
      ui.authors.clear();
      ui.tags.clear();
      ui.years.clear();
      closeModal();
      return scheduleRender();

    // Settings
    case "goalInc":
      return store.setDailyGoal(store.settings.dailyGoal + 1);
    case "goalDec":
      return store.setDailyGoal(store.settings.dailyGoal - 1);
    case "addReadTags":
      return tagPickerModal();
    case "toggleReadTag":
      return toggleReadTag(decodeArg(rest));
    case "removeReadTag":
      store.setReadExtraTags(store.settings.readExtraTags.filter((t) => t !== decodeArg(rest)));
      return;
    case "reminder":
      return enableReminder();
    case "scrollTop":
      return window.scrollTo({ top: 0, behavior: "smooth" });

    // Stats calendar navigation
    case "calPrev":
      ui.calMonth = new Date(ui.calMonth.getFullYear(), ui.calMonth.getMonth() - 1, 1);
      return scheduleRender();
    case "calNext": {
      const now = new Date();
      const next = new Date(ui.calMonth.getFullYear(), ui.calMonth.getMonth() + 1, 1);
      // Never navigate past the current month.
      if (next <= new Date(now.getFullYear(), now.getMonth(), 1)) ui.calMonth = next;
      return scheduleRender();
    }
    case "calDay":
      return calendarDayModal(key);
  }
}

/** Lists the papers read on a given calendar day (YYYY-MM-DD). */
function calendarDayModal(dayKeyStr) {
  const reads = store
    .allPapers()
    .filter(
      (p) =>
        p.readStatus === "read" &&
        p.readDate &&
        dayKey(new Date(p.readDate)) === dayKeyStr
    )
    .sort((a, b) => a.title.localeCompare(b.title));

  const dateLabel = new Date(dayKeyStr + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const body = reads.length
    ? `<div class="menu-list">${reads
        .map(
          (p) =>
            `<button data-act="open:${p.key}"><span style="color:var(--green)">${I("checkCircle", 18)}</span><span style="flex:1;text-align:left;min-width:0"><span style="display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.title)}</span><span style="font-size:12.5px;color:var(--text-3)">${esc(authorLine(p))}</span></span></button>`
        )
        .join("")}</div>`
    : `<div class="empty" style="padding:30px 10px"><div class="ico">${I("book", 30)}</div><p>No papers read on this day.</p></div>`;

  openModal(
    modalShell(
      dateLabel,
      `<div style="font-size:13px;color:var(--text-2);margin-bottom:12px">${reads.length} ${reads.length === 1 ? "paper" : "papers"} read</div>${body}`
    )
  );
}

function decodeArg(parts) {
  // Args may contain ":" (e.g. tags). Re-join everything after the command.
  return parts.join(":");
}

function createQueueFromModal() {
  const name = $("#queue-name")?.value || "";
  if (store.createQueue(name)) {
    closeModal();
    ui.tab = "queue";
    render();
  } else {
    toast("That queue name is taken or empty", "error");
  }
}

async function submitDOI() {
  const input = $("#doi-input");
  const btn = $("#doi-submit");
  const err = $("#doi-error");
  if (!input) return;
  const doi = input.value.trim();
  if (!doi) return;
  btn.disabled = true;
  btn.textContent = "Adding…";
  const ok = await store.addByDOI(doi);
  if (ok) {
    closeModal();
    toast("Added to your library", "success");
  } else {
    if (err) err.textContent = store.lastError || "Could not add that paper.";
    store.lastError = null;
    btn.disabled = false;
    btn.textContent = "Add to library";
  }
}

let movingKey = null;
function movePosModal(key) {
  const papers = store.pendingInActiveQueue();
  const idx = papers.findIndex((p) => p.key === key);
  if (idx < 0) return;
  movingKey = key;
  openModal(
    modalShell(
      "Move to position",
      `<div class="field"><label>Position (1–${papers.length})</label><input id="move-pos" type="number" min="1" max="${papers.length}" value="${idx + 1}" /></div>`,
      `<button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="submitMovePos">Move</button>`
    )
  );
  setTimeout(() => {
    const i = $("#move-pos");
    i?.focus();
    i?.select();
  }, 50);
}
function submitMovePos() {
  const input = $("#move-pos");
  if (!input || !movingKey) return closeModal();
  const target = parseInt(input.value, 10);
  const papers = store.pendingInActiveQueue();
  const idx = papers.findIndex((p) => p.key === movingKey);
  if (isNaN(target) || idx < 0) return closeModal();
  const moved = papers[idx];
  const arr = papers.filter((p) => p.key !== movingKey);
  arr.splice(Math.min(Math.max(target - 1, 0), arr.length), 0, moved);
  store.reorderPending(arr);
  movingKey = null;
  closeModal();
}

function removeChip(type, value) {
  if (type === "status") ui.filter = "all";
  else if (type === "collection") ui.collection = null;
  else if (type === "author") ui.authors.delete(value);
  else if (type === "tag") ui.tags.delete(value);
  else if (type === "year") ui.years.delete(value);
  scheduleRender();
}

function toggleFilter(type, value) {
  const set = type === "author" ? ui.authors : type === "tag" ? ui.tags : ui.years;
  if (set.has(value)) set.delete(value);
  else set.add(value);
  // Re-render just the modal + the underlying view.
  filtersModal();
  scheduleRender();
}

function toggleReadTag(tag) {
  const cur = new Set(store.settings.readExtraTags);
  if (cur.has(tag)) cur.delete(tag);
  else cur.add(tag);
  store.setReadExtraTags([...cur]);
  tagPickerModal(); // refresh selection state
}

async function enqueueFromCollections(key, target) {
  // We have the title in the DOM; fetch the item from the open collection by
  // re-reading the cache if present, else build a minimal item.
  const existing = store.papers.get(key);
  if (existing) {
    store.addToQueue(existing);
  } else {
    // Build a minimal raw item from the button label.
    const title = target.querySelector("span")?.textContent || "(untitled)";
    store.enqueue({ data: { key, title, tags: [], collections: [] } });
  }
  target.disabled = true;
  target.style.opacity = ".6";
  target.innerHTML = `<span style="color:var(--green)">${I("checkCircle", 18)}</span> <span style="flex:1;text-align:left">${esc(target.querySelector("span")?.textContent || "")}</span>`;
  toast("Added to queue", "success");
}

async function enableReminder() {
  if (!("Notification" in window)) return toast("Notifications not supported", "error");
  const perm = await Notification.requestPermission();
  if (perm === "granted") {
    toast("Daily reminder enabled", "success");
    localStorage.setItem("pq.reminder", "1");
    scheduleReminderCheck();
  } else {
    toast("Notifications were blocked", "error");
  }
}

let reminderInterval = null;
function scheduleReminderCheck() {
  if (localStorage.getItem("pq.reminder") !== "1") return;
  if (reminderInterval) return; // already running — never stack intervals
  // Light-touch: if it's past 19:00 and nothing read today, nudge once.
  const check = () => {
    const s = computeStats(store.allPapers(), { goal: store.settings.dailyGoal });
    const hour = new Date().getHours();
    const last = localStorage.getItem("pq.reminder.last");
    const today = dayKey(new Date());
    if (hour >= 19 && !s.goalMetToday && last !== today && Notification.permission === "granted") {
      new Notification("PaperQueue", { body: `You haven't hit today's reading goal yet — ${s.pendingCount} in your queue.` });
      localStorage.setItem("pq.reminder.last", today);
    }
  };
  check();
  reminderInterval = setInterval(check, 30 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Drag-to-reorder (queue)
// ---------------------------------------------------------------------------
// Floating "scroll to top" button — shown on any tab once you've scrolled down.
let scrollListenerAttached = false;
function updateScrollFab() {
  const fab = $(".fab-top");
  if (fab) fab.classList.toggle("visible", window.scrollY > 380);
}

let dragKey = null;
function bindDynamic() {
  if (!scrollListenerAttached) {
    window.addEventListener("scroll", updateScrollFab, { passive: true });
    scrollListenerAttached = true;
  }
  updateScrollFab();

  const list = $("#queue-list");
  if (!list) return;
  const rows = list.querySelectorAll(".row[draggable]");
  rows.forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      dragKey = row.dataset.key;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      dragKey = null;
      row.classList.remove("dragging");
      list.querySelectorAll(".drop-target").forEach((r) => r.classList.remove("drop-target"));
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      list.querySelectorAll(".drop-target").forEach((r) => r.classList.remove("drop-target"));
      row.classList.add("drop-target");
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drop-target");
      if (!dragKey || dragKey === row.dataset.key) return;
      const papers = store.pendingInActiveQueue();
      const from = papers.findIndex((p) => p.key === dragKey);
      const to = papers.findIndex((p) => p.key === row.dataset.key);
      if (from < 0 || to < 0) return;
      const arr = [...papers];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      store.reorderPending(arr);
    });
  });
}
