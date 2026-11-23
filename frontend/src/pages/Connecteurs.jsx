import { useCallback, useEffect, useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveIcon from "@mui/icons-material/Save";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import DeleteIcon from "@mui/icons-material/Delete";
import SearchIcon from "@mui/icons-material/Search";
import SettingsIcon from "@mui/icons-material/Settings";
import CloseIcon from "@mui/icons-material/Close";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import TableChartIcon from "@mui/icons-material/TableChart";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import NumbersIcon from "@mui/icons-material/Numbers";
import DateRangeIcon from "@mui/icons-material/DateRange";
import FilterListIcon from "@mui/icons-material/FilterList";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import FunctionsIcon from "@mui/icons-material/Functions";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import StorageIcon from "@mui/icons-material/Storage";
import LanguageIcon from "@mui/icons-material/Language";
import CloudQueueIcon from "@mui/icons-material/CloudQueue";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import GridViewIcon from "@mui/icons-material/GridView";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { api } from "../api";
import { Toast } from "../components";

const SOURCES = [
  { value: "rest", label: "API REST", desc: "OAuth2, clé API, Bearer", icon: <LanguageIcon /> },
  { value: "csv_url", label: "CSV distant", desc: "URL avec séparateur", icon: <CloudQueueIcon /> },
  { value: "sftp", label: "SFTP", desc: "Serveur sécurisé", icon: <StorageIcon /> },
  { value: "dossier", label: "Dossier local", desc: "Fichiers du poste", icon: <FolderOpenIcon /> },
  { value: "excel", label: "Classeur Excel", desc: "xlsx, xls", icon: <GridViewIcon /> },
  { value: "pdf", label: "Document PDF", desc: "Tableaux extraits", icon: <PictureAsPdfIcon /> },
];

const TRANSFORMATIONS = [
  { action: "selectColumns", label: "Choisir des colonnes", icon: <TableChartIcon /> },
  { action: "renameColumns", label: "Renommer", icon: <SwapHorizIcon /> },
  { action: "filterRows", label: "Filtrer les lignes", icon: <FilterListIcon /> },
  { action: "addColumn", label: "Colonne calculée", icon: <FunctionsIcon /> },
  { action: "changeType", label: "Changer le type", icon: <CallSplitIcon /> },
  { action: "removeRows", label: "Retirer des lignes", icon: <ContentCopyIcon /> },
  { action: "mapToSales", label: "Mapper vers ventes", icon: <StorageIcon /> },
];

const DEFAUTS = {
  selectColumns: { action: "selectColumns", colonnes: [] },
  renameColumns: { action: "renameColumns", renommages: {} },
  filterRows: { action: "filterRows", colonne: "", operateur: "contient", valeur: "" },
  addColumn: { action: "addColumn", nom: "", expression: "" },
  changeType: { action: "changeType", colonne: "", type: "texte" },
  removeRows: { action: "removeRows", nombre: 0 },
  mapToSales: { action: "mapToSales", mapping: {} },
};

function typeColonne(nom, valeurs) {
  const n = String(nom || "").toLowerCase();
  if (n.includes("date") || n.includes("jour") || n.includes("mois")) return "date";
  if (n.includes("prix") || n.includes("montant") || n.includes("qte") || n.includes("quantite") || n.includes("remise")) return "nombre";
  const v = valeurs.find((x) => x !== undefined && x !== null && String(x) !== "");
  if (v && !Number.isNaN(Number(v))) return "nombre";
  return "texte";
}

function IconeType({ type }) {
  if (type === "nombre") return <NumbersIcon fontSize="small" style={{ color: "#1976d2" }} />;
  if (type === "date") return <DateRangeIcon fontSize="small" style={{ color: "#8e24aa" }} />;
  return <TextFieldsIcon fontSize="small" style={{ color: "#455a64" }} />;
}

function libelleEtape(e) {
  const t = TRANSFORMATIONS.find((x) => x.action === e?.action);
  if (!t) return "Étape";
  if (e.action === "selectColumns") return (e.colonnes || []).length ? t.label + " : " + e.colonnes.length : t.label;
  if (e.action === "filterRows") return e.colonne ? t.label + " · " + e.colonne : t.label;
  if (e.action === "addColumn") return e.nom ? t.label + " : " + e.nom : t.label;
  if (e.action === "changeType") return e.colonne ? t.label + " · " + e.colonne : t.label;
  return t.label;
}

export default function Connecteurs() {
  const [requetes, setRequetes] = useState([]);
  const [active, setActive] = useState(null);
  const [ruban, setRuban] = useState("accueil");
  const [nom, setNom] = useState("");
  const [type, setType] = useState("rest");
  const [cfg, setCfg] = useState({});
  const [etapes, setEtapes] = useState([]);
  const [apercu, setApercu] = useState(null);
  const [dialogue, setDialogue] = useState(null);
  const [selection, setSelection] = useState(-1);
  const [recherche, setRecherche] = useState("");
  const [resultat, setResultat] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [panneaux, setPanneaux] = useState({ requetes: true, etapes: true });
  const [racines, setRacines] = useState([]);
  const [dossier, setDossier] = useState(null);
  const [fichiers, setFichiers] = useState({ dossiers: [], fichiers: [] });
  const [fichierChoisi, setFichierChoisi] = useState(null);
  const [feuilles, setFeuilles] = useState([]);
  const [feuilleChoisie, setFeuilleChoisie] = useState("");
  const [apercuFichier, setApercuFichier] = useState(null);
  const [excelMode, setExcelMode] = useState("com");
  const [comStatut, setComStatut] = useState(null);
  const [comClasseurs, setComClasseurs] = useState([]);
  const [classeurChoisi, setClasseurChoisi] = useState("");
  const [feuilleCom, setFeuilleCom] = useState("");
  const [apercuCom, setApercuCom] = useState(null);
  const [cheminOuvrir, setCheminOuvrir] = useState("");
  const [depot, setDepot] = useState(null);
  const [glisse, setGlisse] = useState(false);

  const charger = useCallback(async () => {
    try {
      const r = await api.get("/api/connecteurs");
      setRequetes(r.connecteurs || []);
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

  const configuration = useCallback((extra = {}) => ({ ...cfg, ...extra, etapes }), [cfg, etapes]);

  const tester = useCallback(async (config) => {
    setBusy(true);
    try {
      const r = await api.post("/api/connecteurs/tester", { configuration: config || configuration() });
      setApercu(r.ok ? r : null);
      if (!r.ok) setToast({ message: r.message, tone: "error" });
      return r.ok;
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }, [configuration]);

  const ouvrir = async (q) => {
    setActive(q);
    setNom(q.nom);
    setType(q.type || "rest");
    const c = q.configuration || {};
    setCfg(c);
    setEtapes(c.etapes || []);
    setSelection(-1);
    setResultat(null);
    await tester({ ...c, etapes: c.etapes || [] });
  };

  const nouvelleSource = (t) => {
    setActive(null);
    setNom("");
    setType(t);
    setCfg(t === "rest" ? { url: "", chemin_donnees: "", auth: { mode: "aucun" } } : {});
    setEtapes([]);
    setApercu(null);
    setSelection(-1);
    setDialogue("source");
    setRuban("accueil");
  };

  const ouvrirDossier = async (chemin) => {
    try {
      const r = await api.get("/api/fichiers/lister?chemin=" + encodeURIComponent(chemin));
      setDossier(r);
      setFichiers(r);
      setFichierChoisi(null);
      setApercuFichier(null);
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
  };

  useEffect(() => {
    if (dialogue !== "source") return;
    api.get("/api/fichiers/racines").then((r) => {
      setRacines(r.racines || []);
      if (r.racines?.length && !dossier) ouvrirDossier(r.racines[0]);
    }).catch(() => {});
  }, [dialogue]);

  const choisirFichier = async (f) => {
    setFichierChoisi(f);
    setBusy(true);
    try {
      const r = await api.get("/api/fichiers/feuilles?chemin=" + encodeURIComponent(f.chemin));
      const fs = r.feuilles || [];
      setFeuilles(fs);
      const premiere = fs[0] || "";
      setFeuilleChoisie(premiere);
      const a = await api.get("/api/fichiers/apercu?chemin=" + encodeURIComponent(f.chemin) +
        (premiere ? "&feuille=" + encodeURIComponent(premiere) : ""));
      setApercuFichier(a);
      const cibles = ["ref", "jour", "canal", "region", "ville", "point_vente", "vendeur",
        "produit", "famille", "qte", "prix_unit", "remise_pct", "montant", "cout_unit", "devise"];
      const mappingAuto = {};
      for (const cible of cibles) {
        const col = (a.en_tetes || []).find((x) => x.toLowerCase().replace(/[^a-z0-9]/g, "") === cible);
        if (col) mappingAuto[cible] = col;
      }
      setCfg({ chemin: f.chemin, feuille: premiere, mapping: mappingAuto });
      setNom(f.nom.replace(/\.(xlsx|xls|xlsm|csv|pdf)$/i, ""));
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setBusy(false);
  };

  const chargerFeuille = async () => {
    if (!fichierChoisi) return;
    setType("excel");
    const config = { chemin: fichierChoisi.chemin, feuille: feuilleChoisie, mapping: cfg.mapping || {} };
    setCfg(config);
    const ok = await tester({ ...config, type: "excel" });
    if (ok) {
      setDialogue(null);
      setToast({ message: "Feuille chargée. Ajoutez vos transformations puis enregistrez.", tone: "success" });
    }
  };

  const connecterExcel = async () => {
    setBusy(true);
    try {
      const r = await api.post("/api/excel-live/connecter", {});
      setToast({ message: r.message, tone: r.ok ? "success" : "error" });
      if (r.ok) {
        const s = await api.get("/api/excel-live/statut");
        setComStatut(s);
        const l = await api.get("/api/excel-live/classeurs");
        setComClasseurs(l.classeurs || []);
      }
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setBusy(false);
  };

  const actualiserExcel = async () => {
    setBusy(true);
    try {
      const s = await api.get("/api/excel-live/statut");
      setComStatut(s);
      const l = await api.get("/api/excel-live/classeurs");
      setComClasseurs(l.classeurs || []);
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setBusy(false);
  };

  const deconnecterExcel = async () => {
    setBusy(true);
    try {
      await api.post("/api/excel-live/fermer", {});
      setComStatut({ connecte: false, classeurs: [], version: "" });
      setComClasseurs([]);
      setClasseurChoisi("");
      setFeuilleCom("");
      setApercuCom(null);
      setToast({ message: "Excel est déconnecté.", tone: "success" });
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setBusy(false);
  };

  const ouvrirClasseurCom = async (chemin) => {
    if (!chemin) return;
    setBusy(true);
    try {
      const r = await api.post("/api/excel-live/ouvrir", { chemin });
      if (!r.ok) {
        setToast({ message: r.message, tone: "error" });
      } else {
        const l = await api.get("/api/excel-live/classeurs");
        setComClasseurs(l.classeurs || []);
        setClasseurChoisi(r.nom);
        setCheminOuvrir("");
        if (r.feuilles?.length) {
          setFeuilleCom(r.feuilles[0]);
          await lireClasseurCom(r.nom, r.feuilles[0]);
        }
        setToast({ message: r.nom + " est ouvert dans Excel.", tone: "success" });
      }
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setBusy(false);
  };

  useEffect(() => {
    if (dialogue === "source" && type === "excel" && excelMode === "com") {
      api.get("/api/excel-live/statut").then((s) => {
        setComStatut(s);
        if (s.connecte) api.get("/api/excel-live/classeurs").then((r) => setComClasseurs(r.classeurs || []));
      }).catch(() => {});
    }
  }, [dialogue, type, excelMode]);

  const lireClasseurCom = async (wb, feuille) => {
    setBusy(true);
    try {
      const a = await api.get("/api/excel-live/apercu?classeur=" + encodeURIComponent(wb) + "&feuille=" + encodeURIComponent(feuille));
      if (!a.ok) {
        setToast({ message: a.message, tone: "error" });
      } else {
        setApercuCom(a);
        const cibles = ["ref", "jour", "canal", "region", "ville", "point_vente", "vendeur",
          "produit", "famille", "qte", "prix_unit", "remise_pct", "montant", "cout_unit", "devise"];
        const mappingAuto = {};
        for (const cible of cibles) {
          const col = (a.en_tetes || []).find((x) => x.toLowerCase().replace(/[^a-z0-9]/g, "") === cible);
          if (col) mappingAuto[cible] = col;
        }
        setCfg({ source: "excel-com", classeur: wb, feuille, mapping: mappingAuto });
        setNom(wb.replace(/\.(xlsx|xls|xlsm|csv)$/i, ""));
      }
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setBusy(false);
  };

  const chargerFeuilleCom = async () => {
    if (!apercuCom) return;
    setBusy(true);
    try {
      const r = await api.post("/api/excel-live/charger", {
        classeur: classeurChoisi, feuille: feuilleCom, mapping: cfg.mapping || {}, mode: "ignorer",
      });
      setResultat(r);
      setToast({ message: r.integrees + " lignes ajoutées, " + r.rejets + " rejets", tone: r.ok ? "success" : "error" });
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setBusy(false);
  };

  const deposerFichier = async (fichier) => {
    if (!fichier) return;
    setBusy(true);
    const fd = new FormData();
    fd.append("fichier", fichier);
    try {
      const r = await api.upload("/api/excel-live/upload", fd);
      if (!r.ok) {
        setToast({ message: r.message, tone: "error" });
      } else {
        setDepot(r);
        setNom(r.nom.replace(/\.(xlsx|xls|xlsm|csv)$/i, ""));
        const cibles = ["ref", "jour", "canal", "region", "ville", "point_vente", "vendeur",
          "produit", "famille", "qte", "prix_unit", "remise_pct", "montant", "cout_unit", "devise"];
        const mappingAuto = {};
        for (const cible of cibles) {
          const col = (r.en_tetes || []).find((x) => x.toLowerCase().replace(/[^a-z0-9]/g, "") === cible);
          if (col) mappingAuto[cible] = col;
        }
        setCfg({ source: "depot", chemin: r.chemin, feuille: r.feuille, mapping: mappingAuto });
      }
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setBusy(false);
  };

  const chargerDepot = async () => {
    if (!depot) return;
    setBusy(true);
    try {
      const r = await api.post("/api/fichiers/importer", {
        chemin: depot.chemin, feuille: depot.feuille, mapping: cfg.mapping || {}, mode: "ignorer",
      });
      setResultat(r);
      setToast({ message: r.integrees + " lignes ajoutées, " + r.rejets + " rejets", tone: r.ok ? "success" : "error" });
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setBusy(false);
  };

  const enregistrer = async () => {
    if (!nom.trim()) {
      setToast({ message: "Donnez un nom à la requête.", tone: "error" });
      return;
    }
    setBusy(true);
    try {
      const r = await api.post("/api/connecteurs", {
        id: active?.id, nom: nom.trim(), type, configuration: configuration(),
      });
      setToast({ message: "Requête enregistrée.", tone: "success" });
      setDialogue(null);
      await charger();
      const liste = (await api.get("/api/connecteurs")).connecteurs || [];
      await ouvrir(liste.find((x) => x.id === r.id));
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setBusy(false);
  };

  const executer = async () => {
    if (!active) {
      setToast({ message: "Enregistrez d'abord la requête.", tone: "error" });
      return;
    }
    setBusy(true);
    try {
      const r = await api.post("/api/connecteurs/" + active.id + "/sync", {});
      setResultat(r);
      setToast({ message: r.message || (r.lignes + " lignes chargées"), tone: r.ok ? "success" : "error" });
      await charger();
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setBusy(false);
  };

  const supprimer = async () => {
    if (!active) return;
    if (!window.confirm("Supprimer cette requête ?")) return;
    await api.del("/api/connecteurs/" + active.id);
    setToast({ message: "Requête supprimée.", tone: "success" });
    setActive(null);
    setApercu(null);
    charger();
  };

  const ajouterEtape = (action) => {
    setEtapes([...etapes, { ...DEFAUTS[action] }]);
    setSelection(etapes.length);
    setDialogue("etape");
  };

  const majEtape = (patch) => {
    setEtapes(etapes.map((e, i) => (i === selection ? { ...e, ...patch } : e)));
  };

  const colonnes = apercu?.colonnes || [];
  const lignes = apercu?.apercu || [];
  const requetesFiltrees = requetes.filter((q) => q.nom.toLowerCase().includes(recherche.toLowerCase()));

  return (
    <div className="pq-shell">
      <Toast toast={toast} />

      <header className="pq-titlebar">
        <div className="pq-title-left">
          <b>Éditeur de requêtes</b>
          <span className="pq-subtitle">MboaPilot</span>
        </div>
        <div className="pq-title-right">
          {active && <span className="pq-sauvegarde">{active.dernier_statut || "Non exécutée"}</span>}
          <button className="pq-icon" onClick={() => tester()} title="Actualiser l'aperçu"><RefreshIcon /></button>
        </div>
      </header>

      <nav className="pq-ribbon-tabs">
        {[["accueil", "Accueil"], ["sources", "Sources"], ["transformations", "Transformations"], ["affichage", "Affichage"]].map(([id, label]) => (
          <button key={id} className={ruban === id ? "actif" : ""} onClick={() => setRuban(id)}>{label}</button>
        ))}
      </nav>

      <div className="pq-ribbon">
        {ruban === "accueil" && (
          <>
            <button className="pq-action importante" onClick={() => nouvelleSource("rest")}><AddIcon /><span>Nouvelle source</span></button>
            <button className="pq-action" onClick={() => tester()} disabled={busy}><RefreshIcon /><span>Actualiser</span></button>
            <button className="pq-action" onClick={enregistrer} disabled={busy}><SaveIcon /><span>Enregistrer</span></button>
            <button className="pq-action" onClick={executer} disabled={busy || !active}><PlayArrowIcon /><span>Exécuter la requête</span></button>
            <button className="pq-action" onClick={supprimer} disabled={!active}><DeleteIcon /><span>Supprimer</span></button>
          </>
        )}
        {ruban === "sources" && SOURCES.map((s) => (
          <button key={s.value} className="pq-action" onClick={() => nouvelleSource(s.value)}>
            {s.icon}<span>{s.label}</span>
          </button>
        ))}
        {ruban === "transformations" && TRANSFORMATIONS.map((t) => (
          <button key={t.action} className="pq-action" onClick={() => ajouterEtape(t.action)} disabled={!apercu}>
            {t.icon}<span>{t.label}</span>
          </button>
        ))}
        {ruban === "affichage" && (
          <>
            <button className={"pq-action" + (panneaux.requetes ? " presse" : "")} onClick={() => setPanneaux({ ...panneaux, requetes: !panneaux.requetes })}><GridViewIcon /><span>Volet requêtes</span></button>
            <button className={"pq-action" + (panneaux.etapes ? " presse" : "")} onClick={() => setPanneaux({ ...panneaux, etapes: !panneaux.etapes })}><SettingsIcon /><span>Étapes appliquées</span></button>
          </>
        )}
      </div>

      <div className="pq-corps">
        {panneaux.requetes && (
          <aside className="pq-requetes">
            <div className="pq-panneau-titre">
              <span>Requêtes</span>
              <button onClick={() => nouvelleSource("rest")} title="Nouvelle requête"><AddIcon fontSize="small" /></button>
            </div>
            <div className="pq-recherche"><SearchIcon fontSize="small" /><input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher" /></div>
            <div className="pq-liste">
              {requetesFiltrees.map((q) => (
                <button key={q.id} className={"pq-requete" + (active?.id === q.id ? " active" : "")} onClick={() => ouvrir(q)}>
                  <TableChartIcon fontSize="small" />
                  <span>{q.nom}<small>{SOURCES.find((s) => s.value === q.type)?.label || q.type}</small></span>
                </button>
              ))}
              {requetesFiltrees.length === 0 && <p className="pq-vide">Aucune requête.</p>}
            </div>
            <div className="pq-groupe">
              <span>Étapes</span>
              <div className="pq-liste-etapes">
                {etapes.map((e, i) => (
                  <button key={i} className={selection === i ? "active" : ""} onClick={() => { setSelection(i); setDialogue("etape"); }}>
                    <span className="pq-num">{i + 1}</span>{libelleEtape(e)}
                  </button>
                ))}
                {etapes.length === 0 && <p className="pq-vide">Aucune transformation.</p>}
              </div>
            </div>
          </aside>
        )}

        <main className="pq-workspace">
          <div className="pq-entete-requete">
            <div>
              <input className="pq-nom" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom de la requête" />
              <span className="pq-type">{SOURCES.find((s) => s.value === type)?.label}</span>
            </div>
            <div className="pq-entete-actions">
              {apercu && <span className="pq-compteur"><CheckCircleIcon fontSize="small" /> {apercu.lignes?.length || 0} lignes · {colonnes.length} colonnes</span>}
              <button className="pq-bouton" onClick={() => setDialogue("source")}><SettingsIcon fontSize="small" /> Configurer la source</button>
            </div>
          </div>

          {busy && <div className="pq-chargement">Lecture de la source en cours…</div>}

          {!apercu && !busy && (
            <div className="pq-accueil">
              <GridViewIcon style={{ fontSize: 52, color: "#c7cbd6" }} />
              <h2>Aucune requête ouverte</h2>
              <p>Choisissez une requête à gauche ou créez une nouvelle source.</p>
              <button className="pq-bouton plein" onClick={() => nouvelleSource("rest")}><AddIcon /> Nouvelle source</button>
            </div>
          )}

          {apercu && (
            <div className="pq-grille-wrap">
              <table className="pq-grille">
                <thead>
                  <tr>
                    <th className="pq-num-col" />
                    {colonnes.map((c) => (
                      <th key={c}>
                        <span className="pq-col"><IconeType type={typeColonne(c, lignes.map((l) => l[c]))} />{c}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l, i) => (
                    <tr key={i}>
                      <td className="pq-num-col">{i + 1}</td>
                      {colonnes.map((c) => <td key={c}>{String(l[c] ?? "").slice(0, 60)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {resultat && (
            <div className={"pq-resultat " + (resultat.ok ? "ok" : "ko")}>
              {resultat.ok ? <CheckCircleIcon /> : <ErrorOutlineIcon />}
              <span>{resultat.ok ? resultat.lignes + " lignes intégrées, " + resultat.rejets + " rejets" : resultat.message}</span>
            </div>
          )}
        </main>

        {panneaux.etapes && (
          <aside className="pq-etapes">
            <div className="pq-panneau-titre"><span>Étapes appliquées</span><SettingsIcon fontSize="small" /></div>
            <div className="pq-etapes-liste">
              <button className={"pq-etape" + (selection === -1 ? " active" : "")} onClick={() => setSelection(-1)}>
                <span className="pq-num">0</span><span>Source</span>
              </button>
              {etapes.map((e, i) => (
                <button key={i} className={"pq-etape" + (selection === i ? " active" : "")} onClick={() => { setSelection(i); setDialogue("etape"); }}>
                  <span className="pq-num">{i + 1}</span>
                  <span>{libelleEtape(e)}</span>
                  <span className="pq-engrenage" onClick={(ev) => { ev.stopPropagation(); setSelection(i); setDialogue("etape"); }}><SettingsIcon fontSize="small" /></span>
                  <span className="pq-croix" onClick={(ev) => { ev.stopPropagation(); setEtapes(etapes.filter((_, j) => j !== i)); setSelection(-1); }}><CloseIcon fontSize="small" /></span>
                </button>
              ))}
            </div>
            <button className="pq-ajouter-etape" onClick={() => setDialogue("etape")}><AddIcon fontSize="small" /> Ajouter une étape</button>
          </aside>
        )}
      </div>

      <footer className="pq-status">
        <span>{apercu ? (apercu.lignes?.length || 0) + " lignes chargées" : "Prêt"}</span>
        <span>{etapes.length} étape(s) appliquée(s)</span>
        <span>{active ? active.nom : "Nouvelle requête"}</span>
      </footer>

      {dialogue === "source" && (
        <div className="pq-modal" onClick={() => setDialogue(null)}>
          <div className="pq-dialogue" onClick={(e) => e.stopPropagation()}>
            <div className="pq-dialogue-head">
              <div><h2>Configurer la source</h2><p>Choisissez un type puis renseignez les paramètres de connexion.</p></div>
              <button onClick={() => setDialogue(null)}><CloseIcon /></button>
            </div>
            <div className="pq-source-cards">
              {SOURCES.map((s) => (
                <button key={s.value} className={type === s.value ? "actif" : ""} onClick={() => setType(s.value)}>
                  {s.icon}<b>{s.label}</b><small>{s.desc}</small>
                </button>
              ))}
            </div>
            <div className="pq-champs">
              <label>Nom de la requête<input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ventes agences octobre" /></label>
              {type === "rest" && (
                <>
                  <label>URL de l'API<input value={cfg.url || ""} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} placeholder="https://api.exemple.cm/ventes" /></label>
                  <label>Chemin des données<input value={cfg.chemin_donnees || ""} onChange={(e) => setCfg({ ...cfg, chemin_donnees: e.target.value })} placeholder="data.commandes" /></label>
                  <label>Authentification
                    <select value={cfg.auth?.mode || "aucun"} onChange={(e) => setCfg({ ...cfg, auth: { ...(cfg.auth || {}), mode: e.target.value } })}>
                      <option value="aucun">Aucune</option><option value="api_key">Clé API</option><option value="bearer">Bearer</option><option value="basic">Basic</option><option value="oauth2">OAuth2</option>
                    </select>
                  </label>
                  {cfg.auth?.mode === "oauth2" && (
                    <>
                      <label>URL du jeton<input value={cfg.auth.token_url || ""} onChange={(e) => setCfg({ ...cfg, auth: { ...cfg.auth, token_url: e.target.value } })} /></label>
                      <label>Client ID<input value={cfg.auth.client_id || ""} onChange={(e) => setCfg({ ...cfg, auth: { ...cfg.auth, client_id: e.target.value } })} /></label>
                      <label>Client secret<input type="password" value={cfg.auth.client_secret || ""} onChange={(e) => setCfg({ ...cfg, auth: { ...cfg.auth, client_secret: e.target.value } })} /></label>
                    </>
                  )}
                </>
              )}
              {type === "excel" && (
                <div className="pq-excel-modes">
                  <div className="pq-modes-tabs">
                    <button className={excelMode === "com" ? "actif" : ""} onClick={() => setExcelMode("com")}>Excel installé</button>
                    <button className={excelMode === "parcourir" ? "actif" : ""} onClick={() => setExcelMode("parcourir")}>Parcourir le poste</button>
                    <button className={excelMode === "depot" ? "actif" : ""} onClick={() => setExcelMode("depot")}>Glisser-déposer</button>
                  </div>

                  {excelMode === "com" && (
                    <div className="pq-excel-com">
                      <div className="pq-com-etat">
                        <span>{comStatut?.connecte ? "Connecté à Microsoft Excel " + comStatut.version : "Microsoft Excel n'est pas ouvert"}</span>
                        <div className="pq-com-actions">
                          {comStatut?.connecte ? (
                            <>
                              <button className="pq-bouton" onClick={actualiserExcel} disabled={busy}>
                                <RefreshIcon fontSize="small" /> Actualiser
                              </button>
                              <button className="pq-bouton danger" onClick={deconnecterExcel} disabled={busy}>
                                <CloseIcon fontSize="small" /> Déconnecter le compte
                              </button>
                            </>
                          ) : (
                            <button className="pq-bouton plein" onClick={connecterExcel} disabled={busy}>
                              <GridViewIcon fontSize="small" /> Ouvrir Excel
                            </button>
                          )}
                        </div>
                      </div>
                      {comStatut?.erreur && <p className="pq-aide">{comStatut.erreur}</p>}
                      {!comStatut?.connecte && (
                        <p className="pq-aide">Ouvrez Excel pour voir vos classeurs actifs, puis choisissez celui que vous voulez charger.</p>
                      )}
                      {comStatut?.connecte && (
                        <div className="pq-com-connecte">
                          <div className="pq-ouvrir-chemin">
                            <input value={cheminOuvrir} onChange={(e) => setCheminOuvrir(e.target.value)}
                              placeholder="Chemin d'un classeur à ouvrir dans Excel" />
                            <button className="pq-bouton" onClick={() => ouvrirClasseurCom(cheminOuvrir)} disabled={!cheminOuvrir || busy}>
                              Ouvrir le classeur
                            </button>
                          </div>
                          <div className="pq-com-listes">
                            <div className="pq-com-colonne">
                              <b>Fichiers Excel actifs</b>
                              {comClasseurs.length === 0 && <p className="pq-vide">Aucun classeur ouvert. Ouvrez-en un depuis Excel ou avec le champ ci-dessus.</p>}
                              {comClasseurs.map((wb) => (
                                <div key={wb.nom} className={"pq-classeur" + (classeurChoisi === wb.nom ? " actif" : "")}>
                                  <button className="pq-classeur-nom" onClick={() => {
                                    setClasseurChoisi(wb.nom);
                                    setFeuilleCom(wb.feuilles[0]?.nom || "");
                                    setApercuCom(null);
                                  }}>
                                    <GridViewIcon fontSize="small" /> {wb.nom}
                                  </button>
                                  <button className="pq-classeur-ouvrir" onClick={() => {
                                    setClasseurChoisi(wb.nom);
                                    const premiere = wb.feuilles[0]?.nom || "";
                                    setFeuilleCom(premiere);
                                    if (premiere) lireClasseurCom(wb.nom, premiere);
                                  }}>Ouvrir</button>
                                </div>
                              ))}
                            </div>
                        <div className="pq-com-colonne">
                          <b>Feuilles</b>
                          {(comClasseurs.find((w) => w.nom === classeurChoisi)?.feuilles || []).map((f) => (
                            <button key={f.nom} className={feuilleCom === f.nom ? "actif" : ""}
                              onClick={() => { setFeuilleCom(f.nom); lireClasseurCom(classeurChoisi, f.nom); }}>
                              <TableChartIcon fontSize="small" /> {f.nom}
                            </button>
                          ))}
                        </div>
                      </div>
                      {apercuCom && (
                        <div className="pq-exp-apercu">
                          <span>{apercuCom.total} lignes · plage {apercuCom.plage}</span>
                          <div className="pq-exp-table">
                            <table><thead><tr>{apercuCom.en_tetes?.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                              <tbody>{apercuCom.lignes?.slice(0, 4).map((l, i) => <tr key={i}>{apercuCom.en_tetes?.map((c) => <td key={c}>{String(l[c] ?? "").slice(0, 22)}</td>)}</tr>)}</tbody>
                            </table>
                          </div>
                        </div>
                      )}
                        <button className="pq-bouton plein" onClick={chargerFeuilleCom} disabled={!apercuCom || busy}>
                          Charger cette feuille dans la requête
                        </button>
                        </div>
                      )}
                    </div>
                  )}

                  {excelMode === "parcourir" && (
                    <div className="pq-explorateur">
                  <div className="pq-exp-racines">
                    {racines.map((r) => <button key={r} onClick={() => ouvrirDossier(r)}>{r.split("\\").pop()}</button>)}
                  </div>
                  <div className="pq-exp-barre">
                    <span>{dossier?.chemin || "Choisir un dossier"}</span>
                    {dossier?.parent && <button onClick={() => ouvrirDossier(dossier.parent)}>Retour</button>}
                  </div>
                  <div className="pq-exp-liste">
                    {fichiers.dossiers?.map((d) => (
                      <button key={d.chemin} onClick={() => ouvrirDossier(d.chemin)}><FolderOpenIcon fontSize="small" /> {d.nom}</button>
                    ))}
                    {fichiers.fichiers?.map((f) => (
                      <button key={f.chemin} className={fichierChoisi?.chemin === f.chemin ? "actif" : ""} onClick={() => choisirFichier(f)}><GridViewIcon fontSize="small" /> {f.nom}</button>
                    ))}
                  </div>
                  {feuilles.length > 0 && (
                    <div className="pq-exp-feuilles">
                      <span>Feuille</span>
                      {feuilles.map((f) => (
                        <button key={f} className={feuilleChoisie === f ? "actif" : ""} onClick={async () => {
                          setFeuilleChoisie(f);
                          const a = await api.get("/api/fichiers/apercu?chemin=" + encodeURIComponent(fichierChoisi.chemin) + "&feuille=" + encodeURIComponent(f));
                          setApercuFichier(a);
                          setCfg((c) => ({ ...c, feuille: f }));
                        }}>{f}</button>
                      ))}
                    </div>
                  )}
                  {apercuFichier && (
                    <div className="pq-exp-apercu">
                      <span>{apercuFichier.lignes?.length || 0} lignes · {apercuFichier.en_tetes?.length || 0} colonnes</span>
                      <div className="pq-exp-table">
                        <table><thead><tr>{apercuFichier.en_tetes?.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                          <tbody>{apercuFichier.lignes?.slice(0, 4).map((l, i) => <tr key={i}>{apercuFichier.en_tetes?.map((c) => <td key={c}>{String(l[c] ?? "").slice(0, 22)}</td>)}</tr>)}</tbody>
                        </table>
                      </div>
                    </div>
                  )}
                    <button className="pq-bouton plein" onClick={chargerFeuille} disabled={!fichierChoisi || busy}>Charger cette feuille</button>
                    </div>
                    )}

                    {excelMode === "depot" && (
                      <div className="pq-depot">
                        <div
                          className={"pq-dropzone" + (glisse ? " survol" : "")}
                          onDragOver={(e) => { e.preventDefault(); setGlisse(true); }}
                          onDragLeave={() => setGlisse(false)}
                          onDrop={(e) => { e.preventDefault(); setGlisse(false); deposerFichier(e.dataTransfer.files?.[0]); }}
                        >
                          <CloudQueueIcon style={{ fontSize: 38, color: "#635bff" }} />
                          <b>Déposez votre classeur ici</b>
                          <span>xlsx, xls, xlsm ou csv · 24 Mo maximum</span>
                          <label className="pq-bouton">
                            Choisir un fichier
                            <input type="file" accept=".xlsx,.xls,.xlsm,.csv" hidden onChange={(e) => deposerFichier(e.target.files?.[0])} />
                          </label>
                        </div>
                        {depot && (
                          <div className="pq-exp-apercu">
                            <span>{depot.nom} · {depot.total} lignes</span>
                            <div className="pq-exp-table">
                              <table><thead><tr>{depot.en_tetes?.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                                <tbody>{depot.lignes?.slice(0, 4).map((l, i) => <tr key={i}>{depot.en_tetes?.map((c) => <td key={c}>{String(l[c] ?? "").slice(0, 22)}</td>)}</tr>)}</tbody>
                              </table>
                            </div>
                          </div>
                        )}
                        <button className="pq-bouton plein" onClick={chargerDepot} disabled={!depot || busy}>
                          Charger ce fichier dans la requête
                        </button>
                      </div>
                    )}
                  </div>
                )}
              {(type === "dossier" || type === "pdf") && (
                <div className="pq-explorateur">
                  <div className="pq-exp-racines">
                    {racines.map((r) => <button key={r} onClick={() => ouvrirDossier(r)}>{r.split("\\").pop()}</button>)}
                  </div>
                  <div className="pq-exp-barre">
                    <span>{dossier?.chemin || "Choisir un dossier"}</span>
                    {dossier?.parent && <button onClick={() => ouvrirDossier(dossier.parent)}>Retour</button>}
                  </div>
                  <div className="pq-exp-liste">
                    {fichiers.dossiers?.map((d) => <button key={d.chemin} onClick={() => ouvrirDossier(d.chemin)}><FolderOpenIcon fontSize="small" /> {d.nom}</button>)}
                    {fichiers.fichiers?.map((f) => <button key={f.chemin} className={fichierChoisi?.chemin === f.chemin ? "actif" : ""} onClick={() => choisirFichier(f)}><GridViewIcon fontSize="small" /> {f.nom}</button>)}
                  </div>
                  {apercuFichier && (
                    <div className="pq-exp-apercu">
                      <span>{apercuFichier.lignes?.length || 0} lignes</span>
                      <div className="pq-exp-table">
                        <table><thead><tr>{apercuFichier.en_tetes?.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                          <tbody>{apercuFichier.lignes?.slice(0, 4).map((l, i) => <tr key={i}>{apercuFichier.en_tetes?.map((c) => <td key={c}>{String(l[c] ?? "").slice(0, 22)}</td>)}</tr>)}</tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  <button className="pq-bouton plein" onClick={chargerFeuille} disabled={!fichierChoisi || busy}>Charger cette source</button>
                </div>
              )}
              {type === "sftp" && (
                <>
                  <label>Hôte<input value={cfg.hote || ""} onChange={(e) => setCfg({ ...cfg, hote: e.target.value })} /></label>
                  <label>Utilisateur<input value={cfg.utilisateur || ""} onChange={(e) => setCfg({ ...cfg, utilisateur: e.target.value })} /></label>
                  <label>Mot de passe<input type="password" value={cfg.mot_de_passe || ""} onChange={(e) => setCfg({ ...cfg, mot_de_passe: e.target.value })} /></label>
                  <label>Chemin distant<input value={cfg.chemin || ""} onChange={(e) => setCfg({ ...cfg, chemin: e.target.value })} /></label>
                </>
              )}
              {type === "csv_url" && <label>URL du fichier<input value={cfg.url || ""} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} /></label>}
            </div>
            <div className="pq-dialogue-actions">
              <button className="pq-bouton" onClick={async () => { const ok = await tester(configuration()); if (ok) setDialogue(null); }} disabled={busy}>
                <RefreshIcon fontSize="small" /> Tester la connexion
              </button>
              <button className="pq-bouton plein" onClick={enregistrer} disabled={busy}><SaveIcon fontSize="small" /> Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {dialogue === "etape" && selection >= 0 && (
        <div className="pq-modal" onClick={() => setDialogue(null)}>
          <div className="pq-dialogue etape" onClick={(e) => e.stopPropagation()}>
            <div className="pq-dialogue-head">
              <div><h2>{libelleEtape(etapes[selection])}</h2><p>Étape {selection + 1} sur {etapes.length}</p></div>
              <button onClick={() => setDialogue(null)}><CloseIcon /></button>
            </div>
            <EditeurEtape etape={etapes[selection]} colonnes={colonnes} onChange={majEtape} />
            <div className="pq-dialogue-actions">
              <button className="pq-bouton" onClick={() => setDialogue(null)}>Annuler</button>
              <button className="pq-bouton plein" onClick={async () => { setDialogue(null); await tester(); }} disabled={busy}>
                <CheckCircleIcon fontSize="small" /> Appliquer et prévisualiser
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditeurEtape({ etape, colonnes, onChange }) {
  const a = etape.action;
  if (a === "selectColumns") {
    return <div className="pq-champs"><label>Colonnes à conserver (une par ligne)
      <textarea rows="6" value={(etape.colonnes || []).join("\n")} onChange={(e) => onChange({ colonnes: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />
    </label><p className="pq-aide">Les autres colonnes seront écartées de la requête.</p></div>;
  }
  if (a === "renameColumns") {
    return <div className="pq-champs"><label>Renommages (ancien: nouveau, un par ligne)
      <textarea rows="6" defaultValue={Object.entries(etape.renommages || {}).map(([k, v]) => k + ": " + v).join("\n")}
        onChange={(e) => { const o = {}; e.target.value.split("\n").forEach((l) => { const i = l.indexOf(":"); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }); onChange({ renommages: o }); }} />
    </label></div>;
  }
  if (a === "filterRows") {
    return <div className="pq-champs">
      <label>Colonne<select value={etape.colonne || ""} onChange={(e) => onChange({ colonne: e.target.value })}><option value="">Choisir</option>{colonnes.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label>Opérateur<select value={etape.operateur || "contient"} onChange={(e) => onChange({ operateur: e.target.value })}>
        <option value="egale">Égal à</option><option value="contient">Contient</option><option value="non_vide">Non vide</option><option value="superieur">Supérieur à</option><option value="inferieur">Inférieur à</option>
      </select></label>
      <label>Valeur<input value={etape.valeur || ""} onChange={(e) => onChange({ valeur: e.target.value })} /></label>
    </div>;
  }
  if (a === "addColumn") {
    return <div className="pq-champs">
      <label>Nom de la colonne<input value={etape.nom || ""} onChange={(e) => onChange({ nom: e.target.value })} /></label>
      <label>Expression<input value={etape.expression || ""} onChange={(e) => onChange({ expression: e.target.value })} placeholder="prix_unit * qte" /></label>
      <p className="pq-aide">Noms de colonnes, nombres et opérations arithmétiques uniquement.</p>
    </div>;
  }
  if (a === "changeType") {
    return <div className="pq-champs">
      <label>Colonne<select value={etape.colonne || ""} onChange={(e) => onChange({ colonne: e.target.value })}><option value="">Choisir</option>{colonnes.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label>Nouveau type<select value={etape.type || "texte"} onChange={(e) => onChange({ type: e.target.value })}><option value="texte">Texte</option><option value="nombre">Nombre</option><option value="date">Date</option></select></label>
    </div>;
  }
  if (a === "removeRows") {
    return <div className="pq-champs"><label>Nombre de lignes à retirer en haut<input type="number" min="0" value={etape.nombre || 0} onChange={(e) => onChange({ nombre: Number(e.target.value) })} /></label></div>;
  }
  if (a === "mapToSales") {
    const CHAMPS = ["ref", "jour", "canal", "region", "ville", "point_vente", "vendeur", "produit", "famille", "qte", "prix_unit", "remise_pct", "montant", "cout_unit", "devise"];
    return <div className="pq-mapping">
      {CHAMPS.map((c) => (
        <label key={c}>{c}
          <select value={(etape.mapping || {})[c] || ""} onChange={(e) => onChange({ mapping: { ...(etape.mapping || {}), [c]: e.target.value } })}>
            <option value="">Ne pas mapper</option>{colonnes.map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
      ))}
    </div>;
  }
  return null;
}
