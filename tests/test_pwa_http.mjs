const base = "http://127.0.0.1:5000";
const pages = [
  ["/", "text/html"],
  ["/manifest.webmanifest", "application/manifest+json"],
  ["/sw.js", "application/javascript"],
  ["/offline.html", "text/html"],
  ["/icons/icon-192.png", "image/png"],
  ["/icons/maskable-icon-512.png", "image/png"],
  ["/splash/iphone-1170x2532.png", "image/png"],
  ["/screenshots/desktop.png", "image/png"],
  ["/screenshots/mobile.png", "image/png"],
  ["/sitemap.xml", "xml"],
  ["/robots.txt", "text/plain"],
  ["/.well-known/assetlinks.json", "application/json"],
  ["/app", "text/html"],
  ["/fonctionnalites", "text/html"],
];
let n = 0;
for (const [chemin, type] of pages) {
  const r = await fetch(base + chemin);
  const ct = r.headers.get("content-type") || "";
  if (!r.ok || !ct.includes(type)) {
    throw new Error(chemin + " -> " + r.status + " " + ct);
  }
  console.log("PASS", chemin, r.status, ct.split(";")[0]);
  n += 1;
}
console.log("\n" + n + " TESTS HTTP PASS");
