import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ShieldIcon from "@mui/icons-material/Shield";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import LockIcon from "@mui/icons-material/Lock";
import { api } from "../api";
import { Logo, PasswordStrength, Spinner } from "../components";

const REGIONS = ["Centre", "Littoral", "Ouest", "Nord-Ouest", "Sud-Ouest", "Sud", "Est", "Adamaoua", "Nord", "Extreme-Nord"];

export default function Inscription() {
  const nav = useNavigate();
  const [f, setF] = useState({ nom: "", login: "", email: "", telephone: "", perimetre: "Centre", p1: "", p2: "" });
  const [msg, setMsg] = useState({ ok: null, txt: "" });
  const [envoi, setEnvoi] = useState(false);
  const [voir, setVoir] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const go = async (e) => {
    e.preventDefault();
    setMsg({ ok: null, txt: "" }); setEnvoi(true);
    try {
      const r = await api.post("/api/auth/inscription", {
        nom: f.nom.trim(), login: f.login.trim().toLowerCase(), email: f.email.trim(),
        telephone: f.telephone.trim(), perimetre: f.perimetre,
        password: f.p1, password2: f.p2,
      });
      setMsg({ ok: true, txt: `Compte ${r.login} créé (profil Commercial, ${f.perimetre}). Vous allez activer votre MFA à la première connexion.` });
      setTimeout(() => nav("/login"), 1900);
    } catch (ex) { setMsg({ ok: false, txt: ex.message }); }
    setEnvoi(false);
  };

  return (
    <div className="auth-page auth-v2">
      <div className="auth-side">
        <img className="bg" src="/img/rue-marche.jpg" alt="Rue commerçante, Cameroun" />
        <div className="auth-side-top"><Logo light /><span className="auth-side-badge"><ShieldIcon /> Inscription sécurisée</span></div>
        <div className="auth-side-content">
          <blockquote>Rejoignez le réseau qui pilote ses ventes au quotidien.</blockquote>
          <cite>Compte Commercial gratuit, périmètre de votre région</cite>
          <div className="auth-security">
            <span><QrCode2Icon /> MFA dès la 1ʳᵉ connexion</span>
            <span><LockIcon /> Moindre privilège</span>
            <span><ShieldIcon /> Audit complet</span>
          </div>
        </div>
      </div>
      <div className="auth-form">
        <div className="auth-box">
          <span className="eyebrow"><span className="dot" /> Inscription</span>
          <h1>Créez votre compte.</h1>
          <p className="auth-sub">Profil Commercial sur votre région. L'Admin peut ensuite élargir vos droits. Une adresse email valide est requise pour la MFA et les alertes.</p>
          {msg.txt && <div className={msg.ok ? "ok" : "alert"}>{msg.txt}</div>}
          <form onSubmit={go}>
            <div className="field"><label>Nom complet</label><input value={f.nom} onChange={set("nom")} required placeholder="ex. Amina Nkomo" autoComplete="name" /></div>
            <div className="grid-2" style={{ gap: 12 }}>
              <div className="field"><label>Identifiant</label><input value={f.login} onChange={set("login")} required placeholder="ex. aminank" autoComplete="username" /></div>
              <div className="field"><label>Région d'activité</label><select value={f.perimetre} onChange={set("perimetre")}>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
            </div>
            <div className="field"><label>Email professionnel</label><input type="email" value={f.email} onChange={set("email")} required placeholder="amina@entreprise.cm" autoComplete="email" /></div>
            <div className="field"><label>Téléphone <span style={{ color: "var(--faint)", fontWeight: 400 }}>(optionnel)</span></label><input value={f.telephone} onChange={set("telephone")} placeholder="+237 6 00 00 00 00" autoComplete="tel" /></div>
            <div className="field"><label>Mot de passe</label>
              <span className="pw-wrap"><input type={voir ? "text" : "password"} value={f.p1} onChange={set("p1")} required autoComplete="new-password" placeholder="12 caractères, majuscule, chiffre, symbole" />
                <button type="button" onClick={() => setVoir(!voir)}>{voir ? "Masquer" : "Afficher"}</button></span>
              <PasswordStrength value={f.p1} />
            </div>
            <div className="field"><label>Confirmation</label><input type="password" value={f.p2} onChange={set("p2")} required autoComplete="new-password" /></div>
            <button className="btn btn-brand btn-lg btn-block" disabled={envoi}>{envoi ? <><Spinner inline label="" /> Création…</> : <>Créer mon compte <ArrowForwardIcon /></>}</button>
          </form>
          <p className="auth-legal"><ShieldIcon /> En créant un compte, vous acceptez nos <Link to="/cgu">CGU</Link> et notre <Link to="/confidentialite">politique de confidentialité</Link>.</p>
          <div className="auth-links" style={{ marginTop: 8 }}><span>Déjà inscrit ?</span><Link to="/login">Se connecter</Link><span>·</span><Link to="/">Retour au site</Link></div>
        </div>
      </div>
    </div>
  );
}
