import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { api } from "../api";
import { Logo } from "../components";

const REGIONS = ["Centre", "Littoral", "Ouest", "Nord-Ouest", "Sud-Ouest", "Sud", "Est", "Adamaoua", "Nord", "Extreme-Nord"];

function force(pwd) {
  let s = 0;
  if (pwd.length >= 12) s++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) s++;
  if (/[0-9]/.test(pwd)) s++;
  if (/[^A-Za-z0-9]/.test(pwd)) s++;
  return s;
}
const MOTS = ["Très faible", "Faible", "Correct", "Fort", "Excellent"];
const COLS = ["#DF1B41", "#DF1B41", "#FFC247", "#00C07F", "#00C07F"];

export default function Inscription() {
  const nav = useNavigate();
  const [f, setF] = useState({ nom: "", login: "", perimetre: "Centre", p1: "", p2: "" });
  const [msg, setMsg] = useState({ ok: null, txt: "" });
  const [envoi, setEnvoi] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = async (e) => {
    e.preventDefault(); setMsg({ ok: null, txt: "" }); setEnvoi(true);
    try {
      const r = await api.post("/api/auth/inscription", {
        nom: f.nom.trim(), login: f.login.trim(), perimetre: f.perimetre,
        password: f.p1, password2: f.p2,
      });
      setMsg({ ok: true, txt: `Compte ${r.login} créé (profil Commercial, ${f.perimetre}). Connectez-vous.` });
      setTimeout(() => nav("/login"), 1600);
    } catch (ex) { setMsg({ ok: false, txt: ex.message }); }
    setEnvoi(false);
  };
  const s = force(f.p1);
  return (
    <div className="auth-page">
      <div className="auth-side">
        <img className="bg" src="/img/rue-marche.jpg" alt="Rue commerçante, Cameroun" />
        <div style={{ marginBottom: "auto" }}><Logo light /></div>
        <blockquote>Rejoignez le réseau qui pilote ses ventes au quotidien.</blockquote>
        <cite>Compte Commercial gratuit, périmètre de votre région</cite>
      </div>
      <div className="auth-form"><div className="auth-box">
        <span className="eyebrow"><span className="dot" /> Inscription</span>
        <h1>Créez votre compte.</h1>
        <p style={{ color: "var(--muted)" }}>Profil Commercial sur votre région. L'Admin peut ensuite élargir vos droits.</p>
        {msg.txt && <div className={msg.ok ? "ok" : "alert"}>{msg.txt}</div>}
        <form onSubmit={go}>
          <div className="field"><label>Nom complet</label><input value={f.nom} onChange={set("nom")} required placeholder="ex. Amina Nkomo" /></div>
          <div className="grid-2" style={{ gap: 12 }}>
            <div className="field"><label>Identifiant</label><input value={f.login} onChange={set("login")} required placeholder="ex. aminank" /></div>
            <div className="field"><label>Région d'activité</label><select value={f.perimetre} onChange={set("perimetre")}>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
          </div>
          <div className="field"><label>Mot de passe (≥ 12 car. : majuscule, minuscule, chiffre, symbole)</label>
            <input type="password" value={f.p1} onChange={set("p1")} required autoComplete="new-password" />
            <span className="meter"><i style={{ width: s * 25 + "%", background: COLS[s] }} /></span>
            <small style={{ color: "var(--muted)" }}>{f.p1 ? MOTS[s] : ""}</small></div>
          <div className="field"><label>Confirmation</label><input type="password" value={f.p2} onChange={set("p2")} required autoComplete="new-password" /></div>
          <button className="btn btn-brand btn-lg btn-block" disabled={envoi}>{envoi ? "Création…" : <>Créer mon compte <ArrowForwardIcon /></>}</button>
        </form>
        <p style={{ fontSize: 14, marginTop: 16 }}>Déjà inscrit ? <Link to="/login">Se connecter</Link> · <Link to="/">Retour au site</Link></p>
      </div></div>
    </div>
  );
}
