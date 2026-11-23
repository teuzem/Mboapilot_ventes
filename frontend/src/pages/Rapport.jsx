import { useCallback, useEffect, useMemo, useState } from "react";
import PrintIcon from "@mui/icons-material/Print";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import RefreshIcon from "@mui/icons-material/Refresh";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import FingerprintIcon from "@mui/icons-material/Fingerprint";
import PlaceIcon from "@mui/icons-material/Place";
import CategoryIcon from "@mui/icons-material/Category";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import InsightsIcon from "@mui/icons-material/Insights";
import DescriptionIcon from "@mui/icons-material/Description";
import { api, dateFR, fmt } from "../api";
import { useAuth } from "../auth";
import { PageHead, Spinner, Toast } from "../components";

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function periodeLisible(debut, fin) {
  if (!debut || !fin) return "—";
  const d = new Date(debut + "T00:00:00");
  const f = new Date(fin + "T00:00:00");
  if (Number.isNaN(d.getTime()) || Number.isNaN(f.getTime())) return `${debut} → ${fin}`;
  return `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()} → ${f.getDate()} ${MOIS[f.getMonth()]} ${f.getFullYear()}`;
}

export default function Rapport() {
  const { user } = useAuth();
  const [r, setR] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [toast, setToast] = useState(null);
  const [envoi, setEnvoi] = useState("");

  const message = (txt, tone = "success") => setToast({ message: txt, tone });

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const data = await api.get("/api/rapport");
      setR(data);
    } catch (ex) {
      message(ex.message, "error");
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const exporter = async (format) => {
    setEnvoi(format);
    try {
      const nom = await api.download(`/api/export/${format}`, `mboapilot-rapport.${format === "xlsx" ? "xlsx" : "csv"}`);
      message(`Export téléchargé : ${nom}`);
    } catch (ex) {
      message(ex.message, "error");
    }
    setEnvoi("");
  };

  const totalRegions = useMemo(() => (r?.regions || []).reduce((s, x) => s + Number(x.ca || 0), 0), [r]);
  const totalFamilles = useMemo(() => (r?.familles || []).reduce((s, x) => s + Number(x.ca || 0), 0), [r]);
  const marge = useMemo(() => (r?.familles || []).reduce((s, x) => s + Number(x.mg || 0), 0), [r]);
  const panier = r?.nb ? Math.round(r.ca / r.nb) : 0;

  return (
    <>
      <PageHead
        eyebrow="Reporting certifié"
        title="Rapport des ventes"
        sub="Synthèse 12 mois glissants sur votre périmètre, scellée par une empreinte SHA-256. Prêt à imprimer ou à joindre à un dossier de conformité."
        actions={
          <>
            <button className="btn btn-outline" onClick={() => exporter("csv")} disabled={Boolean(envoi)}>
              <FileDownloadIcon /> CSV
            </button>
            <button className="btn btn-outline" onClick={() => exporter("xlsx")} disabled={Boolean(envoi)}>
              <FileDownloadIcon /> Excel
            </button>
            <button className="btn btn-brand" onClick={() => window.print()}>
              <PrintIcon /> Imprimer / PDF
            </button>
          </>
        }
      />

      <div className="report-page">
        {chargement && !r ? (
          <div className="panel report-loading"><Spinner label="Génération du rapport signé…" /></div>
        ) : !r ? (
          <div className="panel report-loading">
            <p>Le rapport n'a pas pu être généré.</p>
            <button className="btn btn-brand" onClick={charger}><RefreshIcon /> Réessayer</button>
          </div>
        ) : (
          <>
            <div className="report-toolbar">
              <div className="row-actions">
                <span className="badge b-green"><VerifiedUserIcon style={{ fontSize: 12, verticalAlign: "-2px" }} /> Document scellé</span>
                <span className="badge b-gray">Périmètre {user?.perimetre || "National"}</span>
                <span className="badge b-brand">12 mois glissants</span>
              </div>
              <div className="row-actions">
                <span className="faint" style={{ fontSize: 10.5 }}>Empreinte {r.emp}</span>
                <button className="btn btn-ghost" onClick={charger} disabled={chargement}><RefreshIcon /> Régénérer</button>
              </div>
            </div>

            <article className="report-sheet">
              <header className="report-brand">
                <div>
                  <div className="wordmark" style={{ marginBottom: 12 }}>
                    <img src="/logo.svg" alt="" />
                    <b>mboapilot</b>
                  </div>
                  <span className="page-eyebrow">Rapport officiel des ventes</span>
                  <h1>Synthèse commerciale</h1>
                  <p style={{ fontSize: 10.5, color: "var(--faint)", margin: 0 }}>
                    Édité le {r.horo} · Référence {r.emp}
                  </p>
                </div>
                <div>
                  <b>MBOAPILOT SAS</b><br />
                  Pilotage commercial · Afrique centrale<br />
                  Devise de référence : FCFA<br />
                  Document généré automatiquement<br />
                  Usage interne · diffusion contrôlée
                </div>
              </header>

              <div className="report-meta-grid">
                <div><small>Période couverte</small><b>{periodeLisible(r.debut, r.fin)}</b></div>
                <div><small>Périmètre</small><b>{user?.role} · {user?.perimetre || "National"}</b></div>
                <div><small>Émis par</small><b>{user?.nom || user?.login}</b></div>
                <div><small>Horodatage UTC</small><b>{r.horo}</b></div>
              </div>

              <div className="report-kpis">
                <div className="report-kpi">
                  <small>Chiffre d'affaires</small>
                  <b>{fmt(r.ca)} <span style={{ fontSize: 9 }}>FCFA</span></b>
                  <span>{r.nb} transactions sur la période</span>
                </div>
                <div className="report-kpi">
                  <small>Panier moyen</small>
                  <b>{fmt(panier)} <span style={{ fontSize: 9 }}>FCFA</span></b>
                  <span>par ticket encaissé</span>
                </div>
                <div className="report-kpi">
                  <small>Marge brute estimée</small>
                  <b>{fmt(marge)} <span style={{ fontSize: 9 }}>FCFA</span></b>
                  <span>{r.ca ? `${Math.round((marge / r.ca) * 100)} % du CA` : "—"}</span>
                </div>
                <div className="report-kpi">
                  <small>Régions actives</small>
                  <b>{(r.regions || []).length}</b>
                  <span>{(r.familles || []).length} famille(s) de produits</span>
                </div>
              </div>

              <section className="report-section">
                <h2><InsightsIcon style={{ fontSize: 14, color: "var(--brand)" }} /> Lecture de la période <span>Synthèse</span></h2>
                <p style={{ fontSize: 10.5, lineHeight: 1.65, color: "var(--muted)", margin: 0 }}>
                  Sur les douze derniers mois, l'activité représente <b>{fmt(r.ca)} FCFA</b> pour <b>{r.nb}</b> transactions,
                  soit un panier moyen de <b>{fmt(panier)} FCFA</b>. La marge brute estimée s'établit à <b>{fmt(marge)} FCFA</b>.
                  Les analyses ci-dessous détaillent la contribution des produits, des régions et des familles sur le périmètre
                  de l'utilisateur émetteur.
                </p>
              </section>

              <div className="report-two">
                <section className="report-section">
                  <h2><EmojiEventsIcon style={{ fontSize: 14, color: "var(--brand)" }} /> Top 10 produits <span>Classement par CA</span></h2>
                  <table className="report-table">
                    <thead>
                      <tr><th>#</th><th>Produit</th><th className="num">Quantité</th><th className="num">CA (FCFA)</th><th className="num">Part</th></tr>
                    </thead>
                    <tbody>
                      {(r.top || []).map((t, i) => (
                        <tr key={t.produit}>
                          <td>{i + 1}</td>
                          <td>{t.produit}</td>
                          <td className="num">{fmt(t.q)}</td>
                          <td className="num">{fmt(t.ca)}</td>
                          <td className="num">{r.ca ? `${((t.ca / r.ca) * 100).toFixed(1)} %` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(r.top || []).length === 0 && <p className="faint" style={{ fontSize: 10 }}>Aucun produit sur la période.</p>}
                </section>

                <section className="report-section">
                  <h2><PlaceIcon style={{ fontSize: 14, color: "var(--brand)" }} /> Régions</h2>
                  <table className="report-table">
                    <thead>
                      <tr><th>Région</th><th className="num">CA</th><th>Poids</th></tr>
                    </thead>
                    <tbody>
                      {(r.regions || []).map((x) => (
                        <tr key={x.region}>
                          <td>{x.region}</td>
                          <td className="num">{fmt(x.ca)}</td>
                          <td>
                            <div className="report-bar"><i style={{ width: `${totalRegions ? Math.max(2, (x.ca / totalRegions) * 100) : 0}%` }} /></div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(r.regions || []).length === 0 && <p className="faint" style={{ fontSize: 10 }}>Aucune région sur la période.</p>}
                </section>
              </div>

              <section className="report-section">
                <h2><CategoryIcon style={{ fontSize: 14, color: "var(--brand)" }} /> Familles de produits <span>CA & marge</span></h2>
                <table className="report-table">
                  <thead>
                    <tr><th>Famille</th><th className="num">CA (FCFA)</th><th className="num">Marge (FCFA)</th><th className="num">Taux de marge</th><th>Poids dans le CA</th></tr>
                  </thead>
                  <tbody>
                    {(r.familles || []).map((x) => (
                      <tr key={x.famille}>
                        <td><b>{x.famille}</b></td>
                        <td className="num">{fmt(x.ca)}</td>
                        <td className="num">{fmt(x.mg)}</td>
                        <td className="num">{x.ca ? `${((x.mg / x.ca) * 100).toFixed(1)} %` : "—"}</td>
                        <td><div className="report-bar"><i style={{ width: `${totalFamilles ? Math.max(2, (x.ca / totalFamilles) * 100) : 0}%` }} /></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(r.familles || []).length === 0 && <p className="faint" style={{ fontSize: 10 }}>Aucune famille sur la période.</p>}
              </section>

              <section className="report-section">
                <h2><DescriptionIcon style={{ fontSize: 14, color: "var(--brand)" }} /> Méthodologie & sources <span>Traçabilité</span></h2>
                <div style={{ fontSize: 9, color: "var(--muted)", lineHeight: 1.7 }}>
                  Les montants sont exprimés en francs CFA (FCFA), hors taxes et hors frais de transport. Les ventes sont
                  comptabilisées à leur date de référence. La marge brute correspond au montant encaissé diminué du coût
                  unitaire renseigné. Les objectifs sont calculés sur la base de l'année précédente majorée de 10 %.
                  Le périmètre de lecture dépend des habilitations du compte émetteur.
                </div>
              </section>

              <div className="report-signature">
                <div>
                  <b>Vérification d'intégrité</b><br />
                  Ce rapport est scellé par l'empreinte SHA-256 <span className="mono">{r.emp}</span>, calculée sur le contenu
                  agrégé de la période. Toute modification des chiffres source invalide ce sceau lors d'une nouvelle
                  génération. La génération de ce document a été inscrite dans le journal d'audit chaîné de la plateforme.
                  <br /><br />
                  Document émis par MboaPilot · {r.horo} · {user?.login}
                </div>
                <div className="report-seal">
                  <b>MBOAPILOT</b>
                  <span>{r.emp}</span>
                  <small>SCEAU NUMÉRIQUE</small>
                </div>
              </div>

              <footer className="report-foot">
                MboaPilot SAS · Pilotage commercial pour l'Afrique centrale · FCFA<br />
                Ce document est généré automatiquement. En cas de divergence, la version scellée en base de données prévaut.<br />
                Page 1 / 1 · Empreinte {r.emp} · {r.horo}
              </footer>
            </article>
          </>
        )}
      </div>

      <Toast message={toast?.message} tone={toast?.tone} onClose={() => setToast(null)} />
    </>
  );
}
