import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import SmsIcon from "@mui/icons-material/Sms";
import KeyIcon from "@mui/icons-material/Key";
import ShieldIcon from "@mui/icons-material/Shield";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DownloadIcon from "@mui/icons-material/Download";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import BoltIcon from "@mui/icons-material/Bolt";
import { api } from "../api";
import { useAuth } from "../auth";
import { Logo, Spinner } from "../components";

function telechargerCodes(codes, login) {
  const texte = [
    "MboaPilot — codes de secours MFA",
    `Compte : ${login}`,
    `Générés le : ${new Date().toLocaleString("fr-FR")}`,
    "",
    "Chaque code est à usage unique. Conservez ce fichier hors ligne.",
    "",
    ...codes,
    "",
  ].join("\n");
  const blob = new Blob([texte], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mboapilot-codes-secours-${login}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

export default function Mfa() {
  const nav = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();
  const initial = location.state?.challenge || null;
  const [defi, setDefi] = useState(initial);
  const [chargement, setChargement] = useState(!initial);
  const [code, setCode] = useState(initial?.code_demo || "");
  const [secours, setSecours] = useState("");
  const [modeSecours, setModeSecours] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [codes, setCodes] = useState(null);
  const [confirme, setConfirme] = useState(false);
  const [copie, setCopie] = useState(false);
  const [resetKey, setResetKey] = useState(Date.now());

  useEffect(() => {
    if (defi) { setChargement(false); return; }
    api.get("/api/auth/mfa/etat")
      .then((r) => { setDefi(r); if (r.code_demo) setCode(r.code_demo); })
      .catch((ex) => setErr(ex.message))
      .finally(() => setChargement(false));
  }, [defi]);

  const valider = async (e) => {
    e?.preventDefault();
    setErr(""); setInfo(""); setEnvoi(true);
    try {
      const charge = modeSecours ? { recovery_code: secours.trim() } : { code: code.replace(/\s/g, "") };
      const r = await api.post("/api/auth/mfa-confirmer", charge);
      setUser(r.user);
      if (r.recovery_codes) {
        setCodes(r.recovery_codes);
        setInfo(r.message || "MFA activé. Conservez ces codes de secours.");
      } else {
        nav("/app", { replace: true });
      }
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setEnvoi(false);
    }
  };

  const rafraichirDemo = async () => {
    setErr("");
    try {
      const r = await api.get("/api/auth/mfa/etat");
      setDefi(r);
      if (r.code_demo) { setCode(r.code_demo); setInfo("Code TOTP courant actualisé."); }
      setResetKey(Date.now());
    } catch (ex) { setErr(ex.message); }
  };

  const demanderCode = async () => {
    setErr(""); setInfo("");
    try {
      const r = await api.post("/api/auth/mfa-demande");
      if (r.code_demo) { setCode(r.code_demo); setInfo("Code de vérification simulé reçu. Il est valable 10 minutes."); }
      else setInfo(r.message || "Un code a été envoyé à l'email du compte.");
    } catch (ex) { setErr(ex.message); }
  };

  const copierSecret = async () => {
    try { await navigator.clipboard.writeText(defi?.secret || ""); setInfo("Clé TOTP copiée."); } catch { /* refus */ }
  };
  const copierCodes = useCallback(async () => {
    try {
      await navigator.clipboard.writeText((codes || []).join("\n"));
      setCopie(true);
      setTimeout(() => setCopie(false), 1800);
    } catch { /* refus */ }
  }, [codes]);

  if (chargement) {
    return <div className="auth-page auth-v2"><div className="auth-form"><div className="auth-box"><Spinner label="Vérification de votre défi…" /></div></div></div>;
  }

  if (!defi) {
    return (
      <div className="auth-page auth-v2">
        <div className="auth-side">
          <img className="bg" src="/img/point-vente.jpg" alt="Point de vente, Cameroun" />
          <div className="auth-side-top"><Logo light /></div>
          <div className="auth-side-content"><blockquote>La vérification a expiré.</blockquote><cite>Reconnectez-vous pour reprendre la main.</cite></div>
        </div>
        <div className="auth-form"><div className="auth-box">
          <span className="eyebrow"><span className="dot" /> Session de vérification</span>
          <h1>Défi expiré.</h1>
          <p className="auth-sub">{err || "Le défi MFA a expiré ou la page a été ouverte sans connexion préalable."}</p>
          <Link className="btn btn-brand btn-lg btn-block" to="/login">Revenir à la connexion <ArrowForwardIcon /></Link>
        </div></div>
      </div>
    );
  }

  if (codes) {
    return (
      <div className="auth-page auth-v2">
        <div className="auth-side">
          <img className="bg" src="/img/hero-marche.jpg" alt="Marché au Cameroun" />
          <div className="auth-side-top"><Logo light /><span className="auth-side-badge"><ShieldIcon /> MFA activée</span></div>
          <div className="auth-side-content">
            <blockquote>Votre authenticator est votre clé. Ces codes sont votre filet de sécurité.</blockquote>
            <cite>Étape unique · codes à usage unique · à conserver hors ligne</cite>
          </div>
        </div>
        <div className="auth-form"><div className="auth-box auth-box-wide">
          <span className="eyebrow"><span className="dot" /> Vérification terminée</span>
          <h1>Vos codes de secours.</h1>
          <p className="auth-sub">{info || "Conservez ces 10 codes hors ligne. Ils ne seront plus jamais affichés et chaque code ne sert qu'une fois."}</p>
          <div className="recovery-grid">
            {codes.map((c) => <code key={c}>{c}</code>)}
          </div>
          <div className="recovery-actions">
            <button className="btn btn-outline" onClick={copierCodes}><ContentCopyIcon /> {copie ? "Copiés" : "Copier tout"}</button>
            <button className="btn btn-outline" onClick={() => telechargerCodes(codes, defi.login)}><DownloadIcon /> Télécharger .txt</button>
          </div>
          <label className="check-line">
            <input type="checkbox" checked={confirme} onChange={(e) => setConfirme(e.target.checked)} />
            <span>J'ai enregistré ces codes hors ligne et je comprends qu'ils ne seront plus affichés.</span>
          </label>
          <button className="btn btn-brand btn-lg btn-block" disabled={!confirme} onClick={() => nav("/app", { replace: true })}>
            Entrer dans MboaPilot <ArrowForwardIcon />
          </button>
        </div></div>
      </div>
    );
  }

  const setup = defi.mode === "setup";
  return (
    <div className="auth-page auth-v2">
      <div className="auth-side">
        <img className="bg" src={setup ? "/img/point-vente.jpg" : "/img/hero-marche.jpg"} alt="Point de vente, Cameroun" />
        <div className="auth-side-top"><Logo light /><span className="auth-side-badge"><ShieldIcon /> Étape 2 / 2</span></div>
        <div className="auth-side-content">
          {setup ? (
            <>
              <blockquote>Scannez, vérifiez, entrez. Votre authenticator remplace tous les codes par SMS.</blockquote>
              <cite>Compatible Google Authenticator, Microsoft Authenticator, 1Password, Authy</cite>
            </>
          ) : (
            <>
              <blockquote>Le bon code au bon moment. Votre session s'ouvre, les autres restent protégées.</blockquote>
              <cite>{defi.nom || defi.login} · {defi.email_masque || "email du compte"}</cite>
            </>
          )}
          <div className="auth-security">
            <span><QrCode2Icon /> TOTP 30 s</span>
            <span><KeyIcon /> Codes de secours</span>
            <span><ShieldIcon /> Anti-rejeu</span>
          </div>
        </div>
      </div>
      <div className="auth-form">
        <div className="auth-box auth-box-wide">
          <div className="mfa-stepper"><span className="done"><CheckCircleIcon /> Identité</span><i /><span className="on">Vérification</span></div>
          {setup ? (
            <>
              <span className="eyebrow"><span className="dot" /> Premier enrôlement</span>
              <h1>Activez votre MFA.</h1>
              <p className="auth-sub">Ouvrez votre application d'authentification, scannez le QR puis saisissez le code à 6 chiffres. La clé manuelle est disponible si le scan échoue.</p>
              {err && <div className="alert">{err}</div>}
              {info && <div className="ok">{info}</div>}
              <div className="mfa-setup">
                <div className="qr-frame">
                  <img key={resetKey} src={`/api/auth/mfa/qr?t=${resetKey}`} alt="QR code d'enrôlement TOTP" />
                  <span>MboaPilot · {defi.login}</span>
                </div>
                <div className="mfa-setup-info">
                  <b>Clé manuelle</b>
                  <div className="secret-line"><code>{String(defi.secret || "").replace(/(.{4})/g, "$1 ").trim()}</code><button className="icon-btn" onClick={copierSecret} title="Copier la clé"><ContentCopyIcon /></button></div>
                  <p>Émetteur : <b>MboaPilot</b><br />Compte : <b>{defi.login}</b><br />Type : <b>TOTP · 6 chiffres · 30 s</b></p>
                  {defi.code_demo && (
                    <button type="button" className="demo-code-chip" onClick={() => setCode(defi.code_demo)}>
                      <BoltIcon /> Code démo courant : <b>{defi.code_demo}</b>
                    </button>
                  )}
                </div>
              </div>
              <form onSubmit={valider}>
                <div className="field"><label htmlFor="code">Code de vérification</label>
                  <input id="code" className="mfa-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required autoFocus placeholder="······" />
                </div>
                <button className="btn btn-brand btn-lg btn-block" disabled={envoi}>{envoi ? <><Spinner inline label="" /> Vérification…</> : <>Activer la MFA et entrer <ArrowForwardIcon /></>}</button>
              </form>
              <p className="auth-legal"><ShieldIcon /> L'enrôlement est journalisé. Si vous perdez l'appareil, utilisez un code de secours.</p>
            </>
          ) : (
            <>
              <span className="eyebrow"><span className="dot" /> Session protégée</span>
              <h1>Un dernier code.</h1>
              <p className="auth-sub">Saisissez le code à 6 chiffres de votre application d'authentification pour <b>{defi.login}</b>. Vous pouvez aussi utiliser un code de secours à usage unique.</p>
              {err && <div className="alert" role="alert">{err}</div>}
              {info && <div className="ok">{info}</div>}
              <div className="mfa-tabs">
                <button className={!modeSecours ? "on" : ""} onClick={() => { setModeSecours(false); setErr(""); }}><QrCode2Icon /> Authenticator</button>
                <button className={modeSecours ? "on" : ""} onClick={() => { setModeSecours(true); setErr(""); }}><KeyIcon /> Code de secours</button>
              </div>
              <form onSubmit={valider}>
                {modeSecours ? (
                  <div className="field"><label htmlFor="secours">Code de secours</label>
                    <input id="secours" className="mfa-recovery" value={secours} onChange={(e) => setSecours(e.target.value.toUpperCase().slice(0, 11))} placeholder="XXXXX-XXXXX" required autoFocus />
                    <small>Chaque code ne fonctionne qu'une seule fois. {defi.recovery_disponible ? "Des codes sont disponibles." : "Aucun code de secours restant."}</small>
                  </div>
                ) : (
                  <div className="field"><label htmlFor="code">Code à 6 chiffres</label>
                    <input id="code" className="mfa-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required autoFocus placeholder="······" />
                    {defi.code_demo && <button type="button" className="demo-code-chip" onClick={() => setCode(defi.code_demo)}><BoltIcon /> Mode démo : <b>{defi.code_demo}</b></button>}
                  </div>
                )}
                <button className="btn btn-brand btn-lg btn-block" disabled={envoi}>{envoi ? <><Spinner inline label="" /> Vérification…</> : <>Ouvrir mon espace <ArrowForwardIcon /></>}</button>
              </form>
              <div className="mfa-help">
                <button onClick={rafraichirDemo}><BoltIcon /> Actualiser le code démo</button>
                <button onClick={demanderCode}><SmsIcon /> Recevoir un code par email</button>
              </div>
              <p className="auth-legal"><ShieldIcon /> {defi.expire_minutes ?? 10} minute(s) restante(s). {defi.recovery_disponible ? "Codes de secours disponibles." : "Pensez à régénérer vos codes de secours dans Mon compte."}</p>
            </>
          )}
          <Link className="back-link" to="/login"><ArrowBackIcon /> Revenir à la connexion</Link>
        </div>
      </div>
    </div>
  );
}
