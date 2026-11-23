import { useCallback, useEffect, useMemo, useState } from "react";
import ShieldIcon from "@mui/icons-material/Shield";
import LockIcon from "@mui/icons-material/Lock";
import KeyIcon from "@mui/icons-material/Key";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DownloadIcon from "@mui/icons-material/Download";
import RefreshIcon from "@mui/icons-material/Refresh";
import HistoryIcon from "@mui/icons-material/History";
import DevicesIcon from "@mui/icons-material/Devices";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import { api, dateFR } from "../api";
import { useAuth } from "../auth";
import { Badge, CopyButton, Modal, PageHead, PasswordStrength, Spinner, Toast } from "../components";

function b64url(buffer) {
  const octets = new Uint8Array(buffer);
  let binaire = "";
  for (const o of octets) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeB64url(texte) {
  const pad = "=".repeat((4 - (texte.length % 4)) % 4);
  const binaire = atob(texte.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(binaire, (c) => c.charCodeAt(0));
}

function prepareCredential(credential) {
  const response = credential.response;
  return {
    id: credential.id,
    rawId: b64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: b64url(response.clientDataJSON),
      attestationObject: response.attestationObject ? b64url(response.attestationObject) : undefined,
      authenticatorData: response.authenticatorData ? b64url(response.authenticatorData) : undefined,
      signature: response.signature ? b64url(response.signature) : undefined,
      userHandle: response.userHandle ? b64url(response.userHandle) : undefined,
    },
    clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
    transports: response.getTransports ? response.getTransports() : undefined,
  };
}

function telechargerCodes(codes, login) {
  const texte = [
    "MboaPilot - codes de secours MFA",
    `Compte : ${login}`,
    `Générés le : ${new Date().toLocaleString("fr-FR")}`,
    "",
    "Chaque code est à usage unique. Conservez ce fichier hors ligne.",
    "",
    ...codes,
    "",
  ].join("\n");
  const blob = new Blob([texte], { type: "text/plain;charset=utf-8" });
  const lien = document.createElement("a");
  const url = URL.createObjectURL(blob);
  lien.href = url;
  lien.download = `mboapilot-codes-secours-${login}.txt`;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export default function Compte() {
  const { user } = useAuth();
  const [secu, setSecu] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [toast, setToast] = useState(null);
  const [envoi, setEnvoi] = useState("");

  const [mdp, setMdp] = useState({ actuel: "", nouveau: "", confirmation: "" });
  const [voirMdp, setVoirMdp] = useState(false);

  const [mfaModal, setMfaModal] = useState(false);
  const [mfaStep, setMfaStep] = useState("auth");
  const [mfaForm, setMfaForm] = useState({ password: "", code: "" });
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [codesModal, setCodesModal] = useState(false);
  const [disableModal, setDisableModal] = useState(false);
  const [disableForm, setDisableForm] = useState({ password: "", code: "" });
  const [passkeys, setPasskeys] = useState([]);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const r = await api.get("/api/auth/security");
      setSecu(r);
      const p = await api.get("/api/webauthn/credentials").catch(() => ({ credentials: [] }));
      setPasskeys(p.credentials || []);
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const ajouterPasskey = async () => {
    if (!window.PublicKeyCredential) {
      message("Ce navigateur ne prend pas en charge les passkeys.", "error");
      return;
    }
    setPasskeyBusy(true);
    try {
      const options = await api.post("/api/webauthn/register-options", {});
      options.challenge = decodeB64url(options.challenge);
      options.user.id = decodeB64url(options.user.id);
      if (options.excludeCredentials) {
        options.excludeCredentials = options.excludeCredentials.map((c) => ({
          ...c, id: decodeB64url(c.id),
        }));
      }
      const credential = await navigator.credentials.create({ publicKey: options });
      if (!credential) throw new Error("Création annulée.");
      await api.post("/api/webauthn/register-verify", prepareCredential(credential));
      message("Passkey enregistrée. Vous pouvez vous connecter avec elle.");
      await charger();
    } catch (ex) {
      message(ex.message || "Impossible d'enregistrer la passkey.", "error");
    }
    setPasskeyBusy(false);
  };

  const supprimerPasskey = async (id) => {
    try {
      await api.del("/api/webauthn/credentials/" + id);
      message("Passkey supprimée.");
      await charger();
    } catch (ex) {
      message(ex.message, "error");
    }
  };

  const message = (txt, tone = "success") => setToast({ message: txt, tone });

  const score = useMemo(() => {
    if (!secu) return 0;
    let s = 35;
    if (secu.mfa_actif) s += 35;
    if ((secu.codes_secours_restants || 0) >= 5) s += 15;
    else if ((secu.codes_secours_restants || 0) > 0) s += 8;
    if (secu.mot_de_passe_maj) {
      const d = new Date(String(secu.mot_de_passe_maj).replace(" ", "T") + "Z");
      if (!Number.isNaN(d.getTime()) && (Date.now() - d.getTime()) / 86400000 < 180) s += 15;
    } else {
      s += 5;
    }
    return Math.min(100, s);
  }, [secu]);

  const changerMdp = async (e) => {
    e.preventDefault();
    setEnvoi("mdp");
    try {
      const r = await api.post("/api/auth/password", mdp);
      message(r.message);
      setMdp({ actuel: "", nouveau: "", confirmation: "" });
      await charger();
    } catch (ex) {
      message(ex.message, "error");
    }
    setEnvoi("");
  };

  const ouvrirMfa = () => {
    setMfaForm({ password: "", code: "" });
    setMfaSecret("");
    setMfaCode("");
    setMfaStep("auth");
    setMfaModal(true);
  };

  const demarrerRotation = async (e) => {
    e.preventDefault();
    setEnvoi("mfa");
    try {
      const r = await api.post("/api/auth/mfa/activer", {
        password: mfaForm.password,
        code: mfaForm.code,
      });
      setMfaSecret(r.secret);
      setMfaStep("qr");
    } catch (ex) {
      message(ex.message, "error");
    }
    setEnvoi("");
  };

  const confirmerMfa = async (e) => {
    e.preventDefault();
    setEnvoi("mfa-confirm");
    try {
      const r = await api.post("/api/auth/mfa/confirmer-activation", { code: mfaCode });
      setRecoveryCodes(r.recovery_codes || []);
      setMfaStep("codes");
      await charger();
    } catch (ex) {
      message(ex.message, "error");
    }
    setEnvoi("");
  };

  const fermerMfa = () => {
    setMfaModal(false);
    setMfaSecret("");
    setMfaCode("");
    setRecoveryCodes([]);
  };

  const regenererCodes = async (e) => {
    e.preventDefault();
    setEnvoi("codes");
    try {
      const r = await api.post("/api/auth/mfa/codes-secours", {
        password: disableForm.password,
        code: disableForm.code,
      });
      setRecoveryCodes(r.recovery_codes || []);
      setCodesModal(true);
      setDisableModal(false);
      setDisableForm({ password: "", code: "" });
      await charger();
    } catch (ex) {
      message(ex.message, "error");
    }
    setEnvoi("");
  };

  const desactiverMfa = async (e) => {
    e.preventDefault();
    setEnvoi("desactiver");
    try {
      const r = await api.post("/api/auth/mfa/desactiver", disableForm);
      message(r.message);
      setDisableModal(false);
      setDisableForm({ password: "", code: "" });
      await charger();
    } catch (ex) {
      message(ex.message, "error");
    }
    setEnvoi("");
  };

  if (chargement && !secu) {
    return <div className="panel" style={{ padding: 60, textAlign: "center" }}><Spinner label="Chargement de votre profil de sécurité…" /></div>;
  }

  return (
    <>
      <PageHead
        eyebrow="Compte & sécurité"
        title="Votre identité numérique"
        sub="Mot de passe, authentificateur TOTP, codes de secours et traçabilité : tout ce qui protège votre accès est ici."
        actions={
          <button className="btn btn-outline" onClick={charger} disabled={chargement}>
            <RefreshIcon /> {chargement ? "Actualisation…" : "Actualiser"}
          </button>
        }
      />

      <div className="account-page">
        <section className="security-banner">
          <div className="score-ring" style={{ "--score": score }}>
            <b>{score}</b>
            <span>Score</span>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2>{score >= 85 ? "Votre accès est solide." : score >= 60 ? "Encore un effort." : "Sécurisez votre compte."}</h2>
            <p>
              {secu?.mfa_actif
                ? "Authenticator actif. Les connexions sans second facteur sont refusées, même avec le bon mot de passe."
                : "Activez l'authenticator TOTP pour ajouter un second facteur à chaque connexion."}
            </p>
            <div className="security-facts">
              <span><VerifiedUserIcon /> TOTP RFC 6238</span>
              <span><LockIcon /> CSRF systématique</span>
              <span><HistoryIcon /> Journal chaîné SHA-256</span>
              <span><KeyIcon /> {secu?.codes_secours_restants ?? 0} code(s) de secours</span>
            </div>
          </div>
          {!secu?.mfa_actif && (
            <button className="btn btn-white" onClick={ouvrirMfa}><QrCode2Icon /> Activer la MFA</button>
          )}
        </section>

        <div className="account-grid">
          <div className="account-main">
            <section className="account-card">
              <h2><ShieldIcon /> Identité & habilitations</h2>
              <p className="hint">Ces informations sont gérées par votre administrateur. Le périmètre détermine les données visibles.</p>
              <div className="account-dl">
                <div><small>Identifiant</small><b>{secu?.login}</b></div>
                <div><small>Nom affiché</small><b>{secu?.nom}</b></div>
                <div><small>Rôle</small><b><Badge tone="brand">{secu?.role}</Badge></b></div>
                <div><small>Périmètre</small><b>{secu?.perimetre}</b></div>
                <div><small>Email professionnel</small><b>{secu?.email_complet || secu?.email} <CheckCircleIcon /></b></div>
                <div><small>Téléphone</small><b>{secu?.telephone || "Non renseigné"}</b></div>
                <div><small>Compte créé le</small><b>{dateFR(secu?.cree_le)}</b></div>
                <div><small>Dernière connexion</small><b>{dateFR(secu?.derniere_connexion, true)}</b></div>
              </div>
            </section>

            <section className="account-card">
              <h2><LockIcon /> Changer le mot de passe</h2>
              <p className="hint">12 caractères minimum, avec majuscule, minuscule, chiffre et symbole. Les autres sessions seront invalidées immédiatement.</p>
              <form onSubmit={changerMdp}>
                <div className="field">
                  <label htmlFor="mdp-actuel">Mot de passe actuel</label>
                  <input id="mdp-actuel" type="password" value={mdp.actuel} onChange={(e) => setMdp({ ...mdp, actuel: e.target.value })} required autoComplete="current-password" />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="mdp-nouveau">Nouveau mot de passe</label>
                    <span className="pw-wrap">
                      <input id="mdp-nouveau" type={voirMdp ? "text" : "password"} value={mdp.nouveau} onChange={(e) => setMdp({ ...mdp, nouveau: e.target.value })} required autoComplete="new-password" />
                      <button type="button" onClick={() => setVoirMdp(!voirMdp)}>{voirMdp ? "Masquer" : "Afficher"}</button>
                    </span>
                    <PasswordStrength value={mdp.nouveau} />
                  </div>
                  <div className="field">
                    <label htmlFor="mdp-confirmation">Confirmation</label>
                    <input id="mdp-confirmation" type={voirMdp ? "text" : "password"} value={mdp.confirmation} onChange={(e) => setMdp({ ...mdp, confirmation: e.target.value })} required autoComplete="new-password" />
                    {mdp.confirmation && mdp.confirmation !== mdp.nouveau && <small style={{ color: "var(--red)" }}>Les deux saisies diffèrent.</small>}
                  </div>
                </div>
                <button className="btn btn-brand" disabled={envoi === "mdp"}>
                  {envoi === "mdp" ? <><Spinner inline label="" /> Mise à jour…</> : "Mettre à jour le mot de passe"}
                </button>
              </form>
            </section>

            <section className="account-card">
              <h2><QrCode2Icon /> Authentification à deux facteurs</h2>
              <p className="hint">Un code à 6 chiffres, renouvelé toutes les 30 secondes par votre application d'authentification. Aucun code n'est envoyé par email.</p>
              <div className={"mfa-state" + (secu?.mfa_actif ? "" : " off")}>
                {secu?.mfa_actif ? <VerifiedUserIcon /> : <WarningAmberIcon />}
                <div>
                  <b>{secu?.mfa_actif ? "Authenticator actif" : "Authenticator inactif"}</b>
                  <span>
                    {secu?.mfa_actif
                      ? `Second facteur exigé à chaque connexion · ${secu?.codes_secours_restants ?? 0} code(s) de secours utilisable(s).`
                      : "Activez la MFA pour protéger votre compte, même si votre mot de passe est compromis."}
                  </span>
                </div>
                <Badge tone={secu?.mfa_actif ? "green" : "amber"}>{secu?.mfa_actif ? "Protégé" : "À activer"}</Badge>
              </div>
              <div className="account-actions">
                {secu?.mfa_actif ? (
                  <>
                    <button className="btn btn-brand" onClick={ouvrirMfa}><RefreshIcon /> Remplacer l'application</button>
                    <button className="btn btn-outline" onClick={() => { setDisableForm({ password: "", code: "" }); setDisableModal(true); }}>
                      <KeyIcon /> Régénérer les codes de secours
                    </button>
                    <button className="btn btn-ghost" onClick={() => { setDisableForm({ password: "", code: "" }); setDisableModal(true); }}>
                      Désactiver la MFA
                    </button>
                  </>
                ) : (
                  <button className="btn btn-brand" onClick={ouvrirMfa}><QrCode2Icon /> Configurer l'authenticator</button>
                )}
              </div>
            </section>
          </div>

          <div className="account-side">
            <section className="account-card">
              <h2><DevicesIcon /> Sessions & protections</h2>
              <p className="hint">Une session inactive est fermée automatiquement.</p>
              <div className="session-list">
                <div className="session-row">
                  <DevicesIcon />
                  <div><b>Session courante</b><span>Navigateur web · {user?.role} {user?.perimetre ? `· ${user.perimetre}` : ""}</span></div>
                  <Badge tone="green">Active</Badge>
                </div>
                <div className="session-row">
                  <LockIcon />
                  <div><b>Inactivité</b><span>Fermeture automatique après 30 minutes</span></div>
                </div>
                <div className="session-row">
                  <ShieldIcon />
                  <div><b>Durée maximale</b><span>8 heures, renouvellement de session contrôlé</span></div>
                </div>
                <div className="session-row">
                  <VpnKeyIcon />
                  <div><b>Anti-rejeu</b><span>Jeton CSRF sur toutes les écritures</span></div>
                </div>
              </div>
            </section>

            <section className="account-card">
              <h2><VpnKeyIcon /> Passkeys</h2>
              <p className="hint">Connectez-vous avec Face ID, Touch ID ou une clé de sécurité. Résistant au phishing.</p>
              <div className="session-list">
                {passkeys.length === 0 && (
                  <div className="session-row"><span /><div><b>Aucune passkey</b><span>Ajoutez-en une pour remplacer le code TOTP au quotidien.</span></div></div>
                )}
                {passkeys.map((p) => (
                  <div className="session-row" key={p.id}>
                    <VpnKeyIcon />
                    <div>
                      <b>{p.device_type === "single_device" ? "Clé de sécurité" : "Passkey synchronisée"}</b>
                      <span>Ajoutée le {dateFR(p.cree_le, true)}</span>
                    </div>
                    <button className="btn btn-ghost" onClick={() => supprimerPasskey(p.id)}>Retirer</button>
                  </div>
                ))}
              </div>
              <button className="btn btn-brand" onClick={ajouterPasskey} disabled={passkeyBusy}>
                <VpnKeyIcon /> {passkeyBusy ? "Enregistrement…" : "Ajouter une passkey"}
              </button>
            </section>

            <section className="account-card">
              <h2><HistoryIcon /> Chronologie de sécurité</h2>
              <div className="security-timeline">
                <div className="on">
                  <span><CheckCircleIcon /></span>
                  <div><b>Connexion actuelle validée</b><small>{dateFR(secu?.derniere_connexion, true)}</small></div>
                </div>
                <div className={secu?.mfa_actif ? "on" : ""}>
                  <span>{secu?.mfa_actif ? <CheckCircleIcon /> : <KeyIcon />}</span>
                  <div><b>{secu?.mfa_actif ? "Authenticator configuré" : "MFA non configurée"}</b><small>{secu?.mfa_actif ? "Chaque connexion exige un code TOTP." : "Activez-la depuis cette page."}</small></div>
                </div>
                <div>
                  <span><LockIcon /></span>
                  <div><b>Mot de passe</b><small>Dernière mise à jour : {dateFR(secu?.mot_de_passe_maj)}</small></div>
                </div>
                <div>
                  <span><VerifiedUserIcon /></span>
                  <div><b>Codes de secours</b><small>{secu?.codes_secours_restants ?? 0} code(s) à usage unique restant(s)</small></div>
                </div>
              </div>
            </section>

            {secu?.mfa_actif && (
              <section className="account-card">
                <h2><KeyIcon /> Codes de secours</h2>
                <p className="hint">Ils remplacent le code TOTP si votre téléphone est perdu. Chaque code ne fonctionne qu'une fois.</p>
                <div className="danger-zone" style={{ borderColor: "var(--line)", background: "#FBFCFE" }}>
                  <h3 style={{ color: "var(--ink)" }}><KeyIcon /> {secu?.codes_secours_restants ?? 0} code(s) restant(s)</h3>
                  <p style={{ color: "var(--muted)" }}>Régénérez-les uniquement si vous pensez qu'ils ont été exposés : les anciens seront invalidés.</p>
                  <button className="btn btn-outline" onClick={() => { setDisableForm({ password: "", code: "" }); setDisableModal(true); }}>
                    <RefreshIcon /> Régénérer
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={mfaModal}
        onClose={fermerMfa}
        title={mfaStep === "auth" ? "Protéger ce compte" : mfaStep === "qr" ? "Scannez le QR code" : "Codes de secours"}
        subtitle={
          mfaStep === "auth"
            ? "Confirmez votre identité avant de modifier l'authenticator."
            : mfaStep === "qr"
              ? "Ouvrez Google Authenticator, Microsoft Authenticator ou 1Password, puis saisissez le code affiché."
              : "Conservez ces codes hors ligne. Ils ne seront plus jamais affichés."
        }
        footer={
          mfaStep === "codes" ? (
            <>
              <button className="btn btn-outline" onClick={() => telechargerCodes(recoveryCodes, secu?.login)}><DownloadIcon /> Télécharger</button>
              <button className="btn btn-brand" onClick={fermerMfa}>J'ai terminé</button>
            </>
          ) : mfaStep === "auth" ? (
            <>
              <button className="btn btn-ghost" onClick={fermerMfa}>Annuler</button>
              <button className="btn btn-brand" onClick={demarrerRotation} disabled={envoi === "mfa"}>
                {envoi === "mfa" ? <><Spinner inline label="" /> Génération…</> : "Continuer"}
              </button>
            </>
          ) : (
            <button className="btn btn-ghost" onClick={fermerMfa}>Fermer</button>
          )
        }
      >
        {mfaStep === "auth" && (
          <form onSubmit={demarrerRotation}>
            <div className="field">
              <label>Mot de passe actuel</label>
              <input type="password" value={mfaForm.password} onChange={(e) => setMfaForm({ ...mfaForm, password: e.target.value })} required autoComplete="current-password" autoFocus />
            </div>
            {secu?.mfa_actif && (
              <div className="field">
                <label>Code TOTP actuel</label>
                <input inputMode="numeric" maxLength={6} value={mfaForm.code} onChange={(e) => setMfaForm({ ...mfaForm, code: e.target.value.replace(/\D/g, "") })} required placeholder="123456" />
                <small>Requis pour remplacer un authenticator déjà actif.</small>
              </div>
            )}
            <div className="form-note"><ShieldIcon /> La rotation invalidera l'ancien secret et générera de nouveaux codes de secours.</div>
          </form>
        )}

        {mfaStep === "qr" && (
          <div>
            <div className="mfa-setup">
              <div className="qr-frame">
                <img src={`/api/auth/mfa/qr?t=${Date.now()}`} alt="QR code d'enrôlement TOTP" />
                <span>MboaPilot · {secu?.login}</span>
              </div>
              <div className="mfa-setup-info">
                <b>Impossible de scanner ?</b>
                <div className="secret-line">
                  <code>{mfaSecret}</code>
                  <CopyButton value={mfaSecret} label="" />
                </div>
                <p>La clé est à usage unique. Ne la partagez jamais. Si votre application demande un compte, choisissez « MboaPilot ».</p>
              </div>
            </div>
            <form onSubmit={confirmerMfa}>
              <div className="field">
                <label>Code à 6 chiffres affiché par l'application</label>
                <input className="mfa-code" inputMode="numeric" maxLength={6} value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))} required placeholder="000000" autoFocus />
              </div>
              <button className="btn btn-brand btn-block" disabled={envoi === "mfa-confirm" || mfaCode.length !== 6}>
                {envoi === "mfa-confirm" ? <><Spinner inline label="" /> Vérification…</> : <><CheckCircleIcon /> Vérifier et activer</>}
              </button>
            </form>
          </div>
        )}

        {mfaStep === "codes" && (
          <div>
            <div className="alert" style={{ background: "#FFF8E8", border: "1px solid #F3E0B0", color: "#6E4A00", borderRadius: 8, padding: "10px 12px" }}>
              <WarningAmberIcon /> Ces 10 codes remplacent chacun un code TOTP. Ils ne seront plus affichés.
            </div>
            <div className="recovery-grid" style={{ marginTop: 14 }}>
              {recoveryCodes.map((c) => <code key={c}>{c}</code>)}
            </div>
            <div className="recovery-actions">
              <button className="btn btn-outline" onClick={() => navigator.clipboard?.writeText(recoveryCodes.join("\n"))}><ContentCopyIcon /> Copier tout</button>
              <button className="btn btn-outline" onClick={() => telechargerCodes(recoveryCodes, secu?.login)}><DownloadIcon /> Télécharger le fichier</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={disableModal}
        onClose={() => setDisableModal(false)}
        title="Opération sensible"
        subtitle="Confirmez avec votre mot de passe et un code TOTP. Ces actions sont journalisées."
      >
        <div className="row-actions" style={{ marginBottom: 14 }}>
          <Badge tone="amber">Régénérer les codes</Badge>
          <span className="faint" style={{ fontSize: 11 }}>ou</span>
          <Badge tone="red">Désactiver la MFA</Badge>
        </div>
        <form>
          <div className="field">
            <label>Mot de passe</label>
            <input type="password" value={disableForm.password} onChange={(e) => setDisableForm({ ...disableForm, password: e.target.value })} required autoComplete="current-password" />
          </div>
          {secu?.mfa_actif && (
            <div className="field">
              <label>Code TOTP actuel</label>
              <input inputMode="numeric" maxLength={6} value={disableForm.code} onChange={(e) => setDisableForm({ ...disableForm, code: e.target.value.replace(/\D/g, "") })} required placeholder="123456" />
            </div>
          )}
          <div className="row-actions">
            <button className="btn btn-outline" onClick={regenererCodes} disabled={envoi === "codes"}>
              {envoi === "codes" ? <><Spinner inline label="" /> Génération…</> : <><KeyIcon /> Régénérer les codes</>}
            </button>
            <button className="btn btn-danger" onClick={desactiverMfa} disabled={envoi === "desactiver"}>
              {envoi === "desactiver" ? <><Spinner inline label="" /> Désactivation…</> : <><WarningAmberIcon /> Désactiver définitivement</>}
            </button>
          </div>
          <p className="form-note"><ShieldIcon /> En production, la MFA des administrateurs ne peut pas être désactivée.</p>
        </form>
      </Modal>

      <Modal open={codesModal} onClose={() => setCodesModal(false)} title="Nouveaux codes de secours" subtitle="Ils remplacent tous les codes précédents.">
        <div className="recovery-grid">
          {recoveryCodes.map((c) => <code key={c}>{c}</code>)}
        </div>
        <div className="recovery-actions">
          <button className="btn btn-outline" onClick={() => navigator.clipboard?.writeText(recoveryCodes.join("\n"))}><ContentCopyIcon /> Copier tout</button>
          <button className="btn btn-brand" onClick={() => telechargerCodes(recoveryCodes, secu?.login)}><DownloadIcon /> Télécharger</button>
        </div>
      </Modal>

      <Toast message={toast?.message} tone={toast?.tone} onClose={() => setToast(null)} />
    </>
  );
}
