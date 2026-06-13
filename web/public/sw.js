// PaperQueue service worker — makes the web app installable (PWA) and keeps the
// app shell available offline.
//
// It deliberately NEVER caches API responses or the live event stream: queue,
// library, history and stats data must always come fresh from Zotero. Only the
// static shell (HTML, CSS, JS modules, icons) is cached.
//
// The cache is versioned by the `?v=<appVersion>` query the page registers us
// with (see app.js). A new release therefore registers a fresh worker, opens a
// new cache, and the old one is purged on activate — no manual cache busting.

const VERSION = new URL(self.location).searchParams.get("v") || "dev";
const CACHE = `paperqueue-shell-${VERSION}`;

// The app shell. Hashing isn't used (no build step), so these are kept fresh by
// the stale-while-revalidate strategy below rather than by content hashes.
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/manifest.webmanifest",
  "/js/app.js",
  "/js/store.js",
  "/js/stats.js",
  "/js/api.js",
  "/js/ai.js",
  "/js/ai-prompt.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is atomic; a single 404 would reject it, so ignore individual
      // failures and cache what we can (icons/modules may shift between builds).
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never intercept the data API or the live SSE stream — always hit the network
  // so the app never shows stale Zotero state.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first so an online user always gets the latest shell,
  // falling back to the cached index.html when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/index.html").then((r) => r || caches.match("/"))
      )
    );
    return;
  }

  // Static assets: stale-while-revalidate — instant from cache, refreshed in the
  // background so the next load picks up a new deploy.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
