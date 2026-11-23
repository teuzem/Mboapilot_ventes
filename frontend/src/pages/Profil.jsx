import { useCallback, useEffect, useState } from "react";
import PersonIcon from "@mui/icons-material/Person";
import SecurityIcon from "@mui/icons-material/Security";
import HistoryIcon from "@mui/icons-material/History";
import NotificationsIcon from "@mui/icons-material/Notifications";
import KeyIcon from "@mui/icons-material/Key";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import DevicesIcon from "@mui/icons-material/Devices";
import EmailIcon from "@mui/icons-material/Email";
import DownloadIcon from "@mui/icons-material/Download";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { api } from "../api";
import { useAuth } from "../auth";
import { activerNotifications } from "../push";
import { Badge, Spinner, Toast } from "../components";

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

const ONGLETS = [
  { id: "compte", label: "Informations personnelles", icon: <PersonIcon /> },
  { id: "securite", label: "Sécurité", icon: <SecurityIcon /> },
  { id: "activite", label: "Activité", icon: <HistoryIcon /> },
  { id: "notifications", label: "Notifications", icon: <NotificationsIcon /> },
];

export default function Profil() {
  const { user, refresh } = useAuth();
  const [onglet, setOnglet] = useState("compte");
  const [profil, setProfil] = useState(null);
  const [formulaire, setFormulaire] = useState(null);
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
      setFormulaire({ ...p });
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

  const enregistrer = async (e) => {
    e.preventDefault();
    setOccupe(true);
    try {
      const r = await api.post("/api/profil", formulaire);
      setToast({ message: r.message, tone: "success" });
      setProfil(r.profil);
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

  const genererCodes = async () => {
    try {
      const r = await api.post("/api/auth/mfa/codes-secours", mfa);
      setCodes(r.recovery_codes || []);
      setToast({ message: "Nouveaux codes générés. Enregistrez-les maintenant.", tone: "success" });
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
  };

  const ajouterPasskey = async () => {
    if (!window.PublicKeyCredential) {
      setToast({ message: "Passkeys non prises en charge par ce navigateur.", tone: "error" });
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
    const texte = codes.join("\n");
    const url = URL.createObjectURL(new Blob([texte], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "mboapilot-codes-secours.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!profil || !formulaire) return <div className="page"><Spinner label="Chargement du profil" /></div>;

  return (
    <div className="page profil-page">
      <Toast toast={toast} />
      <div className="profil-entete">
        <label className="avatar">
          {profil.avatar_url ? <img src={profil.avatar_url} alt="" /> : <span>{profil.initiales}</span>}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={changerAvatar} />
          <small>Modifier</small>
        </label>
        <div>
          <h1>{profil.prenom || ""} {profil.nom}</h1>
          <p>{profil.poste || "Utilisateur"} {profil.organisation ? "· " + profil.organisation : ""}</p>
          <div className="profil-badges">
            <Badge tone="blue">{profil.role}</Badge>
            <Badge tone={profil.email_verifie ? "green" : "orange"}>
              {profil.email_verifie ? "Email vérifié" : "Email à vérifier"}
            </Badge>
            <Badge tone={profil.mfa_actif !== false ? "green" : "orange"}>
              {profil.mfa_actif ? "Double facteur actif" : "Double facteur inactif"}
            </Badge>
          </div>
        </div>
      </div>

      <div className="profil-layout">
        <nav className="profil-nav">
          {ONGLETS.map((o) => (
            <button key={o.id} className={onglet === o.id ? "actif" : ""} onClick={() => setOnglet(o.id)}>
              {o.icon}<span>{o.label}</span>
            </button>
          ))}
        </nav>

        <div className="profil-contenu">
          {onglet === "compte" && (
            <form className="profil-carte" onSubmit={enregistrer}>
              <div className="carte-titre"><h2>Informations personnelles</h2><p>Modifiez vos coordonnées et vos préférences.</p></div>
              <div className="champs-2">
                <label>Prénom<input value={formulaire.prenom || ""} onChange={(e) => setFormulaire({ ...formulaire, prenom: e.target.value })} /></label>
                <label>Nom<input value={formulaire.nom || ""} onChange={(e) => setFormulaire({ ...formulaire, nom: e.target.value })} /></label>
                <label>Adresse email<input type="email" value={formulaire.email || ""} onChange={(e) => setFormulaire({ ...formulaire, email: e.target.value })} /></label>
                <label>Téléphone<input value={formulaire.telephone || ""} onChange={(e) => setFormulaire({ ...formulaire, telephone: e.target.value })} placeholder="+237 6 00 00 00 00" /></label>
                <label>Poste<input value={formulaire.poste || ""} onChange={(e) => setFormulaire({ ...formulaire, poste: e.target.value })} /></label>
                <label>Organisation<input value={formulaire.organisation || ""} onChange={(e) => setFormulaire({ ...formulaire, organisation: e.target.value })} /></label>
              </div>
              <label>Biographie<textarea rows="3" value={formulaire.bio || ""} onChange={(e) => setFormulaire({ ...formulaire, bio: e.target.value })} /></label>
              <div className="champs-2">
                <label>Langue
                  <select value={formulaire.langue || "fr"} onChange={(e) => setFormulaire({ ...formulaire, langue: e.target.value })}>
                    <option value="fr">Français</option><option value="en">English</option>
                  </select>
                </label>
                <label>Fuseau horaire<input value={formulaire.fuseau || ""} onChange={(e) => setFormulaire({ ...formulaire, fuseau: e.target.value })} /></label>
              </div>
              <button className="btn btn-brand" disabled={occupe}>Enregistrer les modifications</button>
            </form>
          )}

          {onglet === "securite" && (
            <>
              <section className="profil-carte">
                <div className="carte-titre"><h2><SecurityIcon /> Mot de passe</h2><p>Utilisez une phrase secrète que vous n'utilisez nulle part ailleurs.</p></div>
                <form onSubmit={changerMotDePasse} className="champs-2">
                  <label>Mot de passe actuel<input type="password" value={mdp.actuel} onChange={(e) => setMdp({ ...mdp, actuel: e.target.value })} required /></label>
                  <label>Nouveau mot de passe<input type="password" value={mdp.nouveau} onChange={(e) => setMdp({ ...mdp, nouveau: e.target.value })} required /></label>
                  <label>Confirmation<input type="password" value={mdp.confirmation} onChange={(e) => setMdp({ ...mdp, confirmation: e.target.value })} required /></label>
                  <div className="align-fin"><button className="btn btn-brand">Changer le mot de passe</button></div>
                </form>
              </section>

              <section className="profil-carte">
                <div className="carte-titre"><h2><QrCode2Icon /> Authentification à deux facteurs</h2><p>Chaque connexion demande un code TOTP ou une passkey.</p></div>
                <div className="etat-ligne"><CheckCircleIcon /><span>{profil.mfa_actif ? "Active sur ce compte" : "Non activée"}</span></div>
                <form onSubmit={genererCodes} className="champs-2">
                  <label>Mot de passe<input type="password" value={mfa.password} onChange={(e) => setMfa({ ...mfa, password: e.target.value })} required /></label>
                  <label>Code TOTP actuel<input value={mfa.code} onChange={(e) => setMfa({ ...mfa, code: e.target.value })} placeholder="123456" required /></label>
                  <div className="align-fin"><button className="btn btn-outline">Régénérer les codes de secours</button></div>
                </form>
                {codes.length > 0 && (
                  <div className="codes-secours">
                    <b>Codes de secours, à conserver hors ligne</b>
                    <div className="codes-grille">{codes.map((c) => <code key={c}>{c}</code>)}</div>
                    <button className="btn btn-ghost" onClick={telechargerCodes}><DownloadIcon /> Télécharger</button>
                  </div>
                )}
              </section>

              <section className="profil-carte">
                <div className="carte-titre"><h2><VpnKeyIcon /> Passkeys</h2><p>Connectez-vous avec Face ID, Touch ID ou une clé de sécurité.</p></div>
                {passkeys.map((p) => (
                  <div className="etat-ligne" key={p.id}><KeyIcon /><span>{p.device_type === "single_device" ? "Clé de sécurité" : "Passkey synchronisée"} · ajoutée le {p.cree_le}</span></div>
                ))}
                {passkeys.length === 0 && <p className="hint">Aucune passkey enregistrée.</p>}
                <button className="btn btn-outline" onClick={ajouterPasskey}>Ajouter une passkey</button>
              </section>

              <section className="profil-carte">
                <div className="carte-titre"><h2><EmailIcon /> Vérification de l'adresse email</h2><p>Un code est envoyé à {profil.email}.</p></div>
                {!verif.envoye ? (
                  <button className="btn btn-outline" onClick={demanderVerif}>Envoyer le code</button>
                ) : (
                  <div className="ligne-verif">
                    <input value={verif.code} onChange={(e) => setVerif({ ...verif, code: e.target.value })} placeholder="Code à 6 chiffres" />
                    <button className="btn btn-brand" onClick={confirmerVerif}>Vérifier</button>
                    {verif.demo && <small>Code démo : {verif.demo}</small>}
                  </div>
                )}
              </section>
            </>
          )}

          {onglet === "activite" && (
            <>
              <section className="profil-carte">
                <div className="carte-titre"><h2><DevicesIcon /> Sessions</h2><p>Appareils connectés à votre compte.</p></div>
                {sessions.map((s) => (
                  <div className="etat-ligne" key={s.id}>
                    <DevicesIcon /><span>{s.user_agent || "Navigateur"} · {s.ip} · {s.cree_le}</span>
                    <Badge tone={s.active ? "green" : "grey"}>{s.active ? "Active" : "Fermée"}</Badge>
                  </div>
                ))}
                {sessions.length === 0 && <p className="hint">Aucune session enregistrée.</p>}
              </section>
              <section className="profil-carte">
                <div className="carte-titre"><h2><HistoryIcon /> Historique de sécurité</h2><p>Dernières actions sur votre compte.</p></div>
                {activite.slice(0, 30).map((a, i) => (
                  <div className="etat-ligne" key={i}><span /><div><b>{a.action}</b><small>{a.horo} · {a.ip} · {a.resultat}</small></div></div>
                ))}
                {activite.length === 0 && <p className="hint">Aucune activité récente.</p>}
              </section>
            </>
          )}

          {onglet === "notifications" && (
            <section className="profil-carte">
              <div className="carte-titre"><h2><NotificationsIcon /> Préférences</h2><p>Choisissez les canaux que vous souhaitez utiliser.</p></div>
              <label className="bascule"><span>Notifications par email</span><input type="checkbox" checked={Boolean(formulaire.notif_email)} onChange={(e) => setFormulaire({ ...formulaire, notif_email: e.target.checked })} /><i /></label>
              <label className="bascule"><span>Notifications navigateur</span><input type="checkbox" checked={Boolean(formulaire.notif_push)} onChange={(e) => setFormulaire({ ...formulaire, notif_push: e.target.checked })} /><i /></label>
              <button className="btn btn-brand" onClick={enregistrer}>Enregistrer les préférences</button>
              <button className="btn btn-outline" onClick={async () => {
                const ok = await activerNotifications();
                setToast({ message: ok ? "Notifications navigateur activées." : "Autorisation refusée ou non prise en charge.", tone: ok ? "success" : "error" });
              }}>Autoriser les notifications navigateur</button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
