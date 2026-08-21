const VERSION = "v2";
const SHELL_CACHE = `symoh-shell-${VERSION}`;
const DATA_CACHE = `symoh-data-${VERSION}`;
const MEDIA_CACHE = `symoh-media-${VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
  "https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Work+Sans:wght@400;500;600&display=swap"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          fetch(url, { mode: "no-cors" }).then((res) => cache.put(url, res)).catch(() => {})
        )
      )
    )
    // Intentionally no self.skipWaiting() here — a new version stays "waiting"
    // until the person clicks Reload on the update toast (see SKIP_WAITING message below).
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING"){
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  const keep = [SHELL_CACHE, DATA_CACHE, MEDIA_CACHE];
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => !keep.includes(n)).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

function isSupabaseData(url){
  return url.pathname.includes("/rest/v1/") || url.pathname.includes("/auth/v1/");
}
function isSupabaseMedia(url){
  return url.pathname.includes("/storage/v1/object/public/");
}

self.addEventListener("sync", (event) => {
  if (event.tag === "symoh-outbox-sync"){
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => client.postMessage({ type: "PROCESS_OUTBOX" }));
      })
    );
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Navigations (the app shell itself): network-first, fall back to cache so it still loads offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(SHELL_CACHE).then((c) => c.put("./index.html", res.clone()));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Supabase REST/auth GET calls: network-first, cache the response for offline viewing.
  if (req.method === "GET" && isSupabaseData(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(DATA_CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Uploaded media (images/videos/files) and thumbnails: cache-first, since files rarely change once shipped.
  if (isSupabaseMedia(url) || url.hostname.includes("qrserver.com")) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) caches.open(MEDIA_CACHE).then((c) => c.put(req, res.clone()));
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Everything else (fonts, the Supabase JS bundle, icons): cache-first with background refresh.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        caches.open(SHELL_CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
