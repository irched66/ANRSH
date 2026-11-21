/* ANRSH PWA service worker — cache corrected for the files that exist in the repository. */
var CACHE = "anrsh-v4";
var FILES = [
  "./",
  "index.html",
  "config.js",
  "manifest.webmanifest",
  "icon.svg",
  "assets/anrsh-background.png",
  "assets/OUED_SOUF.jpg",
  "paiement.html",
  "otp.html",
  "verification-telephone.html"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(FILES.map(function (file) {
        return cache.add(file).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key.indexOf("anrsh-") === 0 && key !== CACHE;
      }).map(function (key) { return caches.delete(key); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request).then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) {
          cache.put(request, copy);
        });
      }
      return response;
    }).catch(function () {
      return caches.match(request).then(function (cached) {
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match("index.html");
        return undefined;
      });
    })
  );
});
