/* MboaPilot, service worker. Versions explicites, cache public uniquement. */
const VERSION = "mboapilot-v1-0-0";
const CACHE_STATIC = VERSION + "-static";
const CACHE_RUNTIME = VERSION + "-runtime";
const CACHES = [CACHE_STATIC, CACHE_RUNTIME];

const CORE = [
  "/",
  "/logo.svg",
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-icon-192.png",
  "/icons/maskable-icon-512.png"
];

const PUBLIQUES = [
  "/", "/fonctionnalites", "/tarifs", "/securite", "/contact",
  "/mentions-legales", "/confidentialite", "/cgu", "/partenaires"
];

const PREFIXES_PUBLICS = [
  "/assets/", "/img/", "/icons/", "/splash/", "/screenshots/"
];

function estPublic(url) {
  if (url.origin !== self.location.origin) return false;
  const chemin = url.pathname;
  if (chemin.startsWith("/api/")) return false;
  if (chemin.startsWith("/media/")) return false;
  if (chemin === "/app" || chemin.startsWith("/app/")) return false;
  if (chemin.startsWith("/partenaires/espace") ||
      chemin.startsWith("/partenaires/connexion") ||
      chemin.startsWith("/partenaires/suivi")) return false;
  if (PUBLIQUES.includes(chemin)) return true;
  return PREFIXES_PUBLICS.some((p) => chemin.startsWith(p));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(
        cles.filter((cle) => cle.startsWith("mboapilot-") && !CACHES.includes(cle))
            .map((cle) => caches.delete(cle))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const requete = event.request;
  if (requete.method !== "GET") return;
  if (requete.headers.has("Authorization")) return;

  const url = new URL(requete.url);
  if (!estPublic(url)) return;

  if (requete.mode === "navigate") {
    event.respondWith(
      fetch(requete)
        .then((reponse) => {
          if (reponse.ok) {
            const copie = reponse.clone();
            caches.open(CACHE_RUNTIME).then((cache) => cache.put(requete, copie));
          }
          return reponse;
        })
        .catch(async () => {
          const cachee = await caches.match(requete);
          return cachee || caches.match("/offline.html");
        })
    );
    return;
  }

  event.respondWith(
    caches.match(requete).then((cachee) => {
      const reseau = fetch(requete)
        .then((reponse) => {
          if (reponse.ok) {
            const copie = reponse.clone();
            caches.open(CACHE_RUNTIME).then((cache) => cache.put(requete, copie));
          }
          return reponse;
        })
        .catch(() => cachee);
      return cachee || reseau;
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("push", (event) => {
  let donnees = { title: "MboaPilot", body: "Nouvelle notification", url: "/app" };
  if (event.data) {
    try {
      donnees = Object.assign({}, donnees, event.data.json());
    } catch (e) {
      donnees.body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(donnees.title, {
      body: donnees.body,
      tag: donnees.tag || "mboapilot",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-96.png",
      data: { url: donnees.url || "/app" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const cible = (event.notification.data && event.notification.data.url) || "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(cible) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(cible);
      return undefined;
    })
  );
});
