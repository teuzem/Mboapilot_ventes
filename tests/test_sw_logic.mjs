import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const code = fs.readFileSync(path.join(racine, "frontend/dist/sw.js"), "utf8");

const gestionnaires = {};
const ecritures = [];
const suppressions = [];
const notifications = [];

const cache = {
  addAll: async (liste) => { ecritures.push(...liste); },
  put: async (req) => { ecritures.push(String(req && req.url ? req.url : req)); },
};
const caches = {
  open: async () => cache,
  keys: async () => ["mboapilot-v0-static", "mboapilot-v1-0-0-static"],
  delete: async (cle) => { suppressions.push(cle); return true; },
  match: async () => undefined,
};
const self = {
  location: { origin: "http://127.0.0.1:5000" },
  addEventListener: (type, fn) => { gestionnaires[type] = fn; },
  skipWaiting: async () => { gestionnaires._skip = true; },
  clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
  registration: { showNotification: async (t, o) => { notifications.push([t, o]); } },
};
const fetch = async (req) => ({ ok: true, clone: () => ({}) });

vm.runInNewContext(code, { self, caches, fetch, URL, Promise, console, Object, String });

function requete(url, mode = "same-origin") {
  return { method: "GET", url, mode, headers: { has: () => false } };
}
function declencher(req) {
  let reponse;
  gestionnaires.fetch({ request: req, respondWith: (p) => { reponse = p; } });
  return reponse;
}

await gestionnaires.install({ waitUntil: (p) => p });
await gestionnaires.activate({ waitUntil: (p) => p });

const ok = [];
const verifier = (nom, cond) => { if (!cond) throw new Error(nom); ok.push(nom); console.log("PASS", nom); };

verifier("installation enregistree", typeof gestionnaires.install === "function");
verifier("ancien cache supprime", suppressions.includes("mboapilot-v0-static"));
verifier("nouveau cache conserve", !suppressions.includes("mboapilot-v1-0-0-static"));
verifier("ressources de base mises en cache", ecritures.includes("/offline.html"));

ecritures.length = 0;
await declencher(requete("http://127.0.0.1:5000/api/dashboard"));
verifier("API jamais mise en cache", ecritures.length === 0);

ecritures.length = 0;
await declencher(requete("http://127.0.0.1:5000/app", "navigate"));
verifier("espace connecte jamais mis en cache", ecritures.length === 0);

ecritures.length = 0;
await declencher(requete("http://127.0.0.1:5000/partenaires/espace", "navigate"));
verifier("espace partenaire jamais mis en cache", ecritures.length === 0);

ecritures.length = 0;
await declencher(requete("http://127.0.0.1:5000/", "navigate"));
verifier("page publique mise en cache", ecritures.length > 0);

ecritures.length = 0;
await declencher(requete("http://127.0.0.1:5000/assets/index-BOnMpqNN.js"));
verifier("assets statiques mis en cache", ecritures.length > 0);

await gestionnaires.push({ data: { json: () => ({ title: "Alerte", body: "Test" }) }, waitUntil: (p) => p });
verifier("notification poussée affichee", notifications.length === 1 && notifications[0][0] === "Alerte");

gestionnaires.message({ data: { type: "SKIP_WAITING" } });
verifier("mise a jour appliquee", gestionnaires._skip === true);

console.log("\n" + ok.length + " TESTS SERVICE WORKER PASS");
