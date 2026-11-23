import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import CancelIcon from "@mui/icons-material/Cancel";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import SyncIcon from "@mui/icons-material/Sync";
import ShieldIcon from "@mui/icons-material/Shield";
import LockIcon from "@mui/icons-material/Lock";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import LogoutIcon from "@mui/icons-material/Logout";
import RefreshIcon from "@mui/icons-material/Refresh";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import GroupsIcon from "@mui/icons-material/Groups";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { Logo, Spinner, Toast, Badge, PasswordStrength } from "../components";
import { api, dateFR } from "../api";

const SECTEURS = ["Distribution", "Agroalimentaire", "Télécoms", "Banque / Finance", "Transport", "Retail / Mode", "Industrie", "Services", "Autre"];
const TAILLES = ["1 à 10", "11 à 50", "51 à 200", "201 à 1000", "1000+"];
const REGIONS = ["Centre", "Littoral", "Ouest", "Nord-Ouest", "Sud-Ouest", "Sud", "Est", "Adamaoua", "Nord", "Extreme-Nord"];
const CRENEAUX = ["09:00 - 10:00", "10:00 - 11:00", "11:00 - 12:00", "14:00 - 15:00", "15:00 - 16:00", "16:00 - 17:00"];
const jour = (n = 0) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const DEMO_LABEL = { demande: "Demande envoyée", confirme: "Confirmée", realise: "Réalisée", annule: "Annulée" };

export default function PartnerSpace() {
  const [p, setP] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [tab, setTab] = useState("apercu");
  const [toast, setToast] = useState(null);
  const [suivi, setSuivi] = useState("");
  const [logoFile, setLogoFile] = useState(null);
  const [apercu, setApercu] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [profil, setProfil] = useState(null);
  const [demo, setDemo] = useState({ demo_date: jour(2), demo_creneau: CRENEAUX[1] });
  const [pwd, setPwd] = useState({ actuel: "", password: "", password2: "" });
  const inputLogo = useRef(null);

  const charger = async () => {
    setChargement(true);
    try {
      const r = await api.get("/api/partenaires/moi");
      setP(r.partenaire);
      setProfil({
        entreprise: r.partenaire.entreprise, contact_nom: r.partenaire.contact_nom,
        telephone: r.partenaire.telephone || "", secteur: r.partenaire.secteur || "Distribution",
        taille: r.partenaire.taille || "11 à 50", region: r.partenaire.region || "Littoral",
        site_web: r.partenaire.site_web || "", message: r.partenaire.message || "",
      });
      setDemo({ demo_date: r.partenaire.demo_date || jour(2), demo_creneau: r.partenaire.demo_creneau || CRENEAUX[1] });
      try { const s = await api.get("/api/partenaires/moi/suivi"); setSuivi(s.url); } catch { /* lien non critique */ }
    } catch (ex) {
      setErreur(ex.status === 401 ? "session" : ex.message);
    } finally { setChargement(false); }
  };
  useEffect(() => { charger(); }, []);
  useEffect(() => () => { if (apercu) URL.revokeObjectURL(apercu); }, [apercu]);

  const message = (txt, tone = "success") => setToast({ txt, tone });
  const syncAccueil = () => {
    window.dispatchEvent(new Event("mboa:partners"));
    try { localStorage.setItem("mboa:partners", String(Date.now())); } catch { /* stockage refusé */ }
  };

  const enregistrerProfil = async (e) => {
    e.preventDefault(); setEnvoi(true);
    try {
      const r = await api.post("/api/partenaires/moi", profil);
      setP(r.partenaire);
      message("Profil mis à jour. Votre espace est à jour.");
    } catch (ex) { message(ex.message, "error"); }
    setEnvoi(false);
  };

  const choisirLogo = (file) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return message("Format de logo non reconnu (PNG, JPG ou WebP).", "error");
    if (file.size > 2 * 1024 * 1024) return message("Logo trop volumineux : 2 Mo maximum.", "error");
    if (apercu) URL.revokeObjectURL(apercu);
    setLogoFile(file);
    setApercu(URL.createObjectURL(file));
  };

  const envoyerLogo = async () => {
    if (!logoFile) return message("Choisissez d'abord un fichier logo.", "error");
    setEnvoi(true);
    try {
      const fd = new FormData(); fd.append("logo", logoFile);
      const r = await api.upload("/api/partenaires/moi/logo", fd);
      setP((prev) => ({ ...prev, logo_url: r.logo_url, logo_path: r.logo_url }));
      setLogoFile(null);
      syncAccueil();
      message(r.message || "Logo mis à jour. La page d'accueil se synchronise automatiquement.");
    } catch (ex) { message(ex.message, "error"); }
    setEnvoi(false);
  };

  const replanifier = async (e) => {
    e.preventDefault(); setEnvoi(true);
    try {
      const r = await api.post("/api/partenaires/moi/demo", demo);
      setP((prev) => ({ ...prev, demo_date: demo.demo_date, demo_creneau: demo.demo_creneau, demo_statut: "demande" }));
      message(r.message || "Créneau demandé. L'équipe confirme sous 24 h ouvrées.");
    } catch (ex) { message(ex.message, "error"); }
    setEnvoi(false);
  };

  const changerMdp = async (e) => {
    e.preventDefault(); setEnvoi(true);
    try {
      const r = await api.post("/api/partenaires/moi/password", pwd);
      setPwd({ actuel: "", password: "", password2: "" });
      message(r.message || "Mot de passe mis à jour.");
    } catch (ex) { message(ex.message, "error"); }
    setEnvoi(false);
  };

  const copierSuivi = async () => {
    try { await navigator.clipboard.writeText(window.location.origin + suivi); message("Lien de suivi copié."); }
    catch { message("Copie impossible. Sélectionnez le lien manuellement.", "error"); }
  };

  const deconnexion = async () => {
    try { await api.post("/api/partenaires/deconnexion"); } catch { /* déjà clos */ }
    window.location.href = "/partenaires";
  };

  if (chargement) return <div className="boot"><Spinner label="Ouverture de votre espace partenaire…" /></div>;
  if (erreur === "session") return (
    <div className="partner-auth-required">
      <Logo />
      <div className="success-card">
        <div className="success-ic warn"><LockIcon /></div>
        <h1>Session partenaire requise.</h1>
        <p>Connectez-vous avec votre email professionnel pour retrouver votre espace, votre logo et votre démonstration.</p>
        <div className="success-actions">
          <Link className="btn btn-brand btn-lg" to="/partenaires/connexion">Se connecter <ArrowForwardIcon /></Link>
          <Link className="btn btn-outline" to="/partenaires">Devenir partenaire</Link>
        </div>
      </div>
    </div>
  );
  if (!p) return <div className="partner-auth-required"><div className="success-card"><h1>Espace indisponible</h1><p>{erreur}</p><button className="btn btn-brand" onClick={charger}>Réessayer</button></div></div>;

  const statutInfo = p.statut === "valide"
    ? { tone: "green", icon: <CheckCircleIcon />, titre: "Partenaire validé", texte: "Votre logo est publié sur la page d'accueil et synchronisé automatiquement." }
    : p.statut === "refuse"
      ? { tone: "red", icon: <CancelIcon />, titre: "Demande non retenue", texte: "Contactez partenaires@mboapilot.cm pour connaître les prochaines étapes." }
      : { tone: "amber", icon: <HourglassTopIcon />, titre: "Validation en cours", texte: "L'équipe examine votre profil et votre logo. Réponse sous 24 h ouvrées." };

  return (
    <div className="partner-app">
      <header className="partner-top">
        <Logo />
        <span className="partner-top-tag"><GroupsIcon /> Espace partenaire</span>
        <div className="partner-top-actions">
          <Link to="/" className="btn btn-ghost"><OpenInNewIcon /> Voir le site</Link>
          <button className="btn btn-outline" onClick={deconnexion}><LogoutIcon /> Déconnexion</button>
        </div>
      </header>
      <div className="partner-app-grid">
        <aside className="partner-side">
          <div className="partner-id-card">
            <div className="partner-id-logo">{p.logo_url ? <img src={p.logo_url} alt={p.entreprise} /> : <GroupsIcon />}</div>
            <b>{p.entreprise}</b>
            <span>{p.contact_nom}</span>
            <Badge tone={statutInfo.tone}>{p.statut === "valide" ? "Validé" : p.statut === "refuse" ? "Refusé" : "En attente"}</Badge>
          </div>
          <nav className="partner-nav">
            {[
              ["apercu", "Vue d'ensemble", <GroupsIcon />],
              ["profil", "Mon profil", <ShieldIcon />],
              ["logo", "Mon logo", <CloudUploadIcon />],
              ["demo", "Ma démonstration", <EventAvailableIcon />],
              ["securite", "Sécurité", <LockIcon />],
            ].map(([k, label, ic]) => (
              <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{ic}{label}</button>
            ))}
          </nav>
          <div className="partner-side-foot">
            <span><ShieldIcon /> Connexion par code unique</span>
            <span>Membre depuis {dateFR(p.cree_le)}</span>
          </div>
        </aside>

        <main className="partner-main">
          <div className="partner-main-head">
            <div>
              <span className="page-eyebrow">{tab === "apercu" ? "Vue d'ensemble" : tab === "profil" ? "Profil" : tab === "logo" ? "Identité visuelle" : tab === "demo" ? "Démonstration" : "Sécurité"}</span>
              <h1>{tab === "apercu" ? `Bonjour, ${p.contact_nom.split(" ")[0]}.` : tab === "profil" ? "Mon profil" : tab === "logo" ? "Mon logo" : tab === "demo" ? "Ma démonstration" : "Sécurité du compte"}</h1>
            </div>
            <button className="btn btn-ghost" onClick={charger}><RefreshIcon /> Actualiser</button>
          </div>

          {tab === "apercu" && (
            <div className="partner-overview">
              <div className={"status-card status-" + statutInfo.tone}>
                <div className="status-ic">{statutInfo.icon}</div>
                <div><h2>{statutInfo.titre}</h2><p>{statutInfo.texte}</p></div>
                {p.statut === "valide" && <Link to="/#partenaires" className="btn btn-outline">Voir sur l'accueil <OpenInNewIcon /></Link>}
              </div>
              <div className="partner-kpis">
                <div><small>Logo</small><b>{p.logo_url ? "En ligne" : "À fournir"}</b><span>{p.statut === "valide" ? "visible sur l'accueil" : "publié après validation"}</span></div>
                <div><small>Démo</small><b>{DEMO_LABEL[p.demo_statut] || p.demo_statut}</b><span>{p.demo_date ? `${dateFR(p.demo_date)} · ${p.demo_creneau}` : "aucun créneau"}</span></div>
                <div><small>Suivi privé</small><b>{suivi ? "Actif" : "—"}</b><span>lien unique, sans mot de passe</span></div>
              </div>
              <div className="cols-2 partner-overview-cols">
                <div className="panel">
                  <h2><SyncIcon /> Synchronisation de l'accueil</h2>
                  <p className="hint">Chaque changement de logo ou de statut est publié immédiatement. Aucun redéploiement n'est nécessaire.</p>
                  <div className="sync-preview">
                    <img src={p.logo_url || "/logo.svg"} alt={p.entreprise} />
                    <div><b>{p.entreprise}</b><span>{p.secteur} · {p.region}</span></div>
                    <Badge tone={statutInfo.tone}>{p.statut === "valide" ? "Publié" : "Non publié"}</Badge>
                  </div>
                  <div className="partner-quick-actions">
                    <button className="btn btn-outline" onClick={() => setTab("logo")}>Changer le logo</button>
                    <button className="btn btn-ghost" onClick={() => setTab("demo")}>Replanifier la démo</button>
                  </div>
                </div>
                <div className="panel">
                  <h2><ShieldIcon /> Votre lien de suivi</h2>
                  <p className="hint">Partagez ce lien avec vos collègues : il permet de suivre la demande sans se connecter.</p>
                  {suivi ? <div className="tracking-link"><code>{window.location.origin + suivi}</code><button className="icon-btn" onClick={copierSuivi} title="Copier"><ContentCopyIcon /></button></div> : <p className="hint">Lien indisponible.</p>}
                  {suivi && <Link className="btn btn-outline btn-block" to={suivi} style={{ marginTop: 10 }}>Ouvrir le suivi <OpenInNewIcon /></Link>}
                  <h2 style={{ marginTop: 22 }}><CloudUploadIcon /> Prochaine étape</h2>
                  <p className="hint">{p.statut === "valide" ? "Votre logo est publié. Vous pouvez le remplacer à tout moment." : "Vérifiez que votre logo est lisible sur fond clair, puis attendez la validation."}</p>
                </div>
              </div>
            </div>
          )}

          {tab === "profil" && profil && (
            <form className="panel partner-form-panel" onSubmit={enregistrerProfil}>
              <h2>Informations de l'entreprise</h2>
              <p className="hint">Ces informations apparaissent dans le dossier de validation. L'email de connexion ne peut pas être modifié ici.</p>
              <div className="grid-2" style={{ gap: 12 }}>
                <div className="field"><label>Entreprise</label><input value={profil.entreprise} onChange={(e) => setProfil({ ...profil, entreprise: e.target.value })} required /></div>
                <div className="field"><label>Contact principal</label><input value={profil.contact_nom} onChange={(e) => setProfil({ ...profil, contact_nom: e.target.value })} required /></div>
              </div>
              <div className="grid-2" style={{ gap: 12 }}>
                <div className="field"><label>Email de connexion</label><input value={p.email_masque || ""} disabled /></div>
                <div className="field"><label>Téléphone</label><input value={profil.telephone} onChange={(e) => setProfil({ ...profil, telephone: e.target.value })} /></div>
              </div>
              <div className="grid-2" style={{ gap: 12 }}>
                <div className="field"><label>Secteur</label><select value={profil.secteur} onChange={(e) => setProfil({ ...profil, secteur: e.target.value })}>{SECTEURS.map((s) => <option key={s}>{s}</option>)}</select></div>
                <div className="field"><label>Taille</label><select value={profil.taille} onChange={(e) => setProfil({ ...profil, taille: e.target.value })}>{TAILLES.map((s) => <option key={s}>{s}</option>)}</select></div>
              </div>
              <div className="grid-2" style={{ gap: 12 }}>
                <div className="field"><label>Région</label><select value={profil.region} onChange={(e) => setProfil({ ...profil, region: e.target.value })}>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
                <div className="field"><label>Site web</label><input value={profil.site_web} onChange={(e) => setProfil({ ...profil, site_web: e.target.value })} placeholder="https://…" /></div>
              </div>
              <div className="field"><label>Message / contexte</label><textarea rows={4} value={profil.message} onChange={(e) => setProfil({ ...profil, message: e.target.value })} /></div>
              <button className="btn btn-brand" disabled={envoi}>{envoi ? <><Spinner inline label="" /> Enregistrement…</> : "Enregistrer le profil"}</button>
            </form>
          )}

          {tab === "logo" && (
            <div className="panel partner-form-panel">
              <h2>Logo affiché sur l'accueil</h2>
              <p className="hint">PNG, JPG ou WebP · 2 Mo maximum. Le serveur vérifie la signature du fichier. Le changement est publié immédiatement si votre compte est validé.</p>
              <div className="logo-current">
                <div className="logo-current-img">{p.logo_url ? <img src={p.logo_url} alt={p.entreprise} /> : <CloudUploadIcon />}</div>
                <div><b>Logo actuel</b><span>{p.statut === "valide" ? "Visible sur la page d'accueil" : "Sera publié après validation"}</span></div>
                <Badge tone={p.statut === "valide" ? "green" : "amber"}>{p.statut === "valide" ? "En ligne" : "En attente"}</Badge>
              </div>
              <div className="logo-drop" onClick={() => inputLogo.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") inputLogo.current?.click(); }}>
                {apercu ? <img src={apercu} alt="Aperçu" /> : <CloudUploadIcon />}
                <div><b>{logoFile ? logoFile.name : "Choisir un nouveau logo"}</b><span>{logoFile ? `${Math.round(logoFile.size / 1024)} Ko · prêt à envoyer` : "Glissez un fichier ou cliquez"}</span></div>
                <input ref={inputLogo} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => choisirLogo(e.target.files?.[0])} />
              </div>
              <button className="btn btn-brand" disabled={!logoFile || envoi} onClick={envoyerLogo}>{envoi ? <><Spinner inline label="" /> Envoi…</> : <><SyncIcon /> Publier le nouveau logo</>}</button>
              <p className="form-note"><ShieldIcon /> Le nouveau fichier remplace l'ancien. L'ancien logo est supprimé du serveur.</p>
            </div>
          )}

          {tab === "demo" && (
            <div className="partner-demo-grid">
              <div className="panel">
                <h2><EventAvailableIcon /> Démonstration de 30 minutes</h2>
                <p className="hint">Sur vos propres données ou sur le jeu de démonstration. Un expert MboaPilot vous accompagne.</p>
                <div className="demo-current">
                  <div><small>Date</small><b>{p.demo_date ? dateFR(p.demo_date) : "À définir"}</b></div>
                  <div><small>Créneau</small><b>{p.demo_creneau || "—"}</b></div>
                  <Badge tone={p.demo_statut === "confirme" ? "green" : p.demo_statut === "annule" ? "red" : "amber"}>{DEMO_LABEL[p.demo_statut] || p.demo_statut}</Badge>
                </div>
                <form onSubmit={replanifier} className="demo-form">
                  <div className="field"><label>Nouvelle date</label><input type="date" min={jour(0)} max={jour(120)} value={demo.demo_date} onChange={(e) => setDemo({ ...demo, demo_date: e.target.value })} required /></div>
                  <div className="field"><label>Créneau</label>
                    <div className="slot-grid">{CRENEAUX.map((c) => <button type="button" key={c} className={demo.demo_creneau === c ? "on" : ""} onClick={() => setDemo({ ...demo, demo_creneau: c })}>{c}</button>)}</div>
                  </div>
                  <button className="btn btn-brand" disabled={envoi}>{envoi ? <><Spinner inline label="" /> Envoi…</> : "Demander ce créneau"}</button>
                </form>
              </div>
              <div className="panel">
                <h2>Préparer la démo</h2>
                <ul className="check-list">
                  <li><CheckCircleIcon /> Un échantillon CSV ou Excel de vos ventes (facultatif)</li>
                  <li><CheckCircleIcon /> Le nom des régions et points de vente à couvrir</li>
                  <li><CheckCircleIcon /> Vos objectifs : marge, CA, alertes, imports</li>
                  <li><CheckCircleIcon /> Les personnes à inviter (direction, DAF, IT)</li>
                </ul>
                <p className="hint">Le lien de visioconférence vous sera envoyé à l'email de contact dès confirmation.</p>
              </div>
            </div>
          )}

          {tab === "securite" && (
            <div className="cols-2 partner-overview-cols">
              <form className="panel partner-form-panel" onSubmit={changerMdp}>
                <h2><LockIcon /> Changer le mot de passe</h2>
                <p className="hint">12 caractères minimum, avec majuscule, minuscule, chiffre et symbole. Ne réutilisez pas un mot de passe existant.</p>
                <div className="field"><label>Mot de passe actuel</label><input type="password" value={pwd.actuel} onChange={(e) => setPwd({ ...pwd, actuel: e.target.value })} required autoComplete="current-password" /></div>
                <div className="field"><label>Nouveau mot de passe</label><input type="password" value={pwd.password} onChange={(e) => setPwd({ ...pwd, password: e.target.value })} required autoComplete="new-password" /><PasswordStrength value={pwd.password} /></div>
                <div className="field"><label>Confirmation</label><input type="password" value={pwd.password2} onChange={(e) => setPwd({ ...pwd, password2: e.target.value })} required autoComplete="new-password" /></div>
                <button className="btn btn-brand" disabled={envoi}>{envoi ? <><Spinner inline label="" /> Mise à jour…</> : "Mettre à jour"}</button>
              </form>
              <div>
                <div className="panel">
                  <h2><ShieldIcon /> Comment votre compte est protégé</h2>
                  <ul className="check-list">
                    <li><CheckCircleIcon /> Mot de passe haché (PBKDF2, 600 000 itérations)</li>
                    <li><CheckCircleIcon /> Code à usage unique à chaque connexion</li>
                    <li><CheckCircleIcon /> Limitation des tentatives par adresse et par compte</li>
                    <li><CheckCircleIcon /> Actions journalisées dans la chaîne d'audit</li>
                    <li><CheckCircleIcon /> Aucun token de suivi exposé dans les réponses authentifiées</li>
                  </ul>
                </div>
                <div className="panel">
                  <h2>Dernières informations</h2>
                  <table className="grid"><tbody>
                    <tr><td>Membre depuis</td><td className="num">{dateFR(p.cree_le)}</td></tr>
                    <tr><td>Dernière mise à jour</td><td className="num">{dateFR(p.maj_le, true)}</td></tr>
                    <tr><td>Validation</td><td className="num">{p.valide_le ? dateFR(p.valide_le) : "—"}</td></tr>
                    <tr><td>Statut du logo</td><td className="num">{p.statut === "valide" ? "Publié" : "En attente"}</td></tr>
                  </tbody></table>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
      <Toast message={toast?.txt} tone={toast?.tone} onClose={() => setToast(null)} />
    </div>
  );
}
