import { useCallback, useEffect, useState } from "react";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import TableChartIcon from "@mui/icons-material/TableChart";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { api } from "../api";
import { PageHead, Spinner, Toast } from "../components";

const CHAMPS = [
  ["ref", "Référence"], ["jour", "Date"], ["canal", "Canal"], ["region", "Région"],
  ["ville", "Ville"], ["point_vente", "Point de vente"], ["vendeur", "Vendeur"],
  ["produit", "Produit"], ["famille", "Famille"], ["qte", "Quantité"],
  ["prix_unit", "Prix unitaire"], ["remise_pct", "Remise"], ["montant", "Montant"],
  ["cout_unit", "Coût unitaire"], ["devise", "Devise"],
];

const OBLIGATOIRES = ["jour", "produit", "qte", "prix_unit"];

export default function MesFichiers() {
  const [racines, setRacines] = useState([]);
  const [dossier, setDossier] = useState(null);
  const [contenu, setContenu] = useState({ dossiers: [], fichiers: [] });
  const [fichier, setFichier] = useState(null);
  const [feuilles, setFeuilles] = useState([]);
  const [feuille, setFeuille] = useState("");
  const [apercu, setApercu] = useState(null);
  const [mapping, setMapping] = useState({});
  const [mode, setMode] = useState("ignorer");
  const [resultat, setResultat] = useState(null);
  const [toast, setToast] = useState(null);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    api.get("/api/fichiers/racines").then((r) => {
      setRacines(r.racines || []);
      if (r.racines?.length) ouvrir(r.racines[0]);
    }).catch((ex) => setToast({ message: ex.message, tone: "error" }));
  }, []);

  const ouvrir = useCallback(async (chemin) => {
    setOccupe(true);
    try {
      const r = await api.get("/api/fichiers/lister?chemin=" + encodeURIComponent(chemin));
      setDossier(r);
      setContenu(r);
      setFichier(null);
      setApercu(null);
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setOccupe(false);
  }, []);

  const choisirFichier = async (f) => {
    setFichier(f);
    setResultat(null);
    setOccupe(true);
    try {
      const r = await api.get("/api/fichiers/feuilles?chemin=" + encodeURIComponent(f.chemin));
      setFeuilles(r.feuilles || []);
      setFeuille(r.feuilles?.[0] || "");
      const a = await api.get("/api/fichiers/apercu?chemin=" + encodeURIComponent(f.chemin) +
        (r.feuilles?.length ? "&feuille=" + encodeURIComponent(r.feuilles[0]) : ""));
      setApercu(a);
      const colonnes = a.en_tetes || [];
      const auto = {};
      for (const [champ] of CHAMPS) {
        const trouvée = colonnes.find((c) => c.toLowerCase().replace(/[^a-z0-9]/g, "") === champ);
        if (trouvée) auto[champ] = trouvée;
      }
      setMapping(auto);
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setOccupe(false);
  };

  const voirFeuille = async (nom) => {
    setFeuille(nom);
    try {
      const a = await api.get("/api/fichiers/apercu?chemin=" + encodeURIComponent(fichier.chemin) +
        "&feuille=" + encodeURIComponent(nom));
      setApercu(a);
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
  };

  const importer = async () => {
    const manquants = OBLIGATOIRES.filter((c) => !mapping[c]);
    if (manquants.length) {
      setToast({ message: "Colonnes à mapper : " + manquants.join(", "), tone: "error" });
      return;
    }
    setOccupe(true);
    try {
      const r = await api.post("/api/fichiers/importer", {
        chemin: fichier.chemin, feuille, mapping, mode,
      });
      setResultat(r);
      setToast({
        message: r.integrees + " lignes ajoutées, " + r.mises_a_jour + " mises à jour, " + r.rejets + " rejets",
        tone: r.ok ? "success" : "error",
      });
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    }
    setOccupe(false);
  };

  return (
    <div className="page">
      <PageHead
        eyebrow="Données locales"
        title="Importer depuis Excel"
        subtitle="Choisissez un classeur sur votre poste, vérifiez les colonnes, puis intégrez les lignes."
      />
      <Toast toast={toast} />

      <div className="fichiers-grid">
        <section className="fichiers-panel">
          <h2><FolderIcon /> Vos dossiers</h2>
          <div className="racines">
            {racines.map((r) => (
              <button key={r} className="racine" onClick={() => ouvrir(r)}>{r}</button>
            ))}
          </div>
          {dossier?.parent && (
            <button className="remonter" onClick={() => ouvrir(dossier.parent)}><ArrowUpwardIcon /> Dossier parent</button>
          )}
          <div className="liste-fichiers">
            {contenu.dossiers?.map((d) => (
              <button key={d.chemin} className="ligne-fichier" onClick={() => ouvrir(d.chemin)}>
                <FolderIcon /><span>{d.nom}</span>
              </button>
            ))}
            {contenu.fichiers?.map((f) => (
              <button key={f.chemin} className={"ligne-fichier" + (fichier?.chemin === f.chemin ? " actif" : "")}
                onClick={() => choisirFichier(f)}>
                <InsertDriveFileIcon /><span>{f.nom}</span><small>{f.modifie}</small>
              </button>
            ))}
            {!contenu.fichiers?.length && !contenu.dossiers?.length && !occupe && (
              <p className="hint">Aucun classeur dans ce dossier.</p>
            )}
          </div>
        </section>

        <section className="fichiers-panel large">
          <h2><TableChartIcon /> Aperçu et colonnes</h2>
          {!fichier && <p className="hint">Sélectionnez un classeur à gauche.</p>}
          {fichier && (
            <>
              <div className="fichier-titre"><b>{fichier.nom}</b><span>{fichier.taille} octets</span></div>
              {feuilles.length > 1 && (
                <div className="onglets-feuilles">
                  {feuilles.map((f) => (
                    <button key={f} className={feuille === f ? "actif" : ""} onClick={() => voirFeuille(f)}>{f}</button>
                  ))}
                </div>
              )}
              {occupe && <Spinner label="Lecture du classeur" />}
              {apercu && (
                <>
                  <div className="table-scroll">
                    <table>
                      <thead><tr>{apercu.en_tetes?.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                      <tbody>
                        {apercu.lignes?.slice(0, 10).map((l, i) => (
                          <tr key={i}>{apercu.en_tetes?.map((c) => <td key={c}>{String(l[c] ?? "").slice(0, 28)}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <h3>Mapping des colonnes</h3>
                  <div className="mapping-grid">
                    {CHAMPS.map(([champ, label]) => (
                      <label key={champ} className={OBLIGATOIRES.includes(champ) ? "requis" : ""}>
                        {label}
                        <select value={mapping[champ] || ""} onChange={(e) => setMapping({ ...mapping, [champ]: e.target.value })}>
                          <option value="">Ne pas importer</option>
                          {apercu.en_tetes?.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>

                  <div className="import-actions">
                    <label>En cas de référence existante
                      <select value={mode} onChange={(e) => setMode(e.target.value)}>
                        <option value="ignorer">Ignorer les doublons</option>
                        <option value="mettre_a_jour">Mettre à jour la ligne</option>
                      </select>
                    </label>
                    <button className="btn btn-brand btn-lg" onClick={importer} disabled={occupe}>
                      <CloudUploadIcon /> Importer {apercu.lignes?.length} lignes
                    </button>
                  </div>

                  {resultat && (
                    <div className="resultat-import">
                      <CheckCircleIcon />
                      <div>
                        <b>{resultat.integrees} lignes ajoutées</b>
                        <span>{resultat.mises_a_jour} mises à jour · {resultat.rejets} rejets</span>
                        {resultat.erreurs?.length > 0 && (
                          <ul>{resultat.erreurs.map((e, i) => <li key={i}>{e}</li>)}</ul>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
