import { useCallback, useEffect, useMemo, useState } from "react";
import GroupIcon from "@mui/icons-material/Group";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import EditIcon from "@mui/icons-material/Edit";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import LockIcon from "@mui/icons-material/Lock";
import KeyIcon from "@mui/icons-material/Key";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import ShieldIcon from "@mui/icons-material/Shield";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import BlockIcon from "@mui/icons-material/Block";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import SecurityIcon from "@mui/icons-material/Security";
import { api, dateFR } from "../api";
import { useAuth } from "../auth";
import { Badge, Empty, Modal, PageHead, PasswordStrength, Spinner, Toast } from "../components";

const ROLES = ["Admin", "Manager", "Commercial", "Auditeur"];
const COULEURS = {
  Admin: "linear-gradient(145deg,#0A2540,#3B338E)",
  Manager: "linear-gradient(145deg,#635BFF,#8B84FF)",
  Commercial: "linear-gradient(145deg,#00A06B,#00C07F)",
  Auditeur: "linear-gradient(145deg,#B47800,#E3A21A)",
};

function initiales(nom) {
  return String(nom || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join("");
}

function etat(u) {
  if (u.bloque_def) return { label: "Bloqué définitivement", tone: "red", cls: "off" };
  if (u.bloque_jusqua) {
    const d = new Date(String(u.bloque_jusqua).replace(" ", "T") + "Z");
    if (!Number.isNaN(d.getTime()) && d > new Date()) {
      return { label: `Verrouillé jusqu'à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`, tone: "amber", cls: "off" };
    }
  }
  if (!u.actif) return { label: "Désactivé", tone: "gray", cls: "off" };
  return { label: "Actif", tone: "green", cls: "on" };
}

const formVide = {
  login: "", nom: "", email: "", role: "Commercial", perimetre: "Littoral", pwd: "", confirmation: "",
};

export default function Users() {
  const { user: moi } = useAuth();
  const [users, setUsers] = useState(null);
  const [matrice, setMatrice] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [toast, setToast] = useState(null);
  const [envoi, setEnvoi] = useState("");
  const [q, setQ] = useState("");
  const [roleFiltre, setRoleFiltre] = useState("");
  const [etatFiltre, setEtatFiltre] = useState("");

  const [editeur, setEditeur] = useState(null);
  const [voirMdp, setVoirMdp] = useState(false);
  const [resetMdp, setResetMdp] = useState(null);
  const [voirMdpReset, setVoirMdpReset] = useState(false);
  const [confirmMfa, setConfirmMfa] = useState(null);

  const message = (txt, tone = "success") => setToast({ message: txt, tone });

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const [u, m] = await Promise.allSettled([api.get("/api/users"), api.get("/api/users/matrice")]);
      if (u.status === "fulfilled") setUsers(u.value.users || []);
      if (m.status === "fulfilled") setMatrice(m.value);
      if (u.status === "rejected") message(u.reason.message, "error");
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const agir = async (action, login, body = {}, succes) => {
    setEnvoi(action + ":" + login);
    try {
      const r = await api.post("/api/users", { action, login, ...body });
      message(r.message || succes || "Opération effectuée.");
      setEditeur(null);
      setResetMdp(null);
      setConfirmMfa(null);
      await charger();
    } catch (ex) {
      message(ex.message, "error");
    }
    setEnvoi("");
  };

  const ouvrirCreation = () => {
    setVoirMdp(false);
    setEditeur({ mode: "creer", ...formVide, perimetre: "Littoral" });
  };

  const ouvrirEdition = (u) => {
    setVoirMdp(false);
    setEditeur({
      mode: "modifier", login: u.login, nom: u.nom || "", email: u.email || "",
      role: u.role, perimetre: u.perimetre, pwd: "", confirmation: "",
    });
  };

  const enregistrer = async (e) => {
    e.preventDefault();
    if (!editeur) return;
    if (editeur.mode === "creer") {
      if (editeur.pwd !== editeur.confirmation) return message("Les deux mots de passe diffèrent.", "error");
      await agir("creer", editeur.login, {
        nom: editeur.nom, email: editeur.email, role: editeur.role,
        perimetre: editeur.perimetre, pwd: editeur.pwd,
      });
    } else {
      await agir("modifier", editeur.login, {
        nom: editeur.nom, email: editeur.email, role: editeur.role, perimetre: editeur.perimetre,
      });
    }
  };

  const reinitialiserMdp = async (e) => {
    e.preventDefault();
    if (!resetMdp) return;
    if (resetMdp.pwd !== resetMdp.confirmation) return message("Les deux mots de passe diffèrent.", "error");
    await agir("reset-mdp", resetMdp.login, { pwd: resetMdp.pwd });
  };

  const liste = useMemo(() => {
    const texte = q.trim().toLowerCase();
    return (users || []).filter((u) => {
      if (roleFiltre && u.role !== roleFiltre) return false;
      if (etatFiltre === "actif" && (!u.actif || u.bloque_def || u.bloque_jusqua)) return false;
      if (etatFiltre === "inactif" && u.actif) return false;
      if (etatFiltre === "mfa" && !u.mfa_actif) return false;
      if (!texte) return true;
      return [u.login, u.nom, u.email, u.role, u.perimetre]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(texte));
    });
  }, [users, q, roleFiltre, etatFiltre]);

  const stats = useMemo(() => {
    const base = users || [];
    return {
      total: base.length,
      actifs: base.filter((u) => u.actif && !u.bloque_def).length,
      mfa: base.filter((u) => u.mfa_actif).length,
      bloques: base.filter((u) => u.bloque_def || u.bloque_jusqua).length,
    };
  }, [users]);

  const regions = matrice?.regions || [];
  const permissions = matrice?.permissions || {};
  const rolesMatrice = matrice?.roles || {};

  return (
    <>
      <PageHead
        eyebrow="Gouvernance & accès"
        title="Utilisateurs & habilitations"
        sub="Créez des comptes, ajustez les périmètres, réinitialisez les facteurs compromis. Chaque action est journalisée dans la chaîne d'audit."
        actions={
          <button className="btn btn-brand" onClick={ouvrirCreation}>
            <PersonAddIcon /> Nouveau compte
          </button>
        }
      />

      <div className="users-page">
        <div className="users-summary">
          <div className="import-stat">
            <small>Comptes</small>
            <b>{stats.total}</b>
            <span>sur l'ensemble du réseau</span>
          </div>
          <div className="import-stat good">
            <small>Actifs</small>
            <b>{stats.actifs}</b>
            <span>peuvent se connecter aujourd'hui</span>
          </div>
          <div className="import-stat">
            <small>MFA active</small>
            <b>{stats.mfa}</b>
            <span>{stats.total ? Math.round((stats.mfa / stats.total) * 100) : 0} % des comptes</span>
          </div>
          <div className="import-stat bad">
            <small>À débloquer</small>
            <b>{stats.bloques}</b>
            <span>verrouillage temporaire ou définitif</span>
          </div>
        </div>

        <div className="user-toolbar">
          <div className="audit-search" style={{ maxWidth: 330 }}>
            <SearchIcon />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un nom, un login, un email…" aria-label="Rechercher un utilisateur" />
          </div>
          <select value={roleFiltre} onChange={(e) => setRoleFiltre(e.target.value)} aria-label="Filtrer par rôle">
            <option value="">Tous les rôles</option>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={etatFiltre} onChange={(e) => setEtatFiltre(e.target.value)} aria-label="Filtrer par état">
            <option value="">Tous les états</option>
            <option value="actif">Comptes actifs</option>
            <option value="inactif">Comptes désactivés</option>
            <option value="mfa">MFA activée</option>
          </select>
          <Badge tone="brand">{liste.length} / {stats.total}</Badge>
          <button className="btn btn-ghost btn-sm" onClick={charger} disabled={chargement}><RefreshIcon /> Actualiser</button>
        </div>

        <div className="audit-table-wrap">
          {chargement && !users ? (
            <div style={{ padding: 46, textAlign: "center" }}><Spinner label="Chargement des comptes…" /></div>
          ) : liste.length === 0 ? (
            <div className="users-empty"><Empty icon={<GroupIcon />} title="Aucun compte trouvé" text="Ajustez la recherche ou créez un nouvel utilisateur." action={<button className="btn btn-brand" onClick={ouvrirCreation}><PersonAddIcon /> Nouveau compte</button>} /></div>
          ) : (
            <div className="table-wrap">
              <table className="audit-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Utilisateur</th><th>Rôle</th><th>Périmètre</th><th>État</th><th>MFA</th>
                    <th>Échecs</th><th>Dernière connexion</th><th>Créé le</th><th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {liste.map((u) => {
                    const e = etat(u);
                    const connecte = u.login === moi?.login;
                    return (
                      <tr key={u.login}>
                        <td>
                          <div className="user-id">
                            <span className="user-avatar" style={{ background: COULEURS[u.role] || "#697386" }}>{initiales(u.nom)}</span>
                            <div>
                              <b>{u.nom}{connecte && <span className="faint" style={{ fontWeight: 500 }}> · vous</span>}</b>
                              <small>@{u.login} · {u.email || "email manquant"}</small>
                            </div>
                          </div>
                        </td>
                        <td><span className="role-pill">{u.role}</span></td>
                        <td>{u.perimetre}</td>
                        <td><span className={"user-status " + e.cls}><span className="live-dot" /> {e.label}</span></td>
                        <td>
                          {u.mfa_actif
                            ? <Badge tone="green"><VerifiedUserIcon style={{ fontSize: 11, verticalAlign: "-1px" }} /> Active</Badge>
                            : <Badge tone="amber">À configurer</Badge>}
                        </td>
                        <td style={{ color: u.echecs ? "var(--red)" : "var(--faint)", fontWeight: u.echecs ? 700 : 400 }}>{u.echecs || 0}</td>
                        <td className="audit-date">{u.derniere_connexion ? dateFR(u.derniere_connexion, true) : "Jamais"}</td>
                        <td className="audit-date">{dateFR(u.cree_le)}</td>
                        <td>
                          <div className="user-actions" style={{ justifyContent: "flex-end" }}>
                            <button className="icon-btn" title="Modifier le profil" onClick={() => ouvrirEdition(u)}><EditIcon /></button>
                            <button className="icon-btn" title="Réinitialiser le mot de passe" onClick={() => { setVoirMdpReset(false); setResetMdp({ login: u.login, nom: u.nom, pwd: "", confirmation: "" }); }}><KeyIcon /></button>
                            <button className="icon-btn" title="Réinitialiser la MFA" onClick={() => setConfirmMfa({ u, action: "reset-mfa", titre: "Réinitialiser la MFA", texte: "Le secret TOTP et les codes de secours seront supprimés. L'utilisateur devra réenrôler son application à la prochaine connexion." })}><ShieldIcon /></button>
                            {(u.bloque_def || u.bloque_jusqua || u.echecs > 0) && (
                              <button className="icon-btn" title="Débloquer le compte" onClick={() => agir("debloquer", u.login)}><LockOpenIcon /></button>
                            )}
                            {u.actif ? (
                              <button className="icon-btn danger" title="Désactiver le compte" disabled={connecte}
                                onClick={() => setConfirmMfa({ u, action: "desactiver", titre: "Désactiver le compte", texte: "L'utilisateur sera déconnecté immédiatement et ne pourra plus se connecter tant que le compte n'est pas réactivé." })}>
                                <BlockIcon />
                              </button>
                            ) : (
                              <button className="icon-btn" title="Réactiver le compte" onClick={() => agir("activer", u.login)}><CheckCircleIcon /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <section className="permissions-matrix">
          <h2><SecurityIcon /> Matrice des permissions</h2>
          <p className="hint">Les droits sont attachés au rôle, jamais au compte. Le périmètre restreint ensuite les données visibles.</p>
          <div className="matrix-scroll">
            <table className="matrix-table">
              <thead>
                <tr>
                  <th>Permission</th>
                  {ROLES.map((r) => <th key={r} className="matrix-role">{r}</th>)}
                </tr>
              </thead>
              <tbody>
                {Object.entries(permissions).map(([code, label]) => (
                  <tr key={code}>
                    <td>
                      <span className="perm-label">{label}</span>
                      <span className="perm-code">{code}</span>
                    </td>
                    {ROLES.map((r) => (
                      <td key={r}>
                        {(rolesMatrice[r] || []).includes(code)
                          ? <CheckCircleIcon className="check" titleAccess="Autorisé" />
                          : <span className="dash">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {regions.length > 0 && (
            <p className="form-note" style={{ marginTop: 12 }}>
              <ShieldIcon /> Périmètres disponibles : National · {regions.join(" · ")}
            </p>
          )}
        </section>
      </div>

      <Modal
        open={Boolean(editeur)}
        onClose={() => setEditeur(null)}
        title={editeur?.mode === "creer" ? "Créer un compte" : "Modifier le compte"}
        subtitle={editeur?.mode === "creer"
          ? "Le compte sera actif immédiatement. La MFA s'enrôle à la première connexion."
          : `Ajustez le profil de @${editeur?.login}. Toute modification invalide ses sessions.`}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEditeur(null)}>Annuler</button>
            <button className="btn btn-brand" onClick={enregistrer} disabled={envoi.startsWith("creer") || envoi.startsWith("modifier")}>
              {(envoi.startsWith("creer") || envoi.startsWith("modifier")) ? <><Spinner inline label="" /> Enregistrement…</> : (editeur?.mode === "creer" ? "Créer le compte" : "Enregistrer")}
            </button>
          </>
        }
      >
        {editeur && (
          <form className="user-form" onSubmit={enregistrer}>
            <div className="cols-2">
              <div className="field">
                <label>Identifiant</label>
                <input value={editeur.login} onChange={(e) => setEditeur({ ...editeur, login: e.target.value })} required minLength={3} maxLength={40}
                  pattern="[a-z0-9_.-]+" title="Lettres minuscules, chiffres, point, tiret et underscore." disabled={editeur.mode === "modifier"}
                  placeholder="ex. a.ngono" autoComplete="off" />
                {editeur.mode === "modifier" && <small>L'identifiant ne peut plus être modifié.</small>}
              </div>
              <div className="field">
                <label>Nom affiché</label>
                <input value={editeur.nom} onChange={(e) => setEditeur({ ...editeur, nom: e.target.value })} required maxLength={80} placeholder="ex. Alice Ngono" />
              </div>
            </div>
            <div className="field">
              <label>Email professionnel</label>
              <input type="email" value={editeur.email} onChange={(e) => setEditeur({ ...editeur, email: e.target.value })} required maxLength={120} placeholder="prenom.nom@entreprise.cm" />
            </div>
            <div className="cols-2">
              <div className="field">
                <label>Rôle</label>
                <select value={editeur.role} onChange={(e) => setEditeur({ ...editeur, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Périmètre</label>
                <select value={editeur.perimetre} onChange={(e) => setEditeur({ ...editeur, perimetre: e.target.value })}>
                  <option value="National">National</option>
                  {regions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            {editeur.mode === "creer" && (
              <>
                <div className="field">
                  <label>Mot de passe initial</label>
                  <span className="pw-wrap">
                    <input type={voirMdp ? "text" : "password"} value={editeur.pwd} onChange={(e) => setEditeur({ ...editeur, pwd: e.target.value })} required autoComplete="new-password" />
                    <button type="button" onClick={() => setVoirMdp(!voirMdp)}>{voirMdp ? "Masquer" : "Afficher"}</button>
                  </span>
                  <PasswordStrength value={editeur.pwd} />
                </div>
                <div className="field">
                  <label>Confirmation</label>
                  <input type={voirMdp ? "text" : "password"} value={editeur.confirmation} onChange={(e) => setEditeur({ ...editeur, confirmation: e.target.value })} required autoComplete="new-password" />
                  {editeur.confirmation && editeur.confirmation !== editeur.pwd && <small style={{ color: "var(--red)" }}>Les deux saisies diffèrent.</small>}
                </div>
                <div className="form-note"><ShieldIcon /> 12 caractères minimum, majuscule, minuscule, chiffre et symbole. Aucun mot de passe évident.</div>
              </>
            )}
            {editeur.mode === "modifier" && (
              <div className="form-note"><WarningAmberIcon /> Modifier le rôle ou le périmètre force une reconnexion immédiate de l'utilisateur.</div>
            )}
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(resetMdp)}
        onClose={() => setResetMdp(null)}
        title="Réinitialiser le mot de passe"
        subtitle={resetMdp ? `Un nouveau secret temporaire pour @${resetMdp.login}. Toutes ses sessions seront fermées.` : ""}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setResetMdp(null)}>Annuler</button>
            <button className="btn btn-brand" onClick={reinitialiserMdp} disabled={envoi.startsWith("reset-mdp")}>
              {envoi.startsWith("reset-mdp") ? <><Spinner inline label="" /> Réinitialisation…</> : <><KeyIcon /> Réinitialiser</>}
            </button>
          </>
        }
      >
        {resetMdp && (
          <form onSubmit={reinitialiserMdp}>
            <div className="field">
              <label>Nouveau mot de passe</label>
              <span className="pw-wrap">
                <input type={voirMdpReset ? "text" : "password"} value={resetMdp.pwd} onChange={(e) => setResetMdp({ ...resetMdp, pwd: e.target.value })} required autoComplete="new-password" />
                <button type="button" onClick={() => setVoirMdpReset(!voirMdpReset)}>{voirMdpReset ? "Masquer" : "Afficher"}</button>
              </span>
              <PasswordStrength value={resetMdp.pwd} />
            </div>
            <div className="field">
              <label>Confirmation</label>
              <input type={voirMdpReset ? "text" : "password"} value={resetMdp.confirmation} onChange={(e) => setResetMdp({ ...resetMdp, confirmation: e.target.value })} required autoComplete="new-password" />
              {resetMdp.confirmation && resetMdp.confirmation !== resetMdp.pwd && <small style={{ color: "var(--red)" }}>Les deux saisies diffèrent.</small>}
            </div>
            <div className="form-note"><LockIcon /> Communiquez le mot de passe par un canal sûr. L'utilisateur devra le changer après connexion.</div>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(confirmMfa)}
        onClose={() => setConfirmMfa(null)}
        title={confirmMfa?.titre || "Confirmer"}
        subtitle={confirmMfa ? `Compte @${confirmMfa.u.login} · action journalisée.` : ""}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setConfirmMfa(null)}>Annuler</button>
            <button className={"btn " + (confirmMfa?.action === "desactiver" ? "btn-danger" : "btn-brand")}
              onClick={() => agir(confirmMfa.action, confirmMfa.u.login)}
              disabled={Boolean(envoi)}>
              {envoi ? <><Spinner inline label="" /> Traitement…</> : "Confirmer"}
            </button>
          </>
        }
      >
        <div className="detail-block" style={{ fontSize: 12.5 }}>
          <b><WarningAmberIcon style={{ fontSize: 13, verticalAlign: "-2px" }} /> {confirmMfa?.titre}</b>
          {confirmMfa?.texte}
        </div>
      </Modal>

      <Toast message={toast?.message} tone={toast?.tone} onClose={() => setToast(null)} />
    </>
  );
}
