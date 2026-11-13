/* Kort service worker: keeps the app shell and recipe photos available offline. */
const CACHE = "kort-v5"; // bumped 2026-11-13: never keep a login redirect as the app shell

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Only our own, directly served responses are worth keeping. When the login
 * cookie is missing or expired, the gallab login redirects the request to
 * auth.gallab.top; that page is "ok" too, and caching it as "/" would make the
 * home-screen app open on a login page it cannot complete (and browsers refuse
 * to serve a redirected response for a navigation at all).
 */
function cacheable(res, url) {
  if (!res.ok || res.redirected) return false;
  try {
    return new URL(res.url || url).origin === self.location.origin;
  } catch {
    return false;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Live data (our API) is never cached by the worker.
  if (url.pathname.startsWith("/api/")) return;

  const isImage =
    req.destination === "image" || /\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/i.test(url.pathname);

  if (isImage) {
    // Photos: cache first, then network.
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if ((res.ok && !res.redirected) || res.type === "opaque") cache.put(req, res.clone());
          return res;
        } catch {
          return hit ?? Response.error();
        }
      }),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // App shell and bundles: network first, cached copy when offline.
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(req);
          if (cacheable(res, req.url)) cache.put(req, res.clone());
          return res;
        } catch {
          const hit = await cache.match(req);
          if (hit) return hit;
          if (req.mode === "navigate") {
            const shell = await cache.match("/");
            if (shell) return shell;
          }
          return Response.error();
        }
      })(),
    );
  }
});
