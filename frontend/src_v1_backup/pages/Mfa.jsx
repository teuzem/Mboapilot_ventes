import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import SmsIcon from "@mui/icons-material/Sms";
import { api } from "../api";
import { useAuth } from "../auth";
import { Logo } from "../components";

export default function Mfa() {
  const nav = useNavigate();
  const { setUser } = useAuth();
  const st = useLocation().state || {};
  const [code, setCode] = useState(st.code_demo || "");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [envoi, setEnvoi] = useState(false);
  if (!st.login) {
    return (
      <div className="auth-page"><div className="auth-form"><div className="auth-box">
        <h1>Session expirée</h1>
        <p style={{ color: "var(--muted)" }}>Repassez par la connexion pour recevoir un code.</p>
        <Link className="btn btn-brand" to="/login">Retour connexion</Link>
      </div></div></div>
    );
  }
  const valider = async (e) => {
    e?.preventDefault(); setErr(""); setEnvoi(true);
    try { const r = await api.post("/api/auth/mfa-confirmer", { code: code.trim() }); setUser(r.user); nav("/app"); }
    catch (ex) { setErr(ex.message); }
    setEnvoi(false);
  };
  const renvoyer = async () => {
    setErr(""); setInfo("");
    try {
      const r = await api.post("/api/auth/mfa-demande");
      if (r.code_demo) { setCode(r.code_demo); setInfo("Nouveau code simulé reçu par SMS."); }
      else setInfo("Nouveau code envoyé par SMS.");
    } catch (ex) { setErr(ex.message); }
  };
  return (
    <div className="auth-page">
      <div className="auth-side">
        <img className="bg" src="/img/point-vente.jpg" alt="Point de vente, Cameroun" />
        <div style={{ marginBottom: "auto" }}><Logo light /></div>
        <blockquote>Dernière étape : le code reçu par SMS.</blockquote>
        <cite>Sprint 1 : envoi simulé, affiché à l'écran. SMS réel au Sprint 2.</cite>
      </div>
      <div className="auth-form"><div className="auth-box">
        <span className="eyebrow"><span className="dot" /> Étape 2 / 2 : vérification</span>
        <h1>Code à 6 chiffres</h1>
        <p style={{ color: "var(--muted)" }}>Saisissez le code envoyé au numéro du compte <b>{st.login}</b> (valable 10 minutes).</p>
        {st.code_demo && (
          <div className="ok" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <SmsIcon style={{ flex: "0 0 auto", marginTop: 2 }} />
            <span><b>SMS simulé reçu :</b> « MboaPilot : votre code de vérification : <b>{st.code_demo}</b> »<br />
            <span style={{ fontSize: 12.5 }}>Simulation Sprint 1 : aucun SMS réel n'est envoyé.</span></span>
          </div>
        )}
        {err && <div className="alert">{err}</div>}
        {info && <div className="ok">{info}</div>}
        <form onSubmit={valider}>
          <div className="field"><input className="mfa-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" required autoFocus placeholder="······" /></div>
          <button className="btn btn-brand btn-lg btn-block" disabled={envoi}>{envoi ? "Vérification…" : "Vérifier et entrer"}</button>
        </form>
        <p style={{ fontSize: 14 }}>Code expiré ? <button className="btn btn-ghost" style={{ padding: 0, fontSize: 14 }} onClick={renvoyer}>Renvoyer un code</button> · <Link to="/login">Recommencer</Link></p>
      </div></div>
    </div>
  );
}
