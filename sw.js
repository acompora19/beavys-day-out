// Beavy's Day Out service worker: caches the app so it opens with no signal, and keeps the last events list.
const VERSION = "bdo-v1";
const SHELL = ["./", "index.html", "dayout-core.js", "beaver-portrait.png", "icon-64.png", "icon-180.png", "icon-512.png", "manifest.json", "data/standbys.json", "data/events.json"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Weather always goes to the network; the page keeps its own short cache.
  const cacheable = url.origin === location.origin || url.hostname.startsWith("fonts.");
  if (!cacheable) return;
  // Our own page, code and data: network first so updates show on the next open; fall back to the cache offline.
  const own = url.origin === location.origin && /(\/|\.html|\.js|\.json)$/.test(url.pathname);
  e.respondWith(own
    ? fetch(e.request, { cache: "no-cache" }).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
    : caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok || r.type === "opaque") { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return r; })));
});
