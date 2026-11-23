import { useCallback, useEffect, useState } from "react";
import PersonIcon from "@mui/icons-material/Person";
import SecurityIcon from "@mui/icons-material/Security";
import NotificationsIcon from "@mui/icons-material/Notifications";
import HistoryIcon from "@mui/icons-material/History";
import KeyIcon from "@mui/icons-material/Key";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import DevicesIcon from "@mui/icons-material/Devices";
import EmailIcon from "@mui/icons-material/Email";
import DownloadIcon from "@mui/icons-material/Download";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import RefreshIcon from "@mui/icons-material/Refresh";
import { api } from "../api";
import { useAuth } from "../auth";
import { activerNotifications } from "../push";
import { Toast } from "../components";

function b64url(txt) {
  const pad = "=".repeat((4 - (txt.length % 4)) % 4);
  const b = atob(txt.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
function encode(buf) {
  let s = "";
  for (const o of new Uint8Array(buf)) s += String.fromCharCode(o);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const RUBRIQUES = [
  { id: "compte", label: "Informations personnelles", icon: <PersonIcon /> },
  { id: "securite", label: "Sécurité", icon: <SecurityIcon /> },
  { id: "notifications", label: "Notifications", icon: <NotificationsIcon /> },
  { id: "activite", label: "Activité", icon: <HistoryIcon /> },
];

export default function Profil() {
  const { refresh } = useAuth();
  const [rubrique, setRubrique] = useState("compte");
  const [profil, setProfil] = useState(null);
  const [form, setForm] = useState(null);
  const [toast, setToast] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [mdp, setMdp] = useState({ actuel: "", nouveau: "", confirmation: "" });
  const [mfa, setMfa] = useState({ password: "", code: "" });
  const [codes, setCodes] = useState([]);
  const [passkeys, setPasskeys] = useState([]);
  const [activite, setActivite] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [verif, setVerif] = useState({ code: "", envoye: false, demo: "" });

  const charger = useCallback(async () => {
    try {
      const p = await api.get("/api/profil");
      setProfil(p);
      setForm({ ...p });
      const pk = await api.get("/api/webauthn/credentials").catch(() => ({ credentials: [] }));
      setPasskeys(pk.credentials || []);
      const act = await api.get("/api/profil/activite").catch(() => ({ evenements: [] }));
      setActivite(act.evenements || []);
      const ses = await api.get("/api/profil/sessions").catch(() => ({ sessions: [] }));
      setSessions(ses.sessions || []);
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  useEffect(() => {
    const parent = document.querySelector(".app-main");
    parent?.classList.add("sans-marge");
    return () => parent?.classList.remove("sans-marge");
  }, []);

  const enregistrer = async (e) => {
    e?.preventDefault();
    setOccupe(true);
    try {
      const r = await api.post("/api/profil", form);
      setToast({ message: r.message, tone: "success" });
      setProfil(r.profil);
      setForm({ ...r.profil });
      await refresh();
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setOccupe(false);
  };

  const changerAvatar = async (e) => {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    const fd = new FormData();
    fd.append("avatar", fichier);
    try {
      const r = await api.upload("/api/profil/avatar", fd);
      setProfil({ ...profil, avatar_url: r.avatar_url });
      setToast({ message: "Photo mise à jour.", tone: "success" });
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
  };

  const changerMotDePasse = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post("/api/auth/password", mdp);
      setToast({ message: r.message, tone: "success" });
      setMdp({ actuel: "", nouveau: "", confirmation: "" });
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
  };

  const genererCodes = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post("/api/auth/mfa/codes-secours", mfa);
      setCodes(r.recovery_codes || []);
      setToast({ message: "Codes générés. Enregistrez-les maintenant.", tone: "success" });
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
  };

  const ajouterPasskey = async () => {
    if (!window.PublicKeyCredential) {
      setToast({ message: "Passkeys non prises en charge.", tone: "error" });
      return;
    }
    try {
      const options = await api.post("/api/webauthn/register-options", {});
      options.challenge = b64url(options.challenge);
      options.user.id = b64url(options.user.id);
      if (options.excludeCredentials) {
        options.excludeCredentials = options.excludeCredentials.map((c) => ({ ...c, id: b64url(c.id) }));
      }
      const cred = await navigator.credentials.create({ publicKey: options });
      if (!cred) return;
      await api.post("/api/webauthn/register-verify", {
        id: cred.id, rawId: encode(cred.rawId), type: cred.type,
        response: {
          clientDataJSON: encode(cred.response.clientDataJSON),
          attestationObject: encode(cred.response.attestationObject),
          transports: cred.response.getTransports ? cred.response.getTransports() : [],
        },
        clientExtensionResults: cred.getClientExtensionResults(),
      });
      setToast({ message: "Passkey ajoutée.", tone: "success" });
      charger();
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
  };

  const demanderVerif = async () => {
    try {
      const r = await api.post("/api/profil/verifier-email", {});
      setVerif({ ...verif, envoye: true, demo: r.code_demo || "" });
      setToast({ message: r.message, tone: "success" });
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
  };

  const confirmerVerif = async () => {
    try {
      const r = await api.post("/api/profil/confirmer-email", verif);
      setToast({ message: r.message, tone: "success" });
      charger();
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
  };

  const telechargerCodes = () => {
    const url = URL.createObjectURL(new Blob([codes.join("\n")], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "mboapilot-codes-secours.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!profil || !form) return <div className="pf-shell"><div className="pf-chargement">Chargement du profil…</div></div>;

  return (
    <div className="pf-shell">
      <Toast toast={toast} />

      <header className="pf-titlebar">
        <b>Compte utilisateur</b>
        <span>MboaPilot</span>
      </header>

      <div className="pf-corps">
        <aside className="pf-rail">
          <div className="pf-identite">
            <label className="pf-avatar">
              {profil.avatar_url ? <img src={profil.avatar_url} alt="" /> : <span>{profil.initiales}</span>}
              <span className="pf-camera"><CameraAltIcon fontSize="small" /></span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={changerAvatar} />
            </label>
            <b>{profil.prenom ? profil.prenom + " " + profil.nom : profil.nom}</b>
            <small>{profil.role} · {profil.perimetre}</small>
            <div className="pf-badges">
              <span className={profil.email_verifie ? "vert" : "orange"}>{profil.email_verifie ? "Email vérifié" : "Email à vérifier"}</span>
              <span className="vert">Double facteur</span>
            </div>
          </div>
          <nav className="pf-nav">
            {RUBRIQUES.map((r) => (
              <button key={r.id} className={rubrique === r.id ? "actif" : ""} onClick={() => setRubrique(r.id)}>
                {r.icon}<span>{r.label}</span>
              </button>
            ))}
          </nav>
          <div className="pf-pied">
            <span>Membre depuis {profil.cree_le ? profil.cree_le.slice(0, 10) : "-"}</span>
          </div>
        </aside>

        <main className="pf-contenu">
          {rubrique === "compte" && (
            <form className="pf-carte" onSubmit={enregistrer}>
              <div className="pf-carte-head"><div><h2>Informations personnelles</h2><p>Modifiez vos coordonnées et vos préférences.</p></div></div>
              <div className="pf-champs">
                <label>Prénom<input value={form.prenom || ""} onChange={(e) => setForm({ ...form, prenom: e.target.value })} /></label>
                <label>Nom<input value={form.nom || ""} onChange={(e) => setForm({ ...form, nom: e.target.value })} /></label>
                <label>Adresse email<input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
                <label>Téléphone<input value={form.telephone || ""} onChange={(e) => setForm({ ...form, telephone: e.target.value })} placeholder="+237 6 00 00 00 00" /></label>
                <label>Poste<input value={form.poste || ""} onChange={(e) => setForm({ ...form, poste: e.target.value })} /></label>
                <label>Organisation<input value={form.organisation || ""} onChange={(e) => setForm({ ...form, organisation: e.target.value })} /></label>
                <label className="large">Biographie<textarea rows="3" value={form.bio || ""} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></label>
                <label>Langue
                  <select value={form.langue || "fr"} onChange={(e) => setForm({ ...form, langue: e.target.value })}>
                    <option value="fr">Français</option><option value="en">English</option>
                  </select>
                </label>
                <label>Fuseau horaire<input value={form.fuseau || ""} onChange={(e) => setForm({ ...form, fuseau: e.target.value })} /></label>
              </div>
              <div className="pf-actions"><button className="pf-bouton plein" disabled={occupe}>Enregistrer</button></div>
            </form>
          )}

          {rubrique === "securite" && (
            <>
              <section className="pf-carte">
                <div className="pf-carte-head"><div><h2><SecurityIcon /> Mot de passe</h2><p>Une phrase secrète unique, jamais réutilisée ailleurs.</p></div></div>
                <form onSubmit={changerMotDePasse} className="pf-champs">
                  <label>Mot de passe actuel<input type="password" value={mdp.actuel} onChange={(e) => setMdp({ ...mdp, actuel: e.target.value })} required /></label>
                  <label>Nouveau mot de passe<input type="password" value={mdp.nouveau} onChange={(e) => setMdp({ ...mdp, nouveau: e.target.value })} required /></label>
                  <label>Confirmation<input type="password" value={mdp.confirmation} onChange={(e) => setMdp({ ...mdp, confirmation: e.target.value })} required /></label>
                  <div className="pf-actions large"><button className="pf-bouton plein">Changer le mot de passe</button></div>
                </form>
              </section>

              <section className="pf-carte">
                <div className="pf-carte-head"><div><h2><QrCode2Icon /> Authentification à deux facteurs</h2><p>Chaque connexion demande un code TOTP ou une passkey.</p></div><span className="pf-etat vert">Active</span></div>
                <div className="pf-lignes">
                  <div className="pf-ligne"><CheckCircleIcon /><span>Authenticator configuré</span></div>
                  <div className="pf-ligne"><KeyIcon /><span>{profil.codes_secours_restants ?? 0} codes de secours restants</span></div>
                </div>
                <form onSubmit={genererCodes} className="pf-champs">
                  <label>Mot de passe<input type="password" value={mfa.password} onChange={(e) => setMfa({ ...mfa, password: e.target.value })} required /></label>
                  <label>Code TOTP actuel<input value={mfa.code} onChange={(e) => setMfa({ ...mfa, code: e.target.value })} placeholder="123456" required /></label>
                  <div className="pf-actions large"><button className="pf-bouton">Régénérer les codes de secours</button></div>
                </form>
                {codes.length > 0 && (
                  <div className="pf-codes">
                    <b>Codes de secours, à conserver hors ligne</b>
                    <div className="pf-codes-grille">{codes.map((c) => <code key={c}>{c}</code>)}</div>
                    <button className="pf-bouton" onClick={telechargerCodes}><DownloadIcon /> Télécharger</button>
                  </div>
                )}
              </section>

              <section className="pf-carte">
                <div className="pf-carte-head"><div><h2><VpnKeyIcon /> Passkeys</h2><p>Connectez-vous avec Face ID, Touch ID ou une clé de sécurité.</p></div></div>
                <div className="pf-lignes">
                  {passkeys.map((p) => (
                    <div className="pf-ligne" key={p.id}><KeyIcon /><span>{p.device_type === "single_device" ? "Clé de sécurité" : "Passkey synchronisée"} · {p.cree_le}</span></div>
                  ))}
                  {passkeys.length === 0 && <p className="pf-vide">Aucune passkey enregistrée.</p>}
                </div>
                <div className="pf-actions"><button className="pf-bouton" onClick={ajouterPasskey}>Ajouter une passkey</button></div>
              </section>

              <section className="pf-carte">
                <div className="pf-carte-head"><div><h2><EmailIcon /> Adresse email</h2><p>Vérifiez votre adresse pour sécuriser la récupération du compte.</p></div></div>
                {!verif.envoye ? (
                  <div className="pf-actions"><button className="pf-bouton" onClick={demanderVerif}>Envoyer un code</button></div>
                ) : (
                  <div className="pf-verif">
                    <input value={verif.code} onChange={(e) => setVerif({ ...verif, code: e.target.value })} placeholder="Code à 6 chiffres" />
                    <button className="pf-bouton plein" onClick={confirmerVerif}>Vérifier</button>
                    {verif.demo && <small>Code démo : {verif.demo}</small>}
                  </div>
                )}
              </section>
            </>
          )}

          {rubrique === "notifications" && (
            <section className="pf-carte">
              <div className="pf-carte-head"><div><h2><NotificationsIcon /> Préférences</h2><p>Choisissez les canaux utilisés pour les alertes.</p></div></div>
              <label className="pf-bascule"><span>Notifications par email</span><input type="checkbox" checked={Boolean(form.notif_email)} onChange={(e) => setForm({ ...form, notif_email: e.target.checked })} /><i /></label>
              <label className="pf-bascule"><span>Notifications navigateur</span><input type="checkbox" checked={Boolean(form.notif_push)} onChange={(e) => setForm({ ...form, notif_push: e.target.checked })} /><i /></label>
              <div className="pf-actions">
                <button className="pf-bouton plein" onClick={enregistrer}>Enregistrer</button>
                <button className="pf-bouton" onClick={async () => {
                  const ok = await activerNotifications();
                  setToast({ message: ok ? "Notifications navigateur activées." : "Autorisation refusée.", tone: ok ? "success" : "error" });
                }}>Autoriser le navigateur</button>
              </div>
            </section>
          )}

          {rubrique === "activite" && (
            <>
              <section className="pf-carte">
                <div className="pf-carte-head"><div><h2><DevicesIcon /> Sessions</h2><p>Appareils connectés à votre compte.</p></div></div>
                <div className="pf-lignes">
                  {sessions.map((s) => (
                    <div className="pf-ligne" key={s.id}><DevicesIcon /><span>{s.user_agent || "Navigateur"} · {s.ip} · {s.cree_le}</span><em>{s.active ? "Active" : "Fermée"}</em></div>
                  ))}
                  {sessions.length === 0 && <p className="pf-vide">Aucune session enregistrée.</p>}
                </div>
              </section>
              <section className="pf-carte">
                <div className="pf-carte-head"><div><h2><HistoryIcon /> Historique de sécurité</h2><p>Dernières actions sur votre compte.</p></div><RefreshIcon fontSize="small" /></div>
                <div className="pf-lignes">
                  {activite.slice(0, 30).map((a, i) => (
                    <div className="pf-ligne" key={i}><span /><div><b>{a.action}</b><small>{a.horo} · {a.ip} · {a.resultat}</small></div></div>
                  ))}
                  {activite.length === 0 && <p className="pf-vide">Aucune activité récente.</p>}
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
