import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area, Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import InsightsIcon from "@mui/icons-material/Insights";
import ShoppingBasketIcon from "@mui/icons-material/ShoppingBasket";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import PointOfSaleIcon from "@mui/icons-material/PointOfSale";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import DescriptionIcon from "@mui/icons-material/Description";
import GroupIcon from "@mui/icons-material/Group";
import HandshakeIcon from "@mui/icons-material/Handshake";
import PlaceIcon from "@mui/icons-material/Place";
import DonutLargeIcon from "@mui/icons-material/DonutLarge";
import CategoryIcon from "@mui/icons-material/Category";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import StorefrontIcon from "@mui/icons-material/Storefront";
import BoltIcon from "@mui/icons-material/Bolt";
import ShieldIcon from "@mui/icons-material/Shield";
import { api, dateFR, fmt, fmtCompact } from "../api";
import { useAuth } from "../auth";
import { Badge, Empty, PageHead, Spinner, Toast } from "../components";

const PERIODES = [
  ["30", "30 derniers jours"],
  ["90", "90 derniers jours"],
  ["365", "12 mois glissants"],
  ["", "Tout l'historique"],
];

const ICONES_ALERTE = {
  critique: <ErrorOutlineIcon />,
  alerte: <WarningAmberIcon />,
  info: <InfoOutlinedIcon />,
  succes: <CheckCircleOutlineIcon />,
};

const COULEURS_CANAL = { POS: "#0A2540", Agence: "#635BFF", "E-commerce": "#00D4FF" };
const COULEURS_FAMILLE = ["#635BFF", "#00C07F", "#00D4FF", "#FFC247", "#FF5996", "#8B84FF", "#C2C9D4"];

function Delta({ value, suffix = " %" }) {
  if (value === null || value === undefined) return <span className="faint">-</span>;
  const positif = Number(value) >= 0;
  return (
    <span className={positif ? "up" : "down"}>
      {positif ? <TrendingUpIcon style={{ fontSize: 13 }} /> : <TrendingDownIcon style={{ fontSize: 13 }} />}
      {positif ? "+" : ""}{value}{suffix}
    </span>
  );
}

function initiales(nom) {
  return String(nom || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join("");
}

function lireFiltres() {
  const p = new URLSearchParams(window.location.search);
  return {
    periode: p.has("periode") ? p.get("periode") : "365",
    region: p.get("region") || "",
    canal: p.get("canal") || "",
    famille: p.get("famille") || "",
    vendeur: p.get("vendeur") || "",
    produit: p.get("produit") || "",
  };
}

export default function Dashboard() {
  const { user, can } = useAuth();
  const [filtres, setFiltres] = useState(lireFiltres);
  const [options, setOptions] = useState(null);
  const [data, setData] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [live, setLive] = useState(null);
  const [liveOk, setLiveOk] = useState(false);
  const [toast, setToast] = useState(null);
  const [envoi, setEnvoi] = useState("");
  const premier = useRef(true);

  const message = (txt, tone = "success") => setToast({ message: txt, tone });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filtres).forEach(([k, v]) => { if (v !== "" && v !== null) p.set(k, v); });
    return p.toString();
  }, [filtres]);

  const charger = useCallback(async (silencieux = false) => {
    if (!silencieux) setChargement(true);
    try {
      const r = await api.get(`/api/dashboard?${qs}`);
      setData(r);
      setLive((prev) => ({ ...(prev || {}), ...r.live }));
    } catch (ex) {
      message(ex.message, "error");
    } finally {
      setChargement(false);
    }
  }, [qs]);

  useEffect(() => {
    api.get("/api/filtres")
      .then(setOptions)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => charger(!premier.current), premier.current ? 0 : 220);
    premier.current = false;
    return () => clearTimeout(t);
  }, [charger]);

  useEffect(() => {
    const source = new EventSource("/api/live/stream");
    source.onopen = () => setLiveOk(true);
    source.onerror = () => setLiveOk(false);
    source.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        setLive((prev) => ({ ...(prev || {}), ...d }));
        setLiveOk(true);
      } catch { /* trame ignorée */ }
    };
    return () => source.close();
  }, []);

  const posPush = async () => {
    setEnvoi("pos");
    try {
      const r = await api.post("/api/pos-push");
      message(`Vente POS ${r.ref} encaissée · ${fmt(r.montant)} FCFA.`);
      await charger(true);
    } catch (ex) {
      message(ex.message, "error");
    }
    setEnvoi("");
  };

  const exporter = async (format) => {
    setEnvoi(format);
    try {
      const nom = await api.download(`/api/export/${format}?${qs}`, `mboapilot.${format === "csv" ? "csv" : "xlsx"}`);
      message(`Export téléchargé : ${nom}`);
    } catch (ex) {
      message(ex.message, "error");
    }
    setEnvoi("");
  };

  const set = (cle) => (e) => setFiltres((f) => ({ ...f, [cle]: e.target.value }));
  const reinit = () => setFiltres({ periode: "365", region: "", canal: "", famille: "", vendeur: "", produit: "" });

  const k = data?.kpis;
  const serie = data?.serie || { points: [], cible_jour: 0, n1: [] };
  const rep = data?.repartitions || { regions: [], canaux: [], familles: [], top: [], vendeurs: [] };
  const points = useMemo(() => {
    const n1 = Object.fromEntries((serie.n1 || []).map((x) => [x.jour.slice(5), x.ca]));
    return (serie.points || []).map((p) => ({ ...p, n1: n1[p.jour.slice(5)] ?? null }));
  }, [serie]);
  const objectif = k?.objectif || 0;
  const avancement = objectif ? Math.max(0, Math.min(100, Math.round((k.ca / objectif) * 100))) : 0;
  const caTotalCanaux = (rep.canaux || []).reduce((s, x) => s + x.ca, 0);
  const actifs = [filtres.region, filtres.canal, filtres.famille, filtres.vendeur, filtres.produit].filter(Boolean);
  const periodeLabel = data?.filtres?.debut
    ? `${dateFR(data.filtres.debut)} → ${dateFR(data.filtres.fin)}`
    : "Tout l'historique disponible";

  return (
    <>
      <PageHead
        eyebrow="Pilotage commercial · FCFA"
        title={<>Bonjour {user?.nom?.split(" ")[0] || "à vous"}, voici votre réseau.</>}
        sub={
          <>
            <span className="live-dot" /> {user?.role}{user?.perimetre ? ` · ${user.perimetre}` : ""} · {periodeLabel}
            {data?.maj ? ` · données actualisées à ${data.maj}` : ""}
          </>
        }
        actions={
          <>
            {can("sales.write") && (
              <button className="btn btn-brand" onClick={posPush} disabled={envoi === "pos"}>
                {envoi === "pos" ? <><Spinner inline label="" /> Encaissement…</> : <><AddIcon /> Vente POS live</>}
              </button>
            )}
            {can("exports.csv") && (
              <>
                <button className="btn btn-outline" onClick={() => exporter("csv")} disabled={Boolean(envoi)}>
                  <FileDownloadIcon /> CSV
                </button>
                <button className="btn btn-outline" onClick={() => exporter("xlsx")} disabled={Boolean(envoi)}>
                  <FileDownloadIcon /> Excel
                </button>
              </>
            )}
            <button className="btn btn-ghost" onClick={() => charger()} disabled={chargement}>
              <RefreshIcon /> Actualiser
            </button>
          </>
        }
      />

      <div className="dash-page">
        <div className="dash-filterbar" role="search" aria-label="Filtrer le tableau de bord">
          <div>
            <label>Période</label>
            <select value={filtres.periode} onChange={set("periode")}>
              {PERIODES.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label>Région</label>
            <select value={filtres.region} onChange={set("region")}>
              <option value="">Toutes</option>
              {(options?.regions || []).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label>Canal</label>
            <select value={filtres.canal} onChange={set("canal")}>
              <option value="">Tous</option>
              {(options?.canaux || []).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label>Famille</label>
            <select value={filtres.famille} onChange={set("famille")}>
              <option value="">Toutes</option>
              {(options?.familles || []).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label>Vendeur</label>
            <select value={filtres.vendeur} onChange={set("vendeur")}>
              <option value="">Tous</option>
              {(options?.vendeurs || []).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          {actifs.length > 0 && (
            <button className="btn btn-ghost reset" onClick={reinit}><RefreshIcon /> Réinitialiser</button>
          )}
          <span className="dash-live-pill" style={{ marginLeft: actifs.length ? 0 : "auto" }}>
            <span className="live-dot" /> {liveOk ? "Direct actif" : "Direct en veille"}
          </span>
        </div>

        {chargement && !data ? (
          <div className="panel" style={{ padding: 60, textAlign: "center" }}>
            <Spinner label="Consolidation de votre réseau…" />
          </div>
        ) : data && (
          <>
            <div className="dash-kpis">
              <div className="dash-kpi dash-kpi-hero">
                <span className="dash-ix"><InsightsIcon /></span>
                <small>Chiffre d'affaires filtré</small>
                <b>{fmt(k?.ca)} <em>FCFA</em></b>
                <span>
                  {k?.var_obj !== null && k?.var_obj !== undefined
                    ? <>Objectif {fmt(objectif)} FCFA · <Delta value={k.var_obj} /></>
                    : <>Périmètre {user?.perimetre || "National"} · {k?.jours || 0} jour(s) actif(s)</>}
                </span>
                <div className="dash-progress"><i style={{ width: `${avancement}%` }} /></div>
                <span style={{ fontSize: 10.5, marginTop: 4, display: "block" }}>{avancement} % de l'objectif N-1 × 1,10</span>
              </div>

              <div className="dash-kpi">
                <span className="dash-ix"><AccountBalanceWalletIcon /></span>
                <small>Marge brute</small>
                <b>{fmt(k?.marge)} <em>FCFA</em></b>
                <span>Taux {k?.tauxMarge ?? "-"} % · <Delta value={k?.var_marge} /></span>
                <div className="meter-line"><i style={{ width: `${Math.min(100, Math.max(0, k?.tauxMarge || 0) * 3)}%` }} /></div>
              </div>

              <div className="dash-kpi">
                <span className="dash-ix"><ReceiptLongIcon /></span>
                <small>Transactions</small>
                <b>{fmt(k?.nb)}</b>
                <span>{fmt(k?.qte)} article(s) · panier {fmt(k?.panier)} FCFA</span>
              </div>

              <div className="dash-kpi">
                <span className="dash-ix"><ShoppingBasketIcon /></span>
                <small>Panier moyen</small>
                <b>{fmt(k?.panier)} <em>FCFA</em></b>
                <span>{k?.panier_n1 ? <>N-1 : {fmt(k.panier_n1)} FCFA · <Delta value={k.panier_n1 ? Math.round(((k.panier - k.panier_n1) / k.panier_n1) * 1000) / 10 : null} /></> : "Ticket moyen par transaction"}</span>
              </div>
            </div>

            <div className="dash-grid">
              <div className="dash-stack">
                <section className="dash-panel">
                  <div className="dash-panel-head">
                    <div>
                      <h2><InsightsIcon /> Activité journalière</h2>
                      <p className="hint">CA du jour, comparaison N-1 et objectif quotidien. Les barres vertes représentent les tickets.</p>
                    </div>
                    <Badge tone="brand">{points.length} jour(s) de données</Badge>
                  </div>
                  <div className="dash-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="dashCa" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#635BFF" stopOpacity={0.32} />
                            <stop offset="100%" stopColor="#635BFF" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#EEF1F5" vertical={false} />
                        <XAxis dataKey="jour" tick={{ fontSize: 10, fill: "#697386" }} tickFormatter={(j) => `${j.slice(8)}/${j.slice(5, 7)}`} minTickGap={40} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="g" tick={{ fontSize: 10, fill: "#697386" }} tickFormatter={(v) => fmtCompact(v)} width={48} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="d" orientation="right" hide />
                        <Tooltip
                          formatter={(v, n) => [n === "Tickets" ? fmt(v) : `${fmt(v)} FCFA`, n === "ca" ? "CA jour (N)" : n === "n1" ? "CA jour (N-1)" : n]}
                          labelFormatter={(l) => dateFR(l)}
                        />
                        <Bar yAxisId="d" dataKey="nb" name="Tickets" fill="#00C07F" opacity={0.32} radius={[3, 3, 0, 0]} barSize={5} />
                        <Area yAxisId="g" type="monotone" dataKey="ca" name="ca" stroke="#635BFF" strokeWidth={2.5} fill="url(#dashCa)" />
                        <Line yAxisId="g" type="monotone" dataKey="n1" name="n1" stroke="#8A94A6" strokeWidth={1.6} strokeDasharray="5 4" dot={false} />
                        {serie.cible_jour > 0 && (
                          <ReferenceLine yAxisId="g" y={serie.cible_jour} stroke="#E09B00" strokeDasharray="7 5" strokeWidth={1.6} />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="row-actions" style={{ marginTop: 6 }}>
                    <Badge tone="brand">CA N</Badge>
                    <Badge tone="gray">CA N-1</Badge>
                    <Badge tone="amber">Objectif jour {fmt(serie.cible_jour)} FCFA</Badge>
                    <Badge tone="green">Tickets</Badge>
                  </div>
                </section>

                <section className="dash-panel">
                  <div className="dash-panel-head">
                    <div>
                      <h2><TrendingUpIcon /> Saisonnalité sur 12 mois</h2>
                      <p className="hint">Deux années civiles superposées pour lire les fêtes, la rentrée et les campagnes agricoles.</p>
                    </div>
                  </div>
                  <div className="dash-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={data.mensuel} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="#EEF1F5" vertical={false} />
                        <XAxis dataKey="mois" tick={{ fontSize: 9.5, fill: "#697386" }} axisLine={false} tickLine={false} interval={0} angle={-18} dy={7} height={42} />
                        <YAxis tick={{ fontSize: 9.5, fill: "#697386" }} tickFormatter={(v) => fmtCompact(v)} width={44} axisLine={false} tickLine={false} />
                        <Tooltip formatter={(v, n) => [`${fmt(v)} FCFA`, n === "n" ? "Année N" : "Année N-1"]} />
                        <Bar dataKey="n" name="n" fill="#635BFF" radius={[4, 4, 0, 0]} barSize={13} />
                        <Bar dataKey="n1" name="n1" fill="#D9D6FF" radius={[4, 4, 0, 0]} barSize={13} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="row-actions" style={{ marginTop: 6 }}>
                    <Badge tone="brand">Année N</Badge>
                    <Badge tone="gray">Année N-1</Badge>
                  </div>
                </section>

                <section className="dash-panel">
                  <div className="dash-panel-head">
                    <div>
                      <h2><ReceiptLongIcon /> Dernières ventes</h2>
                      <p className="hint">Le flux est actualisé toutes les 6 secondes par le canal temps réel.</p>
                    </div>
                    <Link className="link-btn" to="/app/saisie">Saisir une vente <ArrowForwardIcon /></Link>
                  </div>
                  <div className="table-wrap">
                    <table className="dash-table">
                      <thead><tr><th>Référence</th><th>Produit</th><th>Canal</th><th>Région</th><th>Vendeur</th><th className="num">Montant</th></tr></thead>
                      <tbody>
                        {(live?.recentes || data.recentes || []).slice(0, 8).map((v) => (
                          <tr key={v.ref}>
                            <td className="mono" style={{ fontSize: 10.5 }}>{v.ref}</td>
                            <td className="trunc">{v.produit}</td>
                            <td><Badge tone={v.canal === "POS" ? "gray" : v.canal === "Agence" ? "brand" : "teal"}>{v.canal}</Badge></td>
                            <td>{v.region}</td>
                            <td className="trunc">{v.vendeur}</td>
                            <td className="num"><b>{fmt(v.montant)}</b></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!(live?.recentes || data.recentes || []).length && <Empty title="Aucune vente" text="Les ventes apparaîtront ici dès le premier import ou la première saisie." />}
                </section>

                <section className="dash-panel">
                  <div className="dash-panel-head">
                    <div>
                      <h2><FileDownloadIcon /> Imports récents</h2>
                      <p className="hint">Traçabilité des dépôts CSV, Excel et formulaires sur votre périmètre.</p>
                    </div>
                    <Link className="link-btn" to="/app/imports">Ouvrir le studio <ArrowForwardIcon /></Link>
                  </div>
                  <div className="dash-imports">
                    {(data.imports || []).map((imp) => (
                      <div className="dash-import" key={imp.id}>
                        <span className="chip-ic" style={{ background: "rgba(99,91,255,.09)", color: "var(--brand)" }}><CloudUploadIcon /></span>
                        <div>
                          <b>#{imp.id} · {imp.nom_fichier}</b>
                          <span>{dateFR(imp.jour)} · {imp.source} · {fmt(imp.lignes_integrees)} intégrée(s) · {imp.rejets} rejet(s)</span>
                        </div>
                        <Badge tone={imp.statut === "Reussi" ? "green" : imp.statut === "Partiel" ? "amber" : imp.annule ? "gray" : "red"}>{imp.annule ? "Annulé" : imp.statut}</Badge>
                      </div>
                    ))}
                  </div>
                  {!(data.imports || []).length && <Empty title="Aucun import" text="Déposez un CSV ou un Excel pour alimenter le cockpit." action={<Link className="btn btn-brand" to="/app/imports">Importer</Link>} />}
                </section>
              </div>

              <div className="dash-stack">
                <section className="dash-panel dash-live">
                  <div className="dash-live-head">
                    <div>
                      <h2><PointOfSaleIcon /> Live caisse</h2>
                      <p className="hint" style={{ marginBottom: 0 }}>Écritures POS et API reçues sur la journée de référence.</p>
                    </div>
                    <span className="dash-live-pill"><span className="live-dot" /> {liveOk ? "connecté" : "veille"}</span>
                  </div>
                  <div className="dash-live-kpis">
                    <div><small>CA du jour</small><b>{fmt(live?.caJour)} <span style={{ fontSize: 10 }}>FCFA</span></b></div>
                    <div><small>Tickets</small><b>{fmt(live?.nbJour)}</b></div>
                    <div><small>Source</small><b style={{ fontSize: 12 }}>SSE · 6 s</b></div>
                  </div>
                  <div className="dash-sales">
                    {(live?.recentes || []).slice(0, 4).map((v) => (
                      <div className="dash-sale" key={v.ref}>
                        <div><b>{v.produit}</b><span>{v.region} · {v.canal} · {v.vendeur}</span></div>
                        <strong>{fmt(v.montant)} FCFA</strong>
                      </div>
                    ))}
                  </div>
                  {can("sales.write") && (
                    <button className="btn btn-success btn-block" style={{ marginTop: 11 }} onClick={posPush} disabled={envoi === "pos"}>
                      <BoltIcon /> Simuler un encaissement POS
                    </button>
                  )}
                </section>

                <section className="dash-panel">
                  <h2><PlaceIcon /> Régions : atteinte de l'objectif</h2>
                  <p className="hint">Objectif = CA N-1 × 1,10. Les régions sous 90 % apparaissent en orange.</p>
                  <div>
                    {(rep.regions || []).map((r) => (
                      <div className={"dash-region" + (r.pct !== null && r.pct < 90 ? " warn" : "")} key={r.region}>
                        <span title={r.region}>{r.region}</span>
                        <div className="pbar"><i style={{ width: `${Math.min(100, Math.max(0, r.pct || 0))}%` }} /></div>
                        <em>{r.pct === null ? "-" : `${r.pct} %`}</em>
                      </div>
                    ))}
                  </div>
                  <div className="row-actions" style={{ marginTop: 10 }}>
                    {(rep.regions || []).slice(0, 3).map((r) => (
                      <Badge key={r.region} tone={r.var === null ? "gray" : r.var >= 0 ? "green" : "red"}>
                        {r.region} <Delta value={r.var} />
                      </Badge>
                    ))}
                  </div>
                </section>

                <section className="dash-panel">
                  <div className="dash-panel-head">
                    <div>
                      <h2><WarningAmberIcon /> Alertes & priorités</h2>
                      <p className="hint">Les signaux calculés sur votre périmètre, du plus urgent au plus informatif.</p>
                    </div>
                  </div>
                  <div className="dash-alerts">
                    {(data.alertes || []).map((a, i) => (
                      <div className={"dash-alert " + a.niveau} key={i}>
                        {ICONES_ALERTE[a.niveau] || <InfoOutlinedIcon />}
                        <div>
                          <b>{a.titre}</b>
                          <span>{a.texte}</span>
                          {a.lien && <Link to={a.lien}>Approfondir <ArrowForwardIcon /></Link>}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="dash-panel">
                  <h2><InsightsIcon /> Le récit du mois</h2>
                  <p className="hint">Ce que racontent vos chiffres, en langage clair.</p>
                  <div className="dash-story">
                    {(data.recit || []).map((r, i) => (
                      <div className={"dash-story-item " + r.niveau} key={i}>
                        <b>{r.titre}</b>
                        <span>{r.texte}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="dash-panel">
                  <h2><DonutLargeIcon /> Mix canaux</h2>
                  <p className="hint">Part de chaque circuit dans le CA filtré.</p>
                  <div style={{ height: 186, position: "relative" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={rep.canaux || []} dataKey="ca" nameKey="canal" innerRadius={55} outerRadius={82} paddingAngle={3}>
                          {(rep.canaux || []).map((x) => <Cell key={x.canal} fill={COULEURS_CANAL[x.canal] || "#C2C9D4"} />)}
                        </Pie>
                        <Tooltip formatter={(v, n) => [`${fmt(v)} FCFA`, n]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                      <b style={{ fontSize: 18, letterSpacing: "-.02em" }}>{fmtCompact(caTotalCanaux)}</b>
                      <span className="faint" style={{ fontSize: 9.5 }}>FCFA filtrés</span>
                    </div>
                  </div>
                  <div className="row-actions">
                    {(rep.canaux || []).map((x) => (
                      <Badge key={x.canal} tone={x.canal === "POS" ? "gray" : x.canal === "Agence" ? "brand" : "teal"}>
                        {x.canal} · {caTotalCanaux ? Math.round((x.ca / caTotalCanaux) * 100) : 0} %
                      </Badge>
                    ))}
                  </div>
                </section>

                <section className="dash-panel">
                  <h2><BoltIcon /> Actions rapides</h2>
                  <div className="dash-quick">
                    {can("sales.write") && <Link to="/app/saisie"><PointOfSaleIcon /> Saisir une vente</Link>}
                    {can("imports.read") && <Link to="/app/imports"><CloudUploadIcon /> Importer des données</Link>}
                    {can("reports.view") && <Link to="/app/rapport"><DescriptionIcon /> Rapport signé</Link>}
                    {can("users.manage") && <Link to="/app/users"><GroupIcon /> Utilisateurs</Link>}
                    {can("partners.manage") && <Link to="/app/partenaires"><HandshakeIcon /> Partenaires</Link>}
                    <Link to="/app/compte"><ShieldIcon /> Sécurité du compte</Link>
                  </div>
                </section>
              </div>
            </div>

            <section className="dash-panel">
              <div className="dash-panel-head">
                <div>
                  <h2><CategoryIcon /> Familles : CA, marge et dynamique</h2>
                  <p className="hint">Comparez le poids de chaque famille et sa progression par rapport à l'année précédente.</p>
                </div>
                <Badge tone="brand">{rep.familles?.length || 0} famille(s)</Badge>
              </div>
              <div className="dash-chart dash-chart-sm">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rep.familles || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#EEF1F5" vertical={false} />
                    <XAxis dataKey="famille" tick={{ fontSize: 10, fill: "#697386" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#697386" }} tickFormatter={(v) => fmtCompact(v)} width={48} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v, n) => [`${fmt(v)} FCFA`, n === "ca" ? "CA" : n === "mg" ? "Marge" : n]} />
                    <Bar dataKey="ca" name="ca" radius={[4, 4, 0, 0]} barSize={24}>
                      {(rep.familles || []).map((x, i) => <Cell key={x.famille} fill={COULEURS_FAMILLE[i % COULEURS_FAMILLE.length]} />)}
                    </Bar>
                    <Bar dataKey="mg" name="mg" fill="#00C07F" radius={[4, 4, 0, 0]} barSize={10} opacity={0.6} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="row-actions" style={{ marginTop: 5 }}>
                <Badge tone="brand">CA</Badge><Badge tone="green">Marge</Badge>
                {(rep.familles || []).slice(0, 4).map((f) => <Badge key={f.famille} tone={f.var === null ? "gray" : f.var >= 0 ? "green" : "red"}>{f.famille} <Delta value={f.var} /></Badge>)}
              </div>
            </section>

            <div className="dash-grid">
              <section className="dash-panel">
                <div className="dash-panel-head">
                  <div>
                    <h2><EmojiEventsIcon /> Classement vendeurs</h2>
                    <p className="hint">Objectif individuel N-1 × 1,10. Cliquez sur une ligne pour filtrer le tableau de bord.</p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="dash-table">
                    <thead><tr><th>#</th><th>Vendeur</th><th className="num">CA</th><th className="num">Tickets</th><th style={{ minWidth: 160 }}>Objectif</th></tr></thead>
                    <tbody>
                      {(rep.vendeurs || []).map((v, i) => (
                        <tr key={v.vendeur} style={{ cursor: "pointer" }} onClick={() => setFiltres((f) => ({ ...f, vendeur: v.vendeur }))}>
                          <td><span className="role-pill" style={{ display: "inline-flex", width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: "50%" }}>{i + 1}</span></td>
                          <td><b>{v.vendeur}</b></td>
                          <td className="num"><b>{fmt(v.ca)}</b></td>
                          <td className="num">{v.nb}</td>
                          <td>
                            <div className="pbar" style={{ height: 7 }}><i style={{ width: `${Math.min(100, Math.max(0, v.pct || 0))}%`, background: v.pct === null ? "#CBD2DC" : v.pct < 90 ? "#DF1B41" : v.pct < 100 ? "#FFC247" : "#00C07F" }} /></div>
                            <span className="faint" style={{ fontSize: 10 }}>{v.pct === null ? "sans N-1" : `${v.pct} % de ${fmt(v.obj)} FCFA`}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="dash-panel">
                <div className="dash-panel-head">
                  <div>
                    <h2><StorefrontIcon /> Top produits</h2>
                    <p className="hint">Les références qui portent le chiffre d'affaires sur la période.</p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="dash-table">
                    <thead><tr><th>Produit</th><th className="num">Quantité</th><th className="num">CA</th></tr></thead>
                    <tbody>
                      {(rep.top || []).map((t) => (
                        <tr key={t.produit}>
                          <td className="trunc"><b>{t.produit}</b></td>
                          <td className="num">{fmt(t.q)}</td>
                          <td className="num">{fmt(t.ca)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="form-note" style={{ marginTop: 10 }}>
                  <InfoOutlinedIcon /> Les montants sont exprimés en FCFA et suivent votre périmètre d'habilitation.
                </div>
              </section>
            </div>

            <div className="dash-panel" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "13px 18px" }}>
              <span className="live-dot" />
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                Dernière synchronisation : <b>{data.maj}</b> · <span className="faint">{dateFR(data.filtres?.ref)}</span>
              </span>
              <span className="faint" style={{ marginLeft: "auto", fontSize: 10.5 }}>
                {actifs.length ? `Filtres actifs : ${actifs.join(" · ")}` : "Tous les filtres sont ouverts"} · objectif N-1 × 1,10
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => charger()} disabled={chargement}><RefreshIcon /> Recalculer</button>
            </div>
          </>
        )}
      </div>

      <Toast message={toast?.message} tone={toast?.tone} onClose={() => setToast(null)} />
    </>
  );
}
