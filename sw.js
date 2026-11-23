/* Service worker: la app abre sin internet una vez instalada. */
var C = "entrenador-v6", CORE = ["./", "index.html", "db.js", "chess.js", "stockfish.js", "stockfish.wasm.js", "stockfish.wasm", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", function (e) { e.waitUntil(caches.open(C).then(function (c) { return c.addAll(CORE); })); self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (k) { return Promise.all(k.filter(function (x) { return x !== C; }).map(function (x) { return caches.delete(x); })); }));
  self.clients.claim();
});
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var u = new URL(e.request.url); if (u.hostname === "api.chess.com") return;
  var same = u.origin === location.origin;
  e.respondWith(same
    ? fetch(e.request).then(function (r) { var c = r.clone(); caches.open(C).then(function (ch) { ch.put(e.request, c); }); return r; }).catch(function () { return caches.match(e.request); })
    : caches.match(e.request).then(function (m) { return m || fetch(e.request).then(function (r) { var c = r.clone(); caches.open(C).then(function (ch) { ch.put(e.request, c); }); return r; }); }));
});
