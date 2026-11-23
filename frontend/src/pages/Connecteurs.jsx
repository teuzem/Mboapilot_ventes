import { useCallback, useEffect, useState } from "react";
import CloudSyncIcon from "@mui/icons-material/CloudSync";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import VisibilityIcon from "@mui/icons-material/Visibility";
import TableChartIcon from "@mui/icons-material/TableChart";
import { api } from "../api";
import { Badge, PageHead, Toast } from "../components";

const TYPES = [
  { value: "rest", label: "API REST / OAuth2" },
  { value: "csv_url", label: "CSV distant" },
  { value: "sftp", label: "SFTP chiffré" },
  { value: "dossier", label: "Dossier de fichiers" },
  { value: "excel", label: "Excel" },
  { value: "pdf", label: "PDF" },
];

const ETAPES = [
  { value: "selectColumns", label: "Choisir des colonnes" },
  { value: "renameColumns", label: "Renommer des colonnes" },
  { value: "filterRows", label: "Filtrer des lignes" },
  { value: "addColumn", label: "Ajouter une colonne calculée" },
  { value: "changeType", label: "Changer le type" },
  { value: "removeRows", label: "Supprimer des lignes" },
  { value: "mapToSales", label: "Mapper vers les ventes" },
];

const VIDE = {
  nom: "", type: "rest",
  configuration: { url: "", method: "GET", chemin_donnees: "", separateur: ";", auth: { mode: "aucun" } },
  etapes: [],
};

export default function Connecteurs() {
  const [liste, setListe] = useState([]);
  const [form, setForm] = useState(VIDE);
  const [apercu, setApercu] = useState(null);
  const [resultat, setResultat] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState("");

  const charger = useCallback(async () => {
    try {
      const r = await api.get("/api/connecteurs");
      setListe(r.connecteurs || []);
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const cfg = (k, v) => setForm((f) => ({ ...f, configuration: { ...f.configuration, [k]: v } }));
  const auth = (k, v) => setForm((f) => ({
    ...f, configuration: { ...f.configuration, auth: { ...(f.configuration.auth || {}), [k]: v } },
  }));

  const ajouterEtape = () => setForm((f) => ({
    ...f, etapes: [...(f.etapes || []), { action: "selectColumns", colonnes: [] }],
  }));
  const modifierEtape = (i, patch) => setForm((f) => ({
    ...f, etapes: f.etapes.map((e, j) => (i === j ? { ...e, ...patch } : e)),
  }));
  const retirerEtape = (i) => setForm((f) => ({
    ...f, etapes: f.etapes.filter((_, j) => j !== i),
  }));

  const enregistrer = async (e) => {
    e.preventDefault();
    setBusy("save");
    try {
      await api.post("/api/connecteurs", {
        ...form,
        configuration: { ...form.configuration, etapes: form.etapes },
      });
      setToast({ message: "Connecteur enregistré.", tone: "success" });
      setForm(VIDE);
      charger();
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setBusy("");
  };

  const tester = async () => {
    setBusy("test");
    try {
      const r = await api.post("/api/connecteurs/tester", {
        configuration: { ...form.configuration, etapes: form.etapes },
      });
      setApercu(r);
      if (!r.ok) setToast({ message: r.message, tone: "error" });
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setBusy("");
  };

  const synchroniser = async (id) => {
    setBusy("sync" + id);
    try {
      const r = await api.post("/api/connecteurs/" + id + "/sync", {});
      setResultat(r);
      setToast({ message: r.message || (r.lignes + " lignes importées."), tone: r.ok ? "success" : "error" });
      charger();
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setBusy("");
  };

  return (
    <div className="page">
      <PageHead
        eyebrow="Collecte avancée"
        title="Connecteurs & transformations"
        subtitle="Reliez vos sources et transformez les données avant intégration, étape par étape."
      />
      <Toast toast={toast} />

      <div className="studio-grid">
        <section className="studio-panel">
          <h2><CloudSyncIcon /> Sources configurées</h2>
          {liste.length === 0 && <p className="hint">Aucun connecteur. Créez-en un à droite.</p>}
          <div className="connector-list">
            {liste.map((c) => (
              <div className="connector-row" key={c.id}>
                <div>
                  <b>{c.nom}</b>
                  <span>{TYPES.find((t) => t.value === c.type)?.label || c.type}</span>
                  <small>Dernier statut : {c.dernier_statut || "jamais exécuté"}</small>
                </div>
                <Badge tone={c.actif ? "green" : "grey"}>{c.actif ? "Actif" : "Inactif"}</Badge>
                <button className="btn btn-brand" onClick={() => synchroniser(c.id)} disabled={Boolean(busy)}>
                  <PlayArrowIcon /> {busy === "sync" + c.id ? "…" : "Synchroniser"}
                </button>
              </div>
            ))}
          </div>

          {resultat && (
            <div className="resultat">
              <b>{resultat.ok ? "Synchronisation terminée" : "Échec"}</b>
              <span>{resultat.lignes || 0} lignes intégrées, {resultat.rejets || 0} rejets</span>
              {resultat.erreurs?.length > 0 && <ul>{resultat.erreurs.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            </div>
          )}
        </section>

        <section className="studio-panel">
          <h2><AddIcon /> Nouveau connecteur</h2>
          <form onSubmit={enregistrer} className="connector-form">
            <label>Nom<input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} required /></label>
            <label>Type
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            {form.type === "rest" && (
              <>
                <label>URL<input value={form.configuration.url || ""} onChange={(e) => cfg("url", e.target.value)} placeholder="https://api.exemple.cm/ventes" /></label>
                <label>Chemin des données<input value={form.configuration.chemin_donnees || ""} onChange={(e) => cfg("chemin_donnees", e.target.value)} placeholder="data.commandes" /></label>
                <label>Authentification
                  <select value={form.configuration.auth?.mode || "aucun"} onChange={(e) => auth("mode", e.target.value)}>
                    <option value="aucun">Aucune</option>
                    <option value="api_key">Clé API</option>
                    <option value="bearer">Jeton Bearer</option>
                    <option value="basic">Basic</option>
                    <option value="oauth2">OAuth2 client credentials</option>
                  </select>
                </label>
                {form.configuration.auth?.mode === "oauth2" && (
                  <>
                    <label>URL du jeton<input value={form.configuration.auth.token_url || ""} onChange={(e) => auth("token_url", e.target.value)} /></label>
                    <label>Client ID<input value={form.configuration.auth.client_id || ""} onChange={(e) => auth("client_id", e.target.value)} /></label>
                    <label>Client secret<input type="password" value={form.configuration.auth.client_secret || ""} onChange={(e) => auth("client_secret", e.target.value)} /></label>
                  </>
                )}
              </>
            )}
            {(form.type === "dossier" || form.type === "excel" || form.type === "pdf") && (
              <label>Chemin du dossier<input value={form.configuration.chemin || ""} onChange={(e) => cfg("chemin", e.target.value)} placeholder="uploads/ventes" /></label>
            )}
            {form.type === "sftp" && (
              <>
                <label>Hôte<input value={form.configuration.hote || ""} onChange={(e) => cfg("hote", e.target.value)} /></label>
                <label>Utilisateur<input value={form.configuration.utilisateur || ""} onChange={(e) => cfg("utilisateur", e.target.value)} /></label>
                <label>Mot de passe<input type="password" value={form.configuration.mot_de_passe || ""} onChange={(e) => cfg("mot_de_passe", e.target.value)} /></label>
                <label>Chemin distant<input value={form.configuration.chemin || ""} onChange={(e) => cfg("chemin", e.target.value)} /></label>
              </>
            )}

            <div className="etapes-head">
              <h3><TableChartIcon /> Étapes de transformation</h3>
              <button type="button" className="btn btn-ghost" onClick={ajouterEtape}><AddIcon /> Ajouter</button>
            </div>
            {form.etapes.map((etape, i) => (
              <div className="etape-row" key={i}>
                <select value={etape.action} onChange={(e) => modifierEtape(i, { action: e.target.value })}>
                  {ETAPES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                </select>
                {etape.action === "selectColumns" && (
                  <input placeholder="col1, col2" value={(etape.colonnes || []).join(", ")}
                    onChange={(e) => modifierEtape(i, { colonnes: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
                )}
                {etape.action === "renameColumns" && (
                  <input placeholder="ancien:nouveau, autre:autre2" value={JSON.stringify(etape.renommages || {})}
                    onChange={(e) => { try { modifierEtape(i, { renommages: JSON.parse(e.target.value) }); } catch (err) { /* saisie en cours */ } }} />
                )}
                {etape.action === "filterRows" && (
                  <>
                    <input placeholder="colonne" value={etape.colonne || ""} onChange={(e) => modifierEtape(i, { colonne: e.target.value })} />
                    <input placeholder="valeur" value={etape.valeur || ""} onChange={(e) => modifierEtape(i, { valeur: e.target.value })} />
                  </>
                )}
                {etape.action === "addColumn" && (
                  <>
                    <input placeholder="nom" value={etape.nom || ""} onChange={(e) => modifierEtape(i, { nom: e.target.value })} />
                    <input placeholder="expression" value={etape.expression || ""} onChange={(e) => modifierEtape(i, { expression: e.target.value })} />
                  </>
                )}
                {etape.action === "changeType" && (
                  <>
                    <input placeholder="colonne" value={etape.colonne || ""} onChange={(e) => modifierEtape(i, { colonne: e.target.value })} />
                    <select value={etape.type || "texte"} onChange={(e) => modifierEtape(i, { type: e.target.value })}>
                      <option value="texte">Texte</option><option value="nombre">Nombre</option><option value="date">Date</option>
                    </select>
                  </>
                )}
                {etape.action === "mapToSales" && (
                  <input placeholder="jour:date, region:region, qte:quantite" value={JSON.stringify(etape.mapping || {})}
                    onChange={(e) => { try { modifierEtape(i, { mapping: JSON.parse(e.target.value) }); } catch (err) { /* saisie en cours */ } }} />
                )}
                <button type="button" className="icon-btn" onClick={() => retirerEtape(i)} aria-label="Retirer l'étape"><DeleteIcon /></button>
              </div>
            ))}

            <div className="form-actions">
              <button className="btn btn-outline" type="button" onClick={tester} disabled={Boolean(busy)}><VisibilityIcon /> Tester</button>
              <button className="btn btn-brand" type="submit" disabled={Boolean(busy)}>Enregistrer</button>
            </div>
          </form>

          {apercu && apercu.ok && (
            <div className="apercu">
              <b>{apercu.lignes} lignes lues · {apercu.colonnes?.length || 0} colonnes</b>
              <div className="table-scroll">
                <table>
                  <thead><tr>{apercu.colonnes?.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>
                    {apercu.apercu?.slice(0, 8).map((r, i) => (
                      <tr key={i}>{apercu.colonnes?.map((c) => <td key={c}>{String(r[c] ?? "").slice(0, 40)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
