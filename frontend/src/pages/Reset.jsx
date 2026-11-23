import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ShieldIcon from "@mui/icons-material/Shield";
import { api } from "../api";
import { Logo, PasswordStrength, Spinner } from "../components";

export default function Reset() {
  const { token } = useParams();
  const [login, setLogin] = useState("");
  const [lien, setLien] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [voir, setVoir] = useState(false);
  const [msg, setMsg] = useState({ ok: null, txt: "" });
  const [envoi, setEnvoi] = useState(false);
  const [fait, setFait] = useState(false);

  const demander = async (e) => {
    e.preventDefault(); setMsg({ ok: null, txt: "" }); setEnvoi(true);
    try {
      const r = await api.post("/api/auth/reset-request", { login: login.trim() });
      setLien(r.lien);
      setMsg({ ok: true, txt: r.message || "Lien généré (30 min, usage unique)." });
    } catch (ex) { setMsg({ ok: false, txt: ex.message }); }
    setEnvoi(false);
  };
  const changer = async (e) => {
    e.preventDefault(); setMsg({ ok: null, txt: "" }); setEnvoi(true);
    try {
      const r = await api.post("/api/auth/reset-use", { token, p1, p2 });
      setMsg({ ok: true, txt: r.message || "Mot de passe réinitialisé. Connectez-vous." });
      setFait(true);
    } catch (ex) { setMsg({ ok: false, txt: ex.message }); }
    setEnvoi(false);
  };

  return (
    <div className="auth-page auth-v2">
      <div className="auth-side">
        <img className="bg" src="/img/point-vente.jpg" alt="Point de vente, Cameroun" />
        <div className="auth-side-top"><Logo light /><span className="auth-side-badge"><ShieldIcon /> Récupération sécurisée</span></div>
        <div className="auth-side-content">
          <blockquote>Retrouvez l'accès, en toute sécurité.</blockquote>
          <cite>Lien unique 30 minutes · usage unique · action journalisée</cite>
        </div>
      </div>
      <div className="auth-form"><div className="auth-box">
        {!token ? (
          <>
            <span className="eyebrow"><span className="dot" /> Récupération</span>
            <h1>Mot de passe oublié</h1>
            <p className="auth-sub">Saisissez votre identifiant. Nous générons un lien à usage unique valable 30 minutes. En production, il part par email.</p>
            {msg.txt && <div className={msg.ok ? "ok" : "alert"}>{msg.txt}</div>}
            <form onSubmit={demander}>
              <div className="field"><label>Identifiant</label><input value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus autoComplete="username" /></div>
              <button className="btn btn-brand btn-lg btn-block" disabled={envoi}>{envoi ? <><Spinner inline label="" /> Génération…</> : <>Générer le lien <ArrowForwardIcon /></>}</button>
            </form>
            {lien && <div className="ok" style={{ wordBreak: "break-all" }}>Lien démo : <Link to={lien}>{lien}</Link></div>}
          </>
        ) : (
          <>
            <span className="eyebrow"><span className="dot" /> Nouveau mot de passe</span>
            <h1>{fait ? "Mot de passe changé." : "Choisissez-en un fort."}</h1>
            <p className="auth-sub">{fait ? "Toutes vos sessions ont été invalidées. Reconnectez-vous avec le nouveau mot de passe." : "12 caractères minimum, avec majuscule, minuscule, chiffre et symbole. Le lien est à usage unique."}</p>
            {msg.txt && <div className={msg.ok ? "ok" : "alert"}>{msg.txt}</div>}
            {!fait && (
              <form onSubmit={changer}>
                <div className="field"><label>Nouveau mot de passe</label>
                  <span className="pw-wrap"><input type={voir ? "text" : "password"} value={p1} onChange={(e) => setP1(e.target.value)} required autoComplete="new-password" autoFocus />
                    <button type="button" onClick={() => setVoir(!voir)}>{voir ? "Masquer" : "Afficher"}</button></span>
                  <PasswordStrength value={p1} />
                </div>
                <div className="field"><label>Confirmation</label><input type="password" value={p2} onChange={(e) => setP2(e.target.value)} required autoComplete="new-password" /></div>
                <button className="btn btn-brand btn-lg btn-block" disabled={envoi}>{envoi ? <><Spinner inline label="" /> Réinitialisation…</> : "Réinitialiser le mot de passe"}</button>
              </form>
            )}
            {fait && <Link className="btn btn-brand btn-lg btn-block" to="/login">Se connecter <ArrowForwardIcon /></Link>}
          </>
        )}
        <p className="auth-legal"><ShieldIcon /> Une réinitialisation invalide toutes les sessions existantes.</p>
        <div className="auth-links"><Link to="/login">← Retour connexion</Link></div>
      </div></div>
    </div>
  );
}
