/* MboaPilot V2 - client API same-origin, CSRF, FormData, téléchargements. */
let csrfToken = "";
let csrfPromise = null;

export class ApiError extends Error {
  constructor(message, status = 0, code = "", data = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

async function ensureCsrf(force = false) {
  if (csrfToken && !force) return csrfToken;
  if (!csrfPromise) {
    csrfPromise = fetch("/api/auth/csrf", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(async (r) => {
        if (!r.ok) throw new ApiError("Impossible d'initialiser la sécurité de la session.", r.status);
        return r.json();
      })
      .then((d) => { csrfToken = d.csrf || ""; return csrfToken; })
      .finally(() => { csrfPromise = null; });
  }
  return csrfPromise;
}

const ECRITURES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function request(url, options = {}, retry = true) {
  const { method = "GET", body, headers = {}, ...rest } = options;
  const opts = {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...headers },
    ...rest,
  };
  if (body !== undefined && body !== null) {
    if (body instanceof FormData) {
      opts.body = body; // ne jamais fixer Content-Type : le navigateur pose la frontière.
    } else {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
  }
  if (ECRITURES.has(method.toUpperCase())) {
    opts.headers["X-CSRF-Token"] = await ensureCsrf();
  }
  let response;
  try {
    response = await fetch(url, opts);
  } catch {
    throw new ApiError("Connexion au serveur impossible. Vérifiez votre réseau.", 0, "network");
  }
  const type = response.headers.get("content-type") || "";
  let data = null;
  if (type.includes("application/json")) data = await response.json().catch(() => null);
  else data = await response.text().catch(() => "");
  if (response.status === 400 && data && data.code === "csrf" && retry) {
    await ensureCsrf(true);
    return request(url, options, false);
  }
  if (!response.ok) {
    const message = (data && data.message) || `Erreur ${response.status}.`;
    if (response.status === 401 && !url.includes("/api/auth/me")) {
      window.dispatchEvent(new CustomEvent("mboa:unauthorized", { detail: data }));
    }
    throw new ApiError(message, response.status, (data && data.code) || "", data);
  }
  return data;
}

async function download(url, fallback = "mboapilot-export") {
  let response;
  try {
    response = await fetch(url, { credentials: "same-origin", headers: { Accept: "*/*" } });
  } catch {
    throw new ApiError("Téléchargement impossible : réseau indisponible.", 0, "network");
  }
  if (!response.ok) {
    let data = null;
    try { data = await response.json(); } catch { /* binaire */ }
    throw new ApiError((data && data.message) || "Téléchargement refusé.", response.status, "", data);
  }
  const disposition = response.headers.get("content-disposition") || "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const nom = decodeURIComponent(match?.[1] || fallback);
  const blob = await response.blob();
  const lien = document.createElement("a");
  const objet = URL.createObjectURL(blob);
  lien.href = objet;
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(objet), 4000);
  return nom;
}

export const api = {
  get: (url) => request(url),
  post: (url, body = {}) => request(url, { method: "POST", body }),
  put: (url, body = {}) => request(url, { method: "PUT", body }),
  patch: (url, body = {}) => request(url, { method: "PATCH", body }),
  del: (url) => request(url, { method: "DELETE" }),
  upload: (url, formData, method = "POST") => request(url, { method, body: formData }),
  download,
  csrf: () => ensureCsrf(),
};

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

export const fmt = (n) => nf.format(Math.round(Number(n) || 0));
export const fmtFCFA = (n) => `${fmt(n)} FCFA`;
export const fmtDec = (n) => nf2.format(Number(n) || 0);

export function fmtCompact(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e9) return `${nf2.format(v / 1e9)} Md`;
  if (Math.abs(v) >= 1e6) return `${nf2.format(v / 1e6)} M`;
  if (Math.abs(v) >= 1e3) return `${nf2.format(v / 1e3)} k`;
  return fmt(v);
}

export const pct = (v, signe = true) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "-";
  const n = Number(v);
  return `${signe && n > 0 ? "+" : ""}${nf2.format(n)} %`;
};

export function dateFR(value, avecHeure = false) {
  if (!value) return "-";
  const d = new Date(String(value).replace(" ", "T") + (String(value).includes("Z") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
    ...(avecHeure ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export const classe = (...xs) => xs.filter(Boolean).join(" ");
