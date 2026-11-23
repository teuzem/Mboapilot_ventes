/* Utilitaires PWA : type d'appareil, bannière d'installation, service worker. */

const CLE_FERMETURE = "mboa_install_fermetures";
const CLE_INSTALLE = "mboa_install_termine";

export function typeAppareil() {
  const ua = navigator.userAgent || "";
  const iphone = /iPhone|iPod/i.test(ua);
  const ipad = /iPad/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const mobile = /Mobile/i.test(ua) || iphone;
  if (iphone) return { famille: "ios", taille: "telephone", ios: true };
  if (ipad) return { famille: "ios", taille: "tablette", ios: true };
  if (android) {
    return { famille: "android", taille: mobile ? "telephone" : "tablette", ios: false };
  }
  return { famille: "ordinateur", taille: "ordinateur", ios: false };
}

export function texteBanniere(appareil) {
  if (appareil.ios && appareil.taille === "telephone") {
    return {
      message: "Sur iPhone, touchez Partager dans Safari, puis Ajouter à l'écran d'accueil.",
      etapes: "1 Partager  2 Ajouter à l'écran d'accueil  3 Terminé",
      action: "Compris",
    };
  }
  if (appareil.ios) {
    return {
      message: "Sur iPad, touchez Partager dans Safari, puis Ajouter à l'écran d'accueil.",
      etapes: "1 Partager  2 Ajouter à l'écran d'accueil  3 Terminé",
      action: "Compris",
    };
  }
  if (appareil.taille === "tablette") {
    return {
      message: "Installez MboaPilot sur votre tablette. L'icône apparaît sur l'écran d'accueil.",
      etapes: "",
      action: "Installer",
    };
  }
  if (appareil.famille === "android") {
    return {
      message: "Installez MboaPilot sur votre téléphone. L'icône apparaît à l'écran d'accueil.",
      etapes: "",
      action: "Installer",
    };
  }
  return {
    message: "Installez MboaPilot sur cet ordinateur. L'application s'ouvre ensuite comme un programme.",
    etapes: "",
    action: "Installer",
  };
}

export function doitAfficher() {
  try {
    if (localStorage.getItem(CLE_INSTALLE) === "1") return false;
    const fermetures = Number(localStorage.getItem(CLE_FERMETURE) || 0);
    return fermetures < 2;
  } catch (e) {
    return true;
  }
}

export function enregistrerFermeture() {
  try {
    const n = Number(localStorage.getItem(CLE_FERMETURE) || 0) + 1;
    localStorage.setItem(CLE_FERMETURE, String(n));
  } catch (e) { /* stockage indisponible */ }
}

export function enregistrerInstallation() {
  try {
    localStorage.setItem(CLE_INSTALLE, "1");
  } catch (e) { /* stockage indisponible */ }
}

export function enregistrerPrompt(evenement) {
  if (typeof window !== "undefined") window.__mboaPrompt = evenement;
}

export async function declencherInstallation() {
  const prompt = typeof window !== "undefined" ? window.__mboaPrompt : null;
  if (!prompt) return false;
  prompt.prompt();
  const choix = await prompt.userChoice.catch(() => ({ outcome: "dismissed" }));
  window.__mboaPrompt = null;
  if (choix.outcome === "accepted") enregistrerInstallation();
  return choix.outcome === "accepted";
}

export function enregistrerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((inscription) => {
      inscription.addEventListener("updatefound", () => {
        const nouveau = inscription.installing;
        if (!nouveau) return;
        nouveau.addEventListener("statechange", () => {
          if (nouveau.state === "installed" && navigator.serviceWorker.controller) {
            nouveau.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    }).catch(() => {});
  });
}

export function masquerSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  splash.classList.add("cache");
  window.setTimeout(() => splash.remove(), 400);
}
