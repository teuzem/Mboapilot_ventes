import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ShieldIcon from "@mui/icons-material/Shield";
import SmsIcon from "@mui/icons-material/Sms";
import BoltIcon from "@mui/icons-material/Bolt";
import GroupsIcon from "@mui/icons-material/Groups";
import { api } from "../api";
import { Logo, Spinner } from "../components";

export default function PartnerLogin() {
  const nav = useNavigate();
  const [step, setStep] = useState("login");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [defi, setDefi] = useState(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [envoi, setEnvoi] = useState(false);

  const connecter = async (e) => {
    e.preventDefault(); setErr(""); setEnvoi(true);
    try {
      const r = await api.post("/api/partenaires/connexion", { email: email.trim(), password: pwd });
      setDefi(r);
      setStep("mfa");
      if (r.code_demo) setCode(r.code_demo);
    } catch (ex) { setErr(ex.message); }
    setEnvoi(false);
  };

  const verifier = async (e) => {
    e.preventDefault(); setErr(""); setEnvoi(true);
    try {
      await api.post("/api/partenaires/mfa", { code: code.trim() });
      nav("/partenaires/espace", { replace: true });
    } catch (ex) { setErr(ex.message); }
    setEnvoi(false);
  };

  return (
    <div className="auth-page auth-v2 partner-auth">
      <div className="auth-side">
        <img className="bg" src="/img/commerce.jpg" alt="Commerce de proximité, Cameroun" />
        <div className="auth-side-top"><Logo light /><span className="auth-side-badge"><GroupsIcon /> Espace partenaire</span></div>
        <div className="auth-side-content">
          <blockquote>Votre démo, votre logo, votre suivi. Un espace privé, protégé par un code à usage unique.</blockquote>
          <cite>Portail partenaires MboaPilot · Douala</cite>
          <div className="auth-security">
            <span><ShieldIcon /> Code à usage unique</span>
            <span><SmsIcon /> Vérification email</span>
            <span><GroupsIcon /> Suivi de validation</span>
          </div>
        </div>
      </div>
      <div className="auth-form"><div className="auth-box">
        {step === "login" ? (
          <>
            <span className="eyebrow"><span className="dot" /> Étape 1 / 2 · partenaire</span>
            <h1>Votre espace.</h1>
            <p className="auth-sub">Connectez-vous avec l'email professionnel utilisé lors de l'inscription. Un code à usage unique vous sera demandé.</p>
            {err && <div className="alert">{err}</div>}
            <form onSubmit={connecter}>
              <div className="field"><label>Email professionnel</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus placeholder="vous@entreprise.cm" /></div>
              <div className="field"><label>Mot de passe</label><input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} required autoComplete="current-password" /></div>
              <button className="btn btn-brand btn-lg btn-block" disabled={envoi}>{envoi ? <><Spinner inline label="" /> Connexion…</> : <>Recevoir mon code <ArrowForwardIcon /></>}</button>
            </form>
            <div className="auth-links"><Link to="/partenaires">Devenir partenaire</Link><span>·</span><Link to="/">Retour au site</Link></div>
          </>
        ) : (
          <>
            <span className="eyebrow"><span className="dot" /> Étape 2 / 2 · vérification</span>
            <h1>Un dernier code.</h1>
            <p className="auth-sub">Code à 6 chiffres envoyé à <b>{defi?.email_masque || email}</b>. Valable 10 minutes, 5 essais maximum.</p>
            {err && <div className="alert">{err}</div>}
            {defi?.code_demo && (
              <button type="button" className="demo-code-chip" onClick={() => setCode(defi.code_demo)}><BoltIcon /> Mode démo : <b>{defi.code_demo}</b></button>
            )}
            <form onSubmit={verifier}>
              <div className="field"><input className="mfa-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required autoFocus placeholder="······" /></div>
              <button className="btn btn-brand btn-lg btn-block" disabled={envoi}>{envoi ? <><Spinner inline label="" /> Vérification…</> : <>Entrer dans mon espace <ArrowForwardIcon /></>}</button>
            </form>
            <div className="auth-links"><button className="link-btn" onClick={() => { setStep("login"); setErr(""); }}><ArrowBackIcon /> Recommencer</button><span>·</span><Link to="/partenaires">Devenir partenaire</Link></div>
          </>
        )}
        <p className="auth-legal"><ShieldIcon /> Accès réservé aux partenaires enregistrés. Les tentatives sont limitées et journalisées.</p>
      </div></div>
    </div>
  );
}
