import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lire = (p) => fs.readFileSync(path.join(racine, p), "utf8");
const ok = [];
const verifier = (nom, condition) => {
  if (!condition) throw new Error(nom);
  ok.push(nom);
  console.log("PASS", nom);
};

const manifest = JSON.parse(lire("frontend/dist/manifest.webmanifest"));
verifier("manifeste nom court", manifest.short_name === "MboaPilot");
verifier("manifeste nom long", manifest.name.length > 10);
verifier("manifeste description", manifest.description.length > 30);
verifier("manifeste plein ecran", manifest.display === "fullscreen");
verifier("manifeste orientation", manifest.orientation === "portrait-primary");
verifier("manifeste couleurs", manifest.theme_color === "#0A2540" && manifest.background_color === "#0A2540");
verifier("manifeste demarrage", manifest.start_url === "/app");
verifier("manifeste raccourcis", manifest.shortcuts.length >= 3);
verifier("manifeste captures", manifest.screenshots.length === 2 &&
  manifest.screenshots.some((s) => s.form_factor === "wide") &&
  manifest.screenshots.some((s) => s.form_factor === "narrow"));
const any = manifest.icons.filter((i) => i.purpose === "any");
const maskable = manifest.icons.filter((i) => i.purpose === "maskable");
verifier("icones classiques 192 et 512", [192, 512].every((t) => any.some((i) => i.sizes === t + "x" + t)));
verifier("icones maskable 192 et 512", [192, 512].every((t) => maskable.some((i) => i.sizes === t + "x" + t)));
verifier("pas de related applications", manifest.prefer_related_applications === false);

const html = lire("frontend/dist/index.html");
const startups = (html.match(/apple-touch-startup-image/g) || []).length;
verifier("19 ecrans de lancement iOS", startups === 19);
verifier("canonical sans placeholder", !html.includes("__PUBLIC_URL__"));
verifier("meta langues", html.includes('hreflang="fr"') && html.includes('hreflang="en"'));
verifier("OpenGraph et Twitter", html.includes('property="og:title"') && html.includes('name="twitter:card"'));
verifier("theme color", html.includes('name="theme-color"'));
verifier("splash present", html.includes('id="splash"'));
verifier("reduced motion", html.includes("prefers-reduced-motion"));

const sw = lire("frontend/dist/sw.js");
verifier("versions explicites", /VERSION = "mboapilot-v/.test(sw));
verifier("cache statique et runtime", sw.includes("CACHE_STATIC") && sw.includes("CACHE_RUNTIME"));
verifier("refus API", sw.includes('chemin.startsWith("/api/")') && sw.includes("return false"));
verifier("refus sessions et prive", sw.includes('"/app"') && sw.includes("/partenaires/espace"));
verifier("reponse hors ligne", sw.includes("/offline.html"));
verifier("push conserve", sw.includes('"push"') && sw.includes("showNotification"));
verifier("mise a jour sans casser l interface", sw.includes("SKIP_WAITING"));

const association = JSON.parse(lire("frontend/dist/.well-known/assetlinks.json"));
verifier("assetlinks relation", association[0].relation[0] === "delegate_permission/common.handle_all_urls");
verifier("assetlinks package", association[0].target.package_name === "cm.mboapilot.app");
verifier("assetlinks empreinte", Array.isArray(association[0].target.sha256_cert_fingerprints));

const sitemap = lire("frontend/dist/sitemap.xml");
verifier("sitemap", sitemap.includes("<urlset") && sitemap.includes("mboapilot.cm"));
const robots = lire("frontend/dist/robots.txt");
verifier("robots", robots.includes("Disallow: /api/") && robots.includes("Sitemap:"));

const iconPng = fs.readFileSync(path.join(racine, "frontend/dist/icons/icon-192.png"));
const masquePng = fs.readFileSync(path.join(racine, "frontend/dist/icons/maskable-icon-192.png"));
verifier("icones distinctes", !iconPng.equals(masquePng));
verifier("signature PNG", iconPng.subarray(1, 4).toString() === "PNG");

const globalOld = { navigator: global.navigator, localStorage: global.localStorage };
const magasin = {};
global.localStorage = {
  getItem: (c) => (c in magasin ? magasin[c] : null),
  setItem: (c, v) => { magasin[c] = String(v); },
};
function avecUA(ua, touch = 0) {
  Object.defineProperty(global, "navigator", {
    value: { userAgent: ua, maxTouchPoints: touch },
    configurable: true,
    writable: true,
  });
}
const pwa = await import("../frontend/src/pwa.js");

avecUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15");
verifier("iPhone detecte", pwa.typeAppareil().famille === "ios" && pwa.typeAppareil().taille === "telephone");
verifier("texte iPhone", pwa.texteBanniere(pwa.typeAppareil()).message.includes("Partager"));
avecUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 5);
verifier("iPadOS detecte", pwa.typeAppareil().taille === "tablette" && pwa.typeAppareil().ios);
avecUA("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36");
verifier("Android telephone", pwa.typeAppareil().famille === "android" && pwa.typeAppareil().taille === "telephone");
verifier("action Android", pwa.texteBanniere(pwa.typeAppareil()).action === "Installer");
avecUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36");
verifier("ordinateur detecte", pwa.typeAppareil().famille === "ordinateur");

for (const c of Object.keys(magasin)) delete magasin[c];
verifier("banniere visible au depart", pwa.doitAfficher() === true);
pwa.enregistrerFermeture();
verifier("banniere apres une fermeture", pwa.doitAfficher() === true);
pwa.enregistrerFermeture();
verifier("banniere apres deux fermetures", pwa.doitAfficher() === false);
pwa.enregistrerInstallation();
verifier("installation memorisee", pwa.doitAfficher() === false);

global.navigator = globalOld.navigator;
global.localStorage = globalOld.localStorage;

console.log("\n" + ok.length + " TESTS PWA PASS");
