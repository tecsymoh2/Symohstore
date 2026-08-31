const VERSION = "v1";
const SHELL_CACHE = `symoh-contacts-shell-${VERSION}`;
const DATA_CACHE = `symoh-contacts-data-${VERSION}`;

const APP_SHELL = [
  "./contacts.html",
  "./contacts-manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js",
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
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  const keep = [SHELL_CACHE, DATA_CACHE];
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n.startsWith("symoh-contacts-") && !keep.includes(n)).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

function isContactsRestCall(url){
  return url.pathname.includes("/rest/v1/contacts") || url.pathname.includes("/auth/v1/");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never cache signed photo URLs — they expire hourly and differ every load.
  if (url.pathname.includes("/storage/v1/object/sign/")) return;

  if (req.mode === "navigate"){
    event.respondWith(
      fetch(req)
        .then((res) => { caches.open(SHELL_CACHE).then((c) => c.put("./contacts.html", res.clone())); return res; })
        .catch(() => caches.match("./contacts.html"))
    );
    return;
  }

  if (req.method === "GET" && isContactsRestCall(url)){
    event.respondWith(
      fetch(req)
        .then((res) => { if (res.ok) caches.open(DATA_CACHE).then((c) => c.put(req, res.clone())); return res; })
        .catch(() => caches.match(req))
    );
    return;
  }

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
