var CACHE = "anrsh-v9";
var FILES = ["./", "index.html", "cibt.jpg", "config.js", "manifest.webmanifest", "intro.mp4", "assets/anrsh-background.svg", "assets/anrsh-background.png", "assets/regional-offices/EL_MENIAA.jpg", "assets/regional-offices/ALGIERS.jpg", "assets/regional-offices/BEJAIA.jpg", "assets/regional-offices/BISKRA.webp", "assets/regional-offices/LAGHOUAT.jpg", "assets/regional-offices/OUED_SOUF.jpg", "assets/regional-offices/SKIKDA.jpg", "assets/regional-offices/TIMIMOUN.jpg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(FILES.map(function (f) { return c.add(f).catch(function () {}); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(
    fetch(r).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(r).then(function (m) { return m || (r.mode === "navigate" ? caches.match("index.html") : undefined); });
    })
  );
});
