/* ANRSH DIGITAL — PWA service worker */
var CACHE = "anrsh-static-v4";
var FILES = [
  "./",
  "index.html",
  "config.js",
  "manifest.webmanifest",
  "intro.mp4",
  "assets/anrsh-background.png",
  "icon.svg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) {
        return Promise.all(FILES.map(function (file) {
          return cache.add(file).catch(function () {
            // A missing optional asset must not block installation.
            return null;
          });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys
        .filter(function (key) { return key.indexOf("anrsh-static-") === 0 && key !== CACHE; })
        .map(function (key) { return caches.delete(key); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Do not cache API/authentication traffic or non-static application data.
  var isStatic = FILES.some(function (file) {
    var target = new URL(file, self.location.href);
    return target.href === url.href;
  });
  if (!isStatic) return;

  event.respondWith(
    fetch(request).then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    }).catch(function () {
      return caches.match(request).then(function (cached) {
        return cached || (request.mode === "navigate" ? caches.match("index.html") : undefined);
      });
    })
  );
});
