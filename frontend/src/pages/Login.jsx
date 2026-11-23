import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import BoltIcon from "@mui/icons-material/Bolt";
import ShieldIcon from "@mui/icons-material/Shield";
import LockIcon from "@mui/icons-material/Lock";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import { api } from "../api";
import { useAuth } from "../auth";
import { Logo, Spinner } from "../components";

function decodeB64url(texte) {
  const pad = "=".repeat((4 - (texte.length % 4)) % 4);
  const binaire = atob(texte.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(binaire, (c) => c.charCodeAt(0));
}

function encodeB64url(buffer) {
  const octets = new Uint8Array(buffer);
  let binaire = "";
  for (const o of octets) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default function Login() {
  const nav = useNavigate();
  const { user, ready, setUser } = useAuth();
  const [login, setLogin] = useState("");
  const [pwd, setPwd] = useState("");
  const [voir, setVoir] = useState(false);
  const [err, setErr] = useState("");
  const [envoi, setEnvoi] = useState("");
  const [comptes, setComptes] = useState([]);

  useEffect(() => {
    api.get("/api/auth/demo-secrets").then((r) => setComptes(r.comptes || [])).catch(() => {});
  }, []);

  if (ready && user) return <Navigate to="/app" replace />;

  const connecter = async (lg, pw) => {
    setErr(""); setEnvoi(lg);
    try {
      const r = await api.post("/api/auth/login", { login: lg.trim(), password: pw });
      if (r.mfa_required) nav("/mfa", { state: { challenge: r }, replace: true });
      else { setUser(r.user); nav("/app", { replace: true }); }
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setEnvoi("");
    }
  };
  const go = (e) => { e.preventDefault(); connecter(login, pwd); };

  const connecterPasskey = async () => {
    setErr("");
    if (!window.PublicKeyCredential) {
      setErr("Ce navigateur ne prend pas en charge les passkeys.");
      return;
    }
    const identifiant = login.trim();
    if (!identifiant) {
      setErr("Saisissez votre identifiant pour utiliser une passkey.");
      return;
    }
    setEnvoi("passkey");
    try {
      const options = await api.post("/api/webauthn/auth-options", { login: identifiant });
      options.challenge = decodeB64url(options.challenge);
      if (options.allowCredentials) {
        options.allowCredentials = options.allowCredentials.map((c) => ({ ...c, id: decodeB64url(c.id) }));
      }
      const cred = await navigator.credentials.get({ publicKey: options });
      if (!cred) throw new Error("Authentification annulée.");
      const rep = await api.post("/api/webauthn/auth-verify", {
        id: cred.id,
        rawId: encodeB64url(cred.rawId),
        type: cred.type,
        response: {
          authenticatorData: encodeB64url(cred.response.authenticatorData),
          clientDataJSON: encodeB64url(cred.response.clientDataJSON),
          signature: encodeB64url(cred.response.signature),
          userHandle: cred.response.userHandle ? encodeB64url(cred.response.userHandle) : null,
        },
        clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      });
      setUser(rep.user);
      nav("/app", { replace: true });
    } catch (ex) {
      setErr(ex.message || "Passkey refusée.");
    } finally {
      setEnvoi("");
    }
  };

  return (
    <div className="auth-page auth-v2">
      <div className="auth-side">
        <img className="bg" src="/img/hero-marche.jpg" alt="Marché au Cameroun" />
        <div className="auth-side-top"><Logo light /><span className="auth-side-badge"><ShieldIcon /> Espace sécurisé</span></div>
        <div className="auth-side-content">
          <span className="eyebrow" style={{ background: "rgba(255,255,255,.12)", color: "#fff", border: 0 }}><span className="dot" /> Cockpit MboaPilot</span>
          <blockquote>« Le lundi 8h, je sais ce que chaque boutique a vendu le week-end. »</blockquote>
          <cite>Ngo Bell K., directrice réseau, Douala</cite>
          <div className="auth-security">
            <span><QrCode2Icon /> MFA TOTP</span>
            <span><LockIcon /> CSRF & sessions</span>
            <span><VerifiedUserIcon /> Audit chaîné</span>
          </div>
        </div>
      </div>
      <div className="auth-form">
        <div className="auth-box">
          <span className="eyebrow"><span className="dot" /> Étape 1 / 2 · identité</span>
          <h1>Bon retour.</h1>
          <p className="auth-sub">Identifiant et mot de passe, puis vérification par authenticator ou code de secours. Session de 30 minutes, compte verrouillé après 5 échecs.</p>
          {err && <div className="alert" role="alert">{err}</div>}
          <form onSubmit={go}>
            <div className="field">
              <label htmlFor="login">Identifiant</label>
              <input id="login" value={login} onChange={(e) => setLogin(e.target.value)} required autoComplete="username" placeholder="ex. demo" autoFocus />
            </div>
            <div className="field">
              <label htmlFor="password">Mot de passe</label>
              <span className="pw-wrap">
                <input id="password" type={voir ? "text" : "password"} value={pwd} onChange={(e) => setPwd(e.target.value)} required autoComplete="current-password" placeholder="••••••••••••" />
                <button type="button" onClick={() => setVoir(!voir)}>{voir ? "Masquer" : "Afficher"}</button>
              </span>
            </div>
            <button className="btn btn-brand btn-lg btn-block" disabled={Boolean(envoi)}>
              {envoi ? <><Spinner inline label="" /> Ouverture…</> : <>Continuer <ArrowForwardIcon /></>}
            </button>
          </form>
          <button className="btn btn-outline btn-block" type="button" onClick={connecterPasskey} disabled={Boolean(envoi)} style={{ marginTop: 12 }}>
            <VerifiedUserIcon /> Se connecter avec une passkey
          </button>
          <input type="text" name="username" autoComplete="username webauthn" style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 1, height: 1 }} tabIndex={-1} aria-hidden="true" />
          <div className="auth-links">
            <Link to="/reset">Mot de passe oublié ?</Link>
            <span>·</span>
            <Link to="/inscription">Créer un compte</Link>
            <span>·</span>
            <Link to="/">Retour au site</Link>
          </div>

          {comptes.length > 0 && (
            <details className="demo-access">
              <summary><BoltIcon /> Connexion démo en 1 clic · jury</summary>
              <div className="demo-grid">
                {comptes.map((c) => (
                  <button key={c.login} className="demo-account" disabled={Boolean(envoi)} onClick={() => { setLogin(c.login); setPwd(c.password); connecter(c.login, c.password); }}>
                    <span className="demo-avatar" style={{ background: { Admin: "#635BFF", Manager: "#00A36C", Commercial: "#0A2540", Auditeur: "#B47800" }[c.role] || "#697386" }}>{c.login.slice(0, 1).toUpperCase()}</span>
                    <span><b>{c.login}</b><small>{c.role} · {c.perimetre}</small></span>
                    <ArrowForwardIcon />
                  </button>
                ))}
              </div>
              <p className="demo-note">Recommandé pour la démonstration : <b>demo</b> (vue nationale) ou <b>commercial</b> (périmètre Littoral). Le code TOTP courant est fourni à l'étape suivante en mode démo.</p>
            </details>
          )}
          <p className="auth-legal"><ShieldIcon /> Vos tentatives sont limitées et journalisées. Aucune donnée n'est utilisée hors de votre périmètre.</p>
        </div>
      </div>
    </div>
  );
}
