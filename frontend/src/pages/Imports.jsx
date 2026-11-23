import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import DescriptionIcon from "@mui/icons-material/Description";
import DownloadIcon from "@mui/icons-material/Download";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import VisibilityIcon from "@mui/icons-material/Visibility";
import BlockIcon from "@mui/icons-material/Block";
import HistoryIcon from "@mui/icons-material/History";
import TuneIcon from "@mui/icons-material/Tune";
import ListAltIcon from "@mui/icons-material/ListAlt";
import DynamicFormIcon from "@mui/icons-material/DynamicForm";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ShieldIcon from "@mui/icons-material/Shield";
import { api, dateFR, fmt } from "../api";
import { useAuth } from "../auth";
import { Badge, Empty, Modal, PageHead, Spinner, Toast } from "../components";

const REGIONS = ["Centre", "Littoral", "Ouest", "Nord-Ouest", "Sud-Ouest", "Sud", "Est", "Adamaoua", "Nord", "Extreme-Nord"];
const CANAUX = ["POS", "Agence", "E-commerce"];
const FAMILLES = ["Alimentaire", "Agricole", "Boissons", "Textile", "Cosmetique", "Equipement"];
const DEVISES = ["FCFA", "XAF", "XOF"];

const CHAMPS = {
  ref: { label: "Référence", type: "text", requis: false },
  jour: { label: "Date de la vente", type: "date", requis: true },
  canal: { label: "Canal", type: "select", requis: true, options: CANAUX },
  region: { label: "Région", type: "select", requis: true, options: REGIONS },
  ville: { label: "Ville", type: "text", requis: false },
  point_vente: { label: "Point de vente", type: "text", requis: false },
  vendeur: { label: "Vendeur", type: "text", requis: false },
  produit: { label: "Produit", type: "text", requis: true },
  famille: { label: "Famille", type: "select", requis: true, options: FAMILLES },
  qte: { label: "Quantité", type: "number", requis: true },
  prix_unit: { label: "Prix unitaire (FCFA)", type: "number", requis: true },
  remise_pct: { label: "Remise (%)", type: "number", requis: false },
  montant: { label: "Montant TTC (FCFA)", type: "number", requis: false },
  cout_unit: { label: "Coût unitaire (FCFA)", type: "number", requis: false },
  devise: { label: "Devise", type: "select", requis: false, options: DEVISES },
};
const ORDRE = Object.keys(CHAMPS);
const TYPES = [["text", "Texte"], ["number", "Nombre"], ["date", "Date"], ["select", "Liste"], ["textarea", "Texte long"]];

const STATUT_TONE = {
  Reussi: "green", Partiel: "amber", Echec: "red", Annule: "gray", "En cours": "brand",
};
const PREVIEW_TONE = { integre: "green", mise_a_jour: "brand", doublon: "amber", rejete: "red" };
const PREVIEW_LABEL = { integre: "Intégrée", mise_a_jour: "Mise à jour", doublon: "Doublon", rejete: "Rejetée" };

function uid() { return Math.random().toString(36).slice(2, 9); }

function champVide(cle = "") {
  const meta = CHAMPS[cle] || { label: "", type: "text", requis: false, options: [] };
  return {
    _id: uid(), cle, label: meta.label, type: meta.type, requis: Boolean(meta.requis),
    options: meta.options ? [...meta.options] : [], defaut: "", aide: "",
  };
}

function donneesInitiales(form) {
  const ligne = {};
  (form?.champs || []).forEach((c) => {
    let v = c.defaut ?? "";
    if (!v && c.cle === "jour") v = new Date().toISOString().slice(0, 10);
    if (!v && c.type === "select" && c.options?.length) v = c.options[0];
    ligne[c.cle] = v;
  });
  return ligne;
}

export default function Imports() {
  const { can } = useAuth();
  const [onglet, setOnglet] = useState("importer");
  const [importsData, setImportsData] = useState(null);
  const [forms, setForms] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [toast, setToast] = useState(null);
  const [envoi, setEnvoi] = useState("");

  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [mode, setMode] = useState("ignorer");
  const [analysis, setAnalysis] = useState(null);
  const [mapping, setMapping] = useState({});
  const [resultat, setResultat] = useState(null);
  const inputFichier = useRef(null);

  const [q, setQ] = useState("");
  const [statutFiltre, setStatutFiltre] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const [editeur, setEditeur] = useState(null);
  const [soumission, setSoumission] = useState(null);
  const [soumissionResultat, setSoumissionResultat] = useState(null);

  const message = (txt, tone = "success") => setToast({ message: txt, tone });

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const [i, f] = await Promise.allSettled([api.get("/api/imports"), api.get("/api/forms")]);
      if (i.status === "fulfilled") setImportsData(i.value);
      if (f.status === "fulfilled") setForms(f.value.formulaires || []);
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const analyser = async (fichier = file, map = mapping, modeChoisi = mode) => {
    if (!fichier) return;
    setEnvoi("analyse");
    try {
      const fd = new FormData();
      fd.append("fichier", fichier);
      fd.append("mode", modeChoisi);
      if (map && Object.values(map).some(Boolean)) fd.append("mapping", JSON.stringify(map));
      if (analysis?.meta?.feuille) fd.append("feuille", analysis.meta.feuille);
      const r = await api.upload("/api/imports/analyser", fd);
      setAnalysis(r);
      if (!map || !Object.values(map).some(Boolean)) setMapping(r.mapping || {});
      if (r.resume?.recues === 0) message("Le fichier ne contient aucune ligne exploitable.", "warn");
    } catch (ex) {
      message(ex.message, "error");
    }
    setEnvoi("");
  };

  const choisirFichier = (f) => {
    if (!f) return;
    if (!/\.(csv|xlsx|xls)$/i.test(f.name)) return message("Format attendu : .csv, .xlsx ou .xls.", "error");
    if (f.size > 24 * 1024 * 1024) return message("Fichier limité à 24 Mo.", "error");
    setFile(f);
    setAnalysis(null);
    setResultat(null);
    setMapping({});
    analyser(f, {}, mode);
  };

  const changerMapping = (cle, valeur) => setMapping((m) => ({ ...m, [cle]: valeur }));

  const changerMode = (m) => {
    setMode(m);
    if (file && analysis) analyser(file, mapping, m);
  };

  const executer = async () => {
    if (!file) return;
    setEnvoi("import");
    try {
      const fd = new FormData();
      fd.append("fichier", file);
      fd.append("mapping", JSON.stringify(mapping));
      fd.append("mode", mode);
      if (analysis?.meta?.feuille) fd.append("feuille", analysis.meta.feuille);
      const r = await api.upload("/api/imports/executer", fd);
      setResultat(r);
      message(r.message);
      await charger();
    } catch (ex) {
      message(ex.message, "error");
    }
    setEnvoi("");
  };

  const recommencer = () => {
    setFile(null);
    setAnalysis(null);
    setMapping({});
    setResultat(null);
    if (inputFichier.current) inputFichier.current.value = "";
  };

  const telechargerModele = async (format) => {
    try {
      const nom = await api.download(`/api/imports/modele?format=${format}`, `mboapilot-modele.${format === "xlsx" ? "xlsx" : "csv"}`);
      message(`Modèle téléchargé : ${nom}`);
    } catch (ex) {
      message(ex.message, "error");
    }
  };

  const ouvrirDetail = async (id) => {
    setDetail({ loading: true, data: null });
    setDetailBusy(true);
    try {
      const r = await api.get(`/api/imports/${id}`);
      setDetail({ loading: false, data: r });
    } catch (ex) {
      message(ex.message, "error");
      setDetail(null);
    }
    setDetailBusy(false);
  };

  const annuler = async (imp) => {
    if (!window.confirm(`Annuler l'import #${imp.id} ? Les lignes créées par cet import seront supprimées.`)) return;
    setEnvoi("annuler");
    try {
      const r = await api.post(`/api/imports/${imp.id}/annuler`);
      message(r.message);
      setDetail(null);
      await charger();
    } catch (ex) {
      message(ex.message, "error");
    }
    setEnvoi("");
  };

  const ouvrirEditeur = (f = null) => {
    if (f) {
      setEditeur({
        id: f.id, nom: f.nom, description: f.description || "",
        champs: (f.champs || []).map((c) => ({ ...c, _id: uid(), options: c.options || [] })),
      });
    } else {
      const defauts = ["jour", "canal", "region", "produit", "famille", "qte", "prix_unit"];
      setEditeur({ id: null, nom: "", description: "", champs: defauts.map(champVide) });
    }
  };

  const majChamp = (id, patch) => setEditeur((e) => ({ ...e, champs: e.champs.map((c) => c._id === id ? { ...c, ...patch } : c) }));

  const choisirCle = (id, cle) => {
    const meta = CHAMPS[cle];
    majChamp(id, {
      cle, label: meta?.label || "", type: meta?.type || "text",
      requis: Boolean(meta?.requis), options: meta?.options ? [...meta.options] : [],
    });
  };

  const ajouterChamp = () => {
    const utilisees = new Set((editeur?.champs || []).map((c) => c.cle));
    const libre = ORDRE.find((c) => !utilisees.has(c));
    if (!libre) return message("Tous les champs métier sont déjà présents.", "warn");
    setEditeur((e) => ({ ...e, champs: [...e.champs, champVide(libre)] }));
  };

  const supprimerChamp = (id) => setEditeur((e) => ({ ...e, champs: e.champs.filter((c) => c._id !== id) }));

  const enregistrerFormulaire = async (e) => {
    e.preventDefault();
    setEnvoi("form");
    try {
      const payload = {
        id: editeur.id || undefined,
        nom: editeur.nom,
        description: editeur.description,
        champs: editeur.champs.map(({ _id, options, ...c }) => ({
          ...c, options: c.type === "select" ? (options || []).filter(Boolean) : [],
        })),
      };
      const r = await api.post("/api/forms", payload);
      message(r.message);
      setEditeur(null);
      await charger();
    } catch (ex) {
      message(ex.message, "error");
    }
    setEnvoi("");
  };

  const supprimerFormulaire = async (f) => {
    if (!window.confirm(`Supprimer le formulaire « ${f.nom} » ? Les imports déjà créés sont conservés.`)) return;
    try {
      const r = await api.del(`/api/forms/${f.id}`);
      message(r.message);
      await charger();
    } catch (ex) {
      message(ex.message, "error");
    }
  };

  const ouvrirSoumission = (f) => {
    setSoumission({ form: f, lignes: [donneesInitiales(f)] });
    setSoumissionResultat(null);
  };

  const majLigne = (i, cle, valeur) => setSoumission((s) => {
    const lignes = s.lignes.map((l, j) => j === i ? { ...l, [cle]: valeur } : l);
    return { ...s, lignes };
  });

  const ajouterLigne = () => setSoumission((s) => ({ ...s, lignes: [...s.lignes, donneesInitiales(s.form)] }));
  const retirerLigne = (i) => setSoumission((s) => ({ ...s, lignes: s.lignes.filter((_, j) => j !== i) }));

  const soumettreFormulaire = async (e) => {
    e.preventDefault();
    setEnvoi("soumettre");
    try {
      const r = await api.post(`/api/forms/${soumission.form.id}/soumettre`, { lignes: soumission.lignes });
      setSoumissionResultat(r);
      message(r.message);
      await charger();
    } catch (ex) {
      message(ex.message, "error");
    }
    setEnvoi("");
  };

  const listeImports = useMemo(() => {
    const base = importsData?.imports || [];
    const texte = q.trim().toLowerCase();
    return base.filter((i) => {
      if (statutFiltre === "annule" ? !i.annule : statutFiltre && i.statut !== statutFiltre) return false;
      if (!texte) return true;
      return [i.nom_fichier, i.source, i.user_login, i.statut, String(i.id)]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(texte));
    });
  }, [importsData, q, statutFiltre]);

  const stats = importsData?.stats || {};

  return (
    <>
      <PageHead
        eyebrow="Collecte & qualité"
        title="Studio d'import"
        sub="CSV, Excel, formulaires dynamiques : analysez, mappez, contrôlez puis intégrez. Chaque lot est réversible et journalisé."
        actions={
          <>
            <button className="btn btn-outline" onClick={() => telechargerModele("csv")}><DownloadIcon /> Modèle CSV</button>
            <button className="btn btn-outline" onClick={() => telechargerModele("xlsx")}><DownloadIcon /> Modèle Excel</button>
            <button className="btn btn-ghost" onClick={charger} disabled={chargement}><RefreshIcon /> Actualiser</button>
          </>
        }
      />

      <div className="imports-page">
        <div className="imports-stats">
          <div className="import-stat">
            <small>Lots d'import</small>
            <b>{stats.total ?? "-"}</b>
            <span>sur votre périmètre</span>
          </div>
          <div className="import-stat good">
            <small>Lignes intégrées</small>
            <b>{fmt(stats.lignes_integrees)}</b>
            <span>ventes créées ou mises à jour</span>
          </div>
          <div className="import-stat bad">
            <small>Rejets cumulés</small>
            <b>{fmt(stats.rejets)}</b>
            <span>lignes à corriger dans les fichiers</span>
          </div>
          <div className="import-stat">
            <small>Taux de réussite</small>
            <b>{stats.taux_reussite ?? "-"} <em style={{ fontSize: 13, fontStyle: "normal", color: "var(--faint)" }}>%</em></b>
            <span>rapport lignes valides / reçues</span>
          </div>
        </div>

        <div className="imports-tabs" role="tablist" aria-label="Sections du studio d'import">
          <button className={onglet === "importer" ? "on" : ""} onClick={() => setOnglet("importer")} role="tab" aria-selected={onglet === "importer"}>
            <CloudUploadIcon /> Importer un fichier
          </button>
          {can("forms.read") && (
            <button className={onglet === "formulaires" ? "on" : ""} onClick={() => setOnglet("formulaires")} role="tab" aria-selected={onglet === "formulaires"}>
              <DynamicFormIcon /> Formulaires dynamiques
            </button>
          )}
          <button className={onglet === "historique" ? "on" : ""} onClick={() => setOnglet("historique")} role="tab" aria-selected={onglet === "historique"}>
            <HistoryIcon /> Historique
          </button>
        </div>

        {onglet === "importer" && (
          <div className="studio">
            <div className="studio-main">
              <div className="studio-steps" aria-label="Étapes de l'import">
                <div className={"studio-step" + (file ? (analysis ? " done" : " on") : " on")}><span>1</span> Dépôt</div>
                <div className={"studio-step" + (analysis ? (resultat ? " done" : " on") : "")}><span>2</span> Mapping</div>
                <div className={"studio-step" + (analysis?.resume ? (resultat ? " done" : " on") : "")}><span>3</span> Contrôle</div>
                <div className={"studio-step" + (resultat ? " on" : "")}><span>4</span> Exécution</div>
              </div>

              <section className="studio-card">
                <h2><CloudUploadIcon /> Déposez votre fichier</h2>
                <p className="hint">
                  CSV (point-virgule, virgule, tabulation), Excel .xlsx ou .xls. La première ligne doit contenir les en-têtes.
                  Les doublons sont détectés par référence unique.
                </p>
                {!file ? (
                  <label
                    className={"dropzone" + (drag ? " drag" : "")}
                    onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => { e.preventDefault(); setDrag(false); choisirFichier(e.dataTransfer.files?.[0]); }}
                  >
                    <CloudUploadIcon />
                    <b>Glissez-déposez votre fichier ici</b>
                    <span>ou cliquez pour parcourir · 24 Mo maximum</span>
                    <span className="accepted"><i>.CSV</i><i>.XLSX</i><i>.XLS</i><i>UTF-8 / CP1252</i></span>
                    <input ref={inputFichier} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => choisirFichier(e.target.files?.[0])} />
                  </label>
                ) : (
                  <>
                    <div className="file-pill">
                      <InsertDriveFileIcon />
                      <div><b>{file.name}</b><span>{(file.size / 1024).toFixed(1)} Ko · {mode === "mettre_a_jour" ? "mise à jour des doublons" : "doublons ignorés"}</span></div>
                      <button className="btn btn-ghost btn-sm" onClick={recommencer}>Changer</button>
                      <input ref={inputFichier} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => choisirFichier(e.target.files?.[0])} />
                    </div>
                    {analysis?.meta && (
                      <div className="analyze-meta">
                        <span>Type <b>{analysis.meta.type}</b></span>
                        <span>Lignes <b>{fmt(analysis.meta.lignes)}</b></span>
                        {analysis.meta.feuille && <span>Feuille <b>{analysis.meta.feuille}</b></span>}
                        {analysis.meta.delimiter && <span>Délimiteur <b>{analysis.meta.delimiter === "\t" ? "tabulation" : analysis.meta.delimiter}</b></span>}
                        {analysis.meta.encoding && <span>Encodage <b>{analysis.meta.encoding}</b></span>}
                        <span>Empreinte <b className="mono">{analysis.meta.hash}</b></span>
                        {analysis.duree_ms !== undefined && <span>Analyse <b>{analysis.duree_ms} ms</b></span>}
                      </div>
                    )}
                  </>
                )}
              </section>

              {analysis && (
                <section className="studio-card">
                  <div className="dash-panel-head">
                    <div>
                      <h2><TuneIcon /> Contrôle avant intégration</h2>
                      <p className="hint">Vérifiez le mapping, les volumes et les motifs de rejet. Rien n'est écrit en base avant l'exécution.</p>
                    </div>
                    <div className="row-actions">
                      <button className="btn btn-outline btn-sm" onClick={() => analyser()} disabled={envoi === "analyse"}>
                        <RefreshIcon /> Recalculer
                      </button>
                    </div>
                  </div>

                  <div className="analysis-summary">
                    <div className="mini-stat"><small>Lignes reçues</small><b>{fmt(analysis.resume?.recues)}</b><span>dans le fichier</span></div>
                    <div className="mini-stat ok"><small>Intégrables</small><b>{fmt(analysis.resume?.integrables)}</b><span>prêtes à écrire</span></div>
                    <div className="mini-stat warn"><small>Doublons / MAJ</small><b>{fmt((analysis.resume?.doublons || 0) + (analysis.resume?.mises_a_jour || 0))}</b><span>{mode === "mettre_a_jour" ? "mises à jour" : "ignorés"}</span></div>
                    <div className="mini-stat bad"><small>Rejets</small><b>{fmt(analysis.resume?.rejets)}</b><span>à corriger</span></div>
                  </div>

                  <div className="mapping-grid">
                    <div className="mapping-head"><span>Champ MboaPilot</span><span /><span>Colonne du fichier</span></div>
                    {ORDRE.map((cle) => (
                      <div className="mapping-row" key={cle}>
                        <span>{CHAMPS[cle].label}{CHAMPS[cle].requis && <b className="req">*</b>}</span>
                        <span className="faint" style={{ textAlign: "center" }}>→</span>
                        <select value={mapping[cle] || ""} onChange={(e) => changerMapping(cle, e.target.value)} aria-label={`Mapper ${CHAMPS[cle].label}`}>
                          <option value="">- Ignorer ce champ -</option>
                          {(analysis.headers || []).map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>

                  {analysis.preview?.length > 0 && (
                    <>
                      <h3 style={{ fontSize: 13, margin: "16px 0 7px" }}>Aperçu des 12 premières lignes</h3>
                      <div className="preview-scroll">
                        <table className="preview-table">
                          <thead><tr><th>Ligne</th><th>Statut</th><th>Référence</th><th>Produit</th><th>Région</th><th>Date</th><th className="num">Montant</th><th>Motif</th></tr></thead>
                          <tbody>
                            {analysis.preview.map((l, i) => (
                              <tr key={i}>
                                <td>{l.ligne}</td>
                                <td><Badge tone={PREVIEW_TONE[l.statut] || "gray"}>{PREVIEW_LABEL[l.statut] || l.statut}</Badge></td>
                                <td className="mono">{l.ref || "-"}</td>
                                <td>{l.produit || "-"}</td>
                                <td>{l.region || "-"}</td>
                                <td>{l.jour ? dateFR(l.jour) : "-"}</td>
                                <td className="num">{l.montant ? fmt(l.montant) : "-"}</td>
                                <td>{l.motif || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {analysis.erreurs?.length > 0 && (
                    <>
                      <h3 style={{ fontSize: 13, margin: "14px 0 4px" }}>Rejets à corriger <span className="faint">({analysis.erreurs.length})</span></h3>
                      <div className="rejets">
                        {analysis.erreurs.map((e) => (
                          <div className="rejet-row" key={e.ligne}><b>Ligne {e.ligne}</b><span>{e.motif}</span></div>
                        ))}
                      </div>
                    </>
                  )}

                  <div className="row-between" style={{ marginTop: 16 }}>
                    <div className="row-actions">
                      <button className="btn btn-brand" onClick={executer} disabled={!can("imports.write") || envoi === "import" || (analysis.resume?.integrables === 0 && analysis.resume?.mises_a_jour === 0)}>
                        {envoi === "import" ? <><Spinner inline label="" /> Intégration…</> : <><CheckCircleIcon /> Lancer l'intégration</>}
                      </button>
                      <button className="btn btn-ghost" onClick={recommencer}>Annuler</button>
                    </div>
                    <span className="import-legend">
                      <b>Mode :</b> les lignes valides sont écrites, les rejets sont conservés dans le journal.
                    </span>
                  </div>
                </section>
              )}

              {resultat && (
                <section className="import-result">
                  <b><CheckCircleIcon style={{ fontSize: 17, verticalAlign: "-3px", marginRight: 5 }} /> Import #{resultat.import_id} · {resultat.statut}</b>
                  {resultat.message}
                  <div className="row-actions">
                    <button className="btn btn-outline btn-sm" onClick={() => ouvrirDetail(resultat.import_id)}><VisibilityIcon /> Voir le lot</button>
                    <button className="btn btn-ghost btn-sm" onClick={recommencer}><AddIcon /> Nouvel import</button>
                  </div>
                </section>
              )}
            </div>

            <aside className="studio-side">
              <div className="studio-card">
                <h2><ShieldIcon /> Contrôles automatiques</h2>
                <p className="hint">Le serveur vérifie chaque ligne avant toute écriture.</p>
                <div className="stack" style={{ gap: 9 }}>
                  {[
                    ["Format & encodage", "CSV, Excel 97-2003 et .xlsx, UTF-8 ou CP1252."],
                    ["Cohérence métier", "Date, devise, région, famille, canal et quantités validés."],
                    ["Montants", "Quantité × prix − remise, tolérance de 2 % sur le montant déclaré."],
                    ["Déduplication", "Référence unique : doublon ignoré ou mis à jour selon le mode."],
                    ["Traçabilité", "Empreinte SHA-256 du fichier, mapping et rejets conservés."],
                  ].map(([t, d]) => (
                    <div className="studio-note" key={t}><CheckCircleIcon /><span><b>{t}.</b> {d}</span></div>
                  ))}
                </div>
              </div>

              <div className="studio-card">
                <h2><ListAltIcon /> Mode d'intégration</h2>
                <div className="field" style={{ marginTop: 4 }}>
                  <label>Que faire des références déjà présentes ?</label>
                  <select value={mode} onChange={(e) => changerMode(e.target.value)}>
                    <option value="ignorer">Ignorer les doublons (recommandé)</option>
                    <option value="mettre_a_jour">Mettre à jour les ventes existantes</option>
                  </select>
                  <small>Le mode « mise à jour » écrase les champs de la vente existante, sans changer sa référence.</small>
                </div>
                {!can("imports.write") && (
                  <div className="form-note"><InfoOutlinedIcon /> Votre rôle permet de consulter les imports, pas d'en créer.</div>
                )}
              </div>

              <div className="studio-card">
                <h2><DownloadIcon /> Gabarits prêts à l'emploi</h2>
                <p className="hint">Partez du modèle officiel pour éviter les erreurs de colonnes.</p>
                <div className="row-actions">
                  <button className="btn btn-outline btn-sm" onClick={() => telechargerModele("csv")}><DownloadIcon /> CSV</button>
                  <button className="btn btn-outline btn-sm" onClick={() => telechargerModele("xlsx")}><DownloadIcon /> Excel</button>
                </div>
                <p className="form-note"><InfoOutlinedIcon /> Les en-têtes sont en français, avec un exemple et une feuille « mode d'emploi » dans le classeur.</p>
              </div>
            </aside>
          </div>
        )}

        {onglet === "formulaires" && (
          <div className="forms-page">
            <div className="forms-head">
              <div>
                <h2 style={{ fontSize: 18, margin: 0 }}>Formulaires de collecte</h2>
                <p className="hint" style={{ margin: "2px 0 0" }}>Des saisies guidées pour les équipes terrain : chaque soumission crée un lot d'import traçable.</p>
              </div>
              {can("forms.manage") && <button className="btn btn-brand" onClick={() => ouvrirEditeur()}><AddIcon /> Nouveau formulaire</button>}
            </div>

            {chargement && !forms ? (
              <div className="panel" style={{ padding: 40, textAlign: "center" }}><Spinner label="Chargement des formulaires…" /></div>
            ) : (forms || []).length === 0 ? (
              <div className="panel"><Empty icon={<DynamicFormIcon />} title="Aucun formulaire" text="Créez un premier formulaire pour vos équipes terrain." action={can("forms.manage") ? <button className="btn btn-brand" onClick={() => ouvrirEditeur()}>Créer un formulaire</button> : null} /></div>
            ) : (
              <div className="forms-grid">
                {(forms || []).map((f) => (
                  <article className="form-card" key={f.id}>
                    <div className="form-card-head">
                      <h3>{f.nom}</h3>
                      <Badge tone="brand">#{f.id}</Badge>
                    </div>
                    <p className="form-desc">{f.description || "Formulaire de collecte MboaPilot."}</p>
                    <div className="form-fields-preview">
                      {(f.champs || []).map((c) => <span key={c.cle}>{c.label}</span>)}
                    </div>
                    <div className="row-actions">
                      {can("forms.submit") && <button className="btn btn-brand" onClick={() => ouvrirSoumission(f)}><PlaylistAddIcon /> Saisir</button>}
                      {can("forms.manage") && <button className="btn btn-outline" onClick={() => ouvrirEditeur(f)}><EditIcon /> Modifier</button>}
                      {can("forms.manage") && <button className="icon-btn danger" title="Supprimer" onClick={() => supprimerFormulaire(f)}><DeleteOutlineIcon /></button>}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        {onglet === "historique" && (
          <div className="imports-history">
            <div className="history-filters">
              <div className="audit-search" style={{ maxWidth: 320 }}>
                <ListAltIcon />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un fichier, un auteur, un statut…" aria-label="Rechercher un import" />
              </div>
              <select value={statutFiltre} onChange={(e) => setStatutFiltre(e.target.value)} aria-label="Filtrer par statut">
                <option value="">Tous les statuts</option>
                <option value="Reussi">Réussi</option>
                <option value="Partiel">Partiel</option>
                <option value="Echec">Échec</option>
                <option value="annule">Annulés</option>
              </select>
              <Badge tone="brand">{listeImports.length} lot(s)</Badge>
              <button className="btn btn-ghost btn-sm" onClick={charger}><RefreshIcon /> Actualiser</button>
            </div>

            <div className="table-wrap">
              <table className="grid">
                <thead><tr><th>#</th><th>Source</th><th>Fichier</th><th>Jour</th><th className="num">Reçues</th><th className="num">Intégrées</th><th className="num">Doublons</th><th className="num">Rejets</th><th>Statut</th><th>Auteur</th><th /></tr></thead>
                <tbody>
                  {listeImports.map((r) => (
                    <tr key={r.id}>
                      <td><b>{r.id}</b></td>
                      <td><Badge tone={r.type === "formulaire" ? "brand" : "gray"}>{r.source}</Badge></td>
                      <td><span style={{ maxWidth: 220, display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>{r.nom_fichier}</span></td>
                      <td>{dateFR(r.jour)}</td>
                      <td className="num">{fmt(r.lignes_recues)}</td>
                      <td className="num"><b>{fmt(r.lignes_integrees)}</b></td>
                      <td className="num">{fmt(r.doublons)}</td>
                      <td className="num" style={{ color: r.rejets ? "var(--red)" : undefined }}>{fmt(r.rejets)}</td>
                      <td><Badge tone={r.annule ? "gray" : STATUT_TONE[r.statut] || "gray"}>{r.annule ? "Annulé" : r.statut}</Badge></td>
                      <td><span className="faint" style={{ fontSize: 10 }}>{r.user_login || "-"}</span></td>
                      <td>
                        <div className="import-actions">
                          <button className="icon-btn" title="Voir le détail" onClick={() => ouvrirDetail(r.id)}><VisibilityIcon /></button>
                          {can("imports.cancel") && !r.annule && (
                            <button className="icon-btn danger" title="Annuler ce lot" onClick={() => annuler(r)}><BlockIcon /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {listeImports.length === 0 && <div className="panel" style={{ marginTop: 12 }}><Empty icon={<HistoryIcon />} title="Aucun import trouvé" text="Ajustez la recherche ou déposez un nouveau fichier." /></div>}
          </div>
        )}
      </div>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.data ? `Import #${detail.data.import.id}` : "Détail de l'import"}
        subtitle={detail?.data ? `${detail.data.import.source} · ${detail.data.import.nom_fichier}` : "Chargement du lot…"}
        wide
        footer={detail?.data ? (
          <>
            <button className="btn btn-ghost" onClick={() => setDetail(null)}>Fermer</button>
            {can("imports.cancel") && !detail.data.import.annule && (
              <button className="btn btn-danger" onClick={() => annuler(detail.data.import)} disabled={envoi === "annuler"}><BlockIcon /> Annuler ce lot</button>
            )}
          </>
        ) : null}
      >
        {detail?.loading || detailBusy ? (
          <div style={{ padding: 40, textAlign: "center" }}><Spinner label="Lecture du journal d'import…" /></div>
        ) : detail?.data && (
          <div className="stack">
            <div className="detail-dl">
              <div><small>Statut</small><b><Badge tone={detail.data.import.annule ? "gray" : STATUT_TONE[detail.data.import.statut] || "gray"}>{detail.data.import.annule ? "Annulé" : detail.data.import.statut}</Badge></b></div>
              <div><small>Type / source</small><b>{detail.data.import.type} · {detail.data.import.source}</b></div>
              <div><small>Date du lot</small><b>{dateFR(detail.data.import.jour)}</b></div>
              <div><small>Auteur</small><b>{detail.data.import.user_login || "-"}</b></div>
              <div><small>Lignes reçues</small><b>{fmt(detail.data.import.lignes_recues)}</b></div>
              <div><small>Intégrées / MAJ</small><b>{fmt(detail.data.import.lignes_integrees)} / {fmt(detail.data.import.mises_a_jour)}</b></div>
              <div><small>Rejets / doublons</small><b>{fmt(detail.data.import.rejets)} / {fmt(detail.data.import.doublons)}</b></div>
              <div><small>Empreinte</small><b className="mono">{detail.data.import.hash_fichier || "-"}</b></div>
            </div>
            <div className="table-wrap">
              <table className="grid">
                <thead><tr><th>Ligne</th><th>Référence</th><th>Statut</th><th>Motif</th></tr></thead>
                <tbody>
                  {detail.data.lignes.slice(0, 200).map((l) => (
                    <tr key={l.id}>
                      <td>{l.ligne}</td>
                      <td className="mono" style={{ fontSize: 10.5 }}>{l.ref || "-"}</td>
                      <td><Badge tone={PREVIEW_TONE[l.statut] || "gray"}>{PREVIEW_LABEL[l.statut] || l.statut}</Badge></td>
                      <td>{l.motif || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail.data.lignes.length === 0 && <p className="faint" style={{ fontSize: 12 }}>Aucune ligne détaillée enregistrée pour ce lot.</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(editeur)}
        onClose={() => setEditeur(null)}
        title={editeur?.id ? "Modifier le formulaire" : "Créer un formulaire"}
        subtitle="Choisissez les champs métier, leur libellé et leur caractère obligatoire."
        wide
        footer={(
          <>
            <button className="btn btn-ghost" onClick={() => setEditeur(null)}>Annuler</button>
            <button className="btn btn-brand" onClick={enregistrerFormulaire} disabled={envoi === "form" || !editeur?.nom || !editeur?.champs?.length}>
              {envoi === "form" ? <><Spinner inline label="" /> Enregistrement…</> : "Enregistrer le formulaire"}
            </button>
          </>
        )}
      >
        {editeur && (
          <form onSubmit={enregistrerFormulaire}>
            <div className="field-row">
              <div className="field"><label>Nom du formulaire</label><input value={editeur.nom} onChange={(e) => setEditeur({ ...editeur, nom: e.target.value })} required placeholder="ex. Relevé quotidien boutique" /></div>
              <div className="field"><label>Description</label><input value={editeur.description} onChange={(e) => setEditeur({ ...editeur, description: e.target.value })} placeholder="À quoi sert-il ?" /></div>
            </div>
            <div className="builder-list">
              {editeur.champs.map((c, idx) => (
                <div className="builder-field" key={c._id}>
                  <div className="builder-field-head">
                    <code>{c.cle || "champ"}</code>
                    <b>Champ {idx + 1}</b>
                    <button type="button" className="icon-btn danger" title="Retirer" onClick={() => supprimerChamp(c._id)}><RemoveCircleOutlineIcon /></button>
                  </div>
                  <div className="cols-3">
                    <div className="field">
                      <label>Champ métier</label>
                      <select value={c.cle} onChange={(e) => choisirCle(c._id, e.target.value)} required>
                        {ORDRE.map((cle) => <option key={cle} value={cle} disabled={cle !== c.cle && editeur.champs.some((x) => x.cle === cle)}>{CHAMPS[cle].label}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>Libellé affiché</label>
                      <input value={c.label} onChange={(e) => majChamp(c._id, { label: e.target.value })} required maxLength={80} />
                    </div>
                    <div className="field">
                      <label>Type</label>
                      <select value={c.type} onChange={(e) => majChamp(c._id, { type: e.target.value })}>
                        {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="cols-3">
                    <div className="field">
                      <label>Obligatoire</label>
                      <select value={c.requis ? "oui" : "non"} onChange={(e) => majChamp(c._id, { requis: e.target.value === "oui" })}>
                        <option value="oui">Oui</option><option value="non">Non</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Valeur par défaut</label>
                      <input value={c.defaut || ""} onChange={(e) => majChamp(c._id, { defaut: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>Aide (optionnel)</label>
                      <input value={c.aide || ""} onChange={(e) => majChamp(c._id, { aide: e.target.value })} maxLength={160} />
                    </div>
                  </div>
                  {c.type === "select" && (
                    <div className="field">
                      <label>Options (séparées par des virgules)</label>
                      <input value={(c.options || []).join(", ")} onChange={(e) => majChamp(c._id, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="POS, Agence, E-commerce" />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="builder-suggestions">
              <button type="button" onClick={ajouterChamp}><AddIcon style={{ fontSize: 13 }} /> Ajouter un champ</button>
              {["ville", "point_vente", "vendeur", "remise_pct", "montant", "cout_unit"].filter((c) => !editeur.champs.some((x) => x.cle === c)).map((c) => (
                <button type="button" key={c} onClick={() => setEditeur((e) => ({ ...e, champs: [...e.champs, champVide(c)] }))}>+ {CHAMPS[c].label}</button>
              ))}
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(soumission)}
        onClose={() => { setSoumission(null); setSoumissionResultat(null); }}
        title={soumission?.form?.nom || "Saisie guidée"}
        subtitle={soumission?.form?.description || "Remplissez une ou plusieurs lignes. Chaque ligne devient une vente."}
        wide
        footer={!soumissionResultat ? (
          <>
            <button className="btn btn-ghost" onClick={() => setSoumission(null)}>Annuler</button>
            <button className="btn btn-brand" onClick={soumettreFormulaire} disabled={envoi === "soumettre"}>
              {envoi === "soumettre" ? <><Spinner inline label="" /> Envoi…</> : <><CheckCircleIcon /> Soumettre {soumission?.lignes?.length || 0} ligne(s)</>}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-outline" onClick={() => { setSoumission(null); setSoumissionResultat(null); }}>Fermer</button>
            <button className="btn btn-brand" onClick={() => { setSoumission({ form: soumission.form, lignes: [donneesInitiales(soumission.form)] }); setSoumissionResultat(null); }}><AddIcon /> Nouvelle saisie</button>
          </>
        )}
      >
        {soumission && !soumissionResultat && (
          <form onSubmit={soumettreFormulaire}>
            <div className="form-submit-lines">
              {soumission.lignes.map((ligne, i) => (
                <div className="form-submitted-row" key={i}>
                  <div className="form-line-head">
                    <h3>Ligne {i + 1}</h3>
                    {soumission.lignes.length > 1 && <button type="button" onClick={() => retirerLigne(i)}>Retirer</button>}
                  </div>
                  <div className="field-row">
                    {(soumission.form.champs || []).map((c) => (
                      <div className="field" key={c.cle}>
                        <label>{c.label}{c.requis && <b className="req">*</b>}</label>
                        {c.type === "select" ? (
                          <select value={ligne[c.cle] ?? ""} onChange={(e) => majLigne(i, c.cle, e.target.value)} required={c.requis}>
                            <option value="">- Choisir -</option>
                            {(c.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : c.type === "textarea" ? (
                          <textarea rows={2} value={ligne[c.cle] ?? ""} onChange={(e) => majLigne(i, c.cle, e.target.value)} required={c.requis} placeholder={c.aide || ""} />
                        ) : (
                          <input
                            type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"}
                            value={ligne[c.cle] ?? ""}
                            onChange={(e) => majLigne(i, c.cle, e.target.value)}
                            required={c.requis}
                            placeholder={c.aide || ""}
                            step={c.type === "number" ? "any" : undefined}
                          />
                        )}
                        {c.aide && <small>{c.aide}</small>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-outline" style={{ marginTop: 10 }} onClick={ajouterLigne}><AddIcon /> Ajouter une ligne</button>
          </form>
        )}
        {soumissionResultat && (
          <div className="import-result">
            <b><CheckCircleIcon style={{ fontSize: 17, verticalAlign: "-3px", marginRight: 5 }} /> Formulaire traité</b>
            {soumissionResultat.message}
            <div className="row-actions">
              <button className="btn btn-outline btn-sm" onClick={() => ouvrirDetail(soumissionResultat.import_id)}><VisibilityIcon /> Voir le lot #{soumissionResultat.import_id}</button>
            </div>
          </div>
        )}
      </Modal>

      <Toast message={toast?.message} tone={toast?.tone} onClose={() => setToast(null)} />
    </>
  );
}
