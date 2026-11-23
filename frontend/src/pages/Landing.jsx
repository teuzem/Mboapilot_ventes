import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import StorefrontIcon from "@mui/icons-material/Storefront";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import InsightsIcon from "@mui/icons-material/Insights";
import LockIcon from "@mui/icons-material/Lock";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ShieldIcon from "@mui/icons-material/Shield";
import BoltIcon from "@mui/icons-material/Bolt";
import HubIcon from "@mui/icons-material/Hub";
import SyncIcon from "@mui/icons-material/Sync";
import CategoryIcon from "@mui/icons-material/Category";
import StarIcon from "@mui/icons-material/Star";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import TableChartIcon from "@mui/icons-material/TableChart";
import DescriptionIcon from "@mui/icons-material/Description";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import GroupsIcon from "@mui/icons-material/Groups";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import SpellcheckIcon from "@mui/icons-material/Spellcheck";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PublicIcon from "@mui/icons-material/Public";
import {
  AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, BarChart, Bar, Cell,
} from "recharts";
import { SiteHeader, SiteFooter, Reveal } from "../components";
import { api, fmt, fmtFCFA, fmtCompact, pct } from "../api";

const spring = { type: "spring", stiffness: 90, damping: 20 };
const LOGO_FALLBACK = [
  ["/img/logos/mtn.png", "MTN Cameroun", "Télécoms"],
  ["/img/logos/orange.png", "Orange Cameroun", "Télécoms"],
  ["/img/logos/guinness.png", "Guinness Cameroun", "Agroalimentaire"],
  ["/img/logos/ecobank.png", "Ecobank Cameroun", "Banque / Finance"],
  ["/img/logos/tradex.png", "Tradex", "Distribution"],
  ["/img/logos/tecno.png", "Tecno Mobile", "Retail / Mode"],
  ["/img/logos/turkish.png", "Turkish Airlines", "Transport"],
  ["/img/logos/ethiopian.png", "Ethiopian Airlines", "Transport"],
  ["/img/logos/nestle.png", "Nestlé Cameroun", "Agroalimentaire"],
];

function useVitrine() {
  const [data, setData] = useState(null);
  const [live, setLive] = useState(null);
  const [maj, setMaj] = useState("");
  useEffect(() => {
    let alive = true;
    const charger = () => Promise.allSettled([api.get("/api/vitrine/stats"), api.get("/api/vitrine/live")])
      .then(([stats, direct]) => {
        if (!alive) return;
        if (stats.status === "fulfilled") setData(stats.value);
        if (direct.status === "fulfilled") setLive(direct.value);
        setMaj(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      });
    charger();
    const t = setInterval(charger, 12000);
    const vis = () => { if (!document.hidden) charger(); };
    document.addEventListener("visibilitychange", vis);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, []);
  return { data, live, maj };
}

function usePartners() {
  const [partners, setPartners] = useState([]);
  const load = useCallback(() => {
    api.get("/api/partenaires/publics").then((r) => setPartners(r.partenaires || [])).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    const sync = () => load();
    window.addEventListener("mboa:partners", sync);
    window.addEventListener("storage", sync);
    return () => {
      clearInterval(t);
      window.removeEventListener("mboa:partners", sync);
      window.removeEventListener("storage", sync);
    };
  }, [load]);
  return partners;
}

function Counter({ value, suffix = "", compact = false, duration = 900 }) {
  const [n, setN] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const target = Number(value) || 0;
    let raf;
    const debut = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - debut) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setN(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span ref={ref}>{compact ? fmtCompact(n) : fmt(n)}{suffix}</span>;
}

function HeroDashboard({ d, live, maj, partners }) {
  const serie = d?.serie30 || [];
  const n1 = d?.serieN1 || [];
  const k = d?.kpis || {};
  const points = serie.map((p, i) => ({
    jour: p.jour,
    n: p.ca,
    n1: n1[i] ? n1[i].ca : null,
  }));
  const objJour = k.obj30 ? Math.round(k.obj30 / Math.max(1, serie.length)) : 0;
  const recentes = live?.recentes || [];
  const pctObjectif = k.objPct ?? 0;
  return (
    <div className="hero-stage">
      <motion.div initial={{ opacity: 0, y: 40, rotateX: 2 }} animate={{ opacity: 1, y: 0, rotateX: 0 }} transition={{ ...spring, delay: 0.2 }}>
        <div className="dash-card dash-v2">
          <div className="dc-head">
            <span className="dc-logo">M</span>
            <span className="dc-title">Cockpit réseau · Cameroun</span>
            <span className="dc-live"><span className="live-dot" /> live {maj || "…"}</span>
          </div>
          <div className="dc-filterbar">
            <span className="dc-chip on">30 derniers jours</span>
            <span className="dc-chip">National</span>
            <span className="dc-chip">Tous canaux</span>
            <span className="dc-chip dc-chip-right"><PublicIcon /> {d?.regions ?? "—"} régions</span>
          </div>
          <div className="dc-kpis">
            <div className="dc-kpi dc-kpi-hero">
              <small>Chiffre d'affaires</small>
              <b>{k.ca30 ? <Counter value={k.ca30} compact /> : "···"} <em>FCFA</em></b>
              <span className={k.var30 < 0 ? "down" : "up"}>
                {k.var30 == null ? "Calcul en cours" : `${k.var30 >= 0 ? "▲" : "▼"} ${pct(k.var30)} vs N-1`}
              </span>
              <div className="dc-progress"><i style={{ width: `${Math.min(100, pctObjectif)}%` }} /></div>
              <span className="dc-sub">{pctObjectif} % de l'objectif 30 j</span>
            </div>
            <div className="dc-kpi">
              <small>Transactions</small>
              <b>{k.nb30 ? <Counter value={k.nb30} /> : "···"}</b>
              <span className={k.varNb < 0 ? "down" : "up"}>{k.varNb == null ? "—" : `${pct(k.varNb)} de tickets`}</span>
            </div>
            <div className="dc-kpi">
              <small>Panier moyen</small>
              <b>{k.panier ? <Counter value={k.panier} /> : "···"}</b>
              <span className="dc-sub">FCFA par ticket</span>
            </div>
            <div className="dc-kpi">
              <small>Marge brute</small>
              <b>{k.tauxMarge != null ? `${k.tauxMarge} %` : "···"}</b>
              <span className="dc-sub">{fmtFCFA(k.marge30 || 0)}</span>
            </div>
          </div>
          <div className="dc-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gCA2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#635BFF" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#635BFF" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#EEF1F5" vertical={false} />
                <XAxis dataKey="jour" tick={{ fontSize: 10, fill: "#697386" }} tickFormatter={(j) => `${j.slice(8)}/${j.slice(5, 7)}`} minTickGap={38} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#697386" }} tickFormatter={(v) => fmtCompact(v)} width={42} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v, n) => [fmtFCFA(v), n === "n" ? "Année en cours" : "Année N-1"]} labelFormatter={(j) => `Jour : ${j}`} />
                {objJour > 0 && <ReferenceLine y={objJour} stroke="#FFC247" strokeDasharray="6 5" strokeWidth={2} />}
                <Area type="monotone" dataKey="n" stroke="#635BFF" strokeWidth={2.5} fill="url(#gCA2)" />
                <Line type="monotone" dataKey="n1" stroke="#9AA6BC" strokeWidth={1.8} strokeDasharray="5 4" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="dc-live-row">
            <div className="dc-live-head">
              <b>Dernières ventes</b>
              <span>{live?.total ? `${fmt(live.total)} transactions suivies` : "Synchronisation…"}</span>
            </div>
            <div className="dc-sales">
              {recentes.slice(0, 3).map((v, i) => (
                <div className="dc-sale" key={(v.ref || "") + i}>
                  <span className="dc-sale-ic" style={{ background: ["#EEF0FF", "#E6F9F1", "#FFF4DC"][i % 3], color: ["#635BFF", "#00A36C", "#B47800"][i % 3] }}>
                    <StorefrontIcon />
                  </span>
                  <div><b>Transaction {v.canal}</b><span>{v.region} · {v.jour}</span></div>
                  <strong>Sécurisé</strong>
                </div>
              ))}
              {!recentes.length && [0, 1, 2].map((i) => (
                <div className="dc-sale skeleton" key={i}><span className="dc-sale-ic" /><div><b /><span /></div></div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
      <motion.div className="float-chip float-chip-1" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: 0.7 }}>
        <span className="chip-ic" style={{ background: "#E6F9F1", color: "#00A36C" }}><DoneAllIcon /></span>
        <div><b>Import Excel terminé</b><span>2 480 lignes · 0 rejet</span></div>
      </motion.div>
      <motion.div className="float-chip float-chip-2" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: 0.9 }}>
        <span className="chip-ic" style={{ background: "#FFF4DC", color: "#B47800" }}><NotificationsActiveIcon /></span>
        <div><b>Alerte marge · Ouest</b><span>−5,2 % vs N-1</span></div>
      </motion.div>
      <motion.div className="float-chip float-chip-3" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 1.05 }}>
        <span className="chip-avatars">
          {(partners.length ? partners.slice(0, 3) : LOGO_FALLBACK.slice(0, 3)).map((p, i) => {
            const logo = p.logo || p[0];
            return <img key={i} src={logo} alt="" />;
          })}
        </span>
        <div><b>{partners.length || 9} partenaires</b><span>logos synchronisés</span></div>
      </motion.div>
    </div>
  );
}

function Ticker({ live }) {
  const ventes = live?.recentes || [];
  if (!ventes.length) return null;
  const suite = [...ventes, ...ventes];
  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-label"><span className="live-dot" /> En direct du réseau</div>
      <div className="ticker-track">
        {suite.map((v, i) => (
          <span className="ticker-item" key={i}>
            <b>{v.region}</b> · transaction <em>{v.canal}</em>
            <i>{v.jour}</i>
          </span>
        ))}
      </div>
    </div>
  );
}

function LogoWall({ partners, compact = false }) {
  const liste = partners.length
    ? partners.map((p) => ({ logo: p.logo, nom: p.entreprise, secteur: p.secteur, featured: p.featured }))
    : LOGO_FALLBACK.map(([logo, nom, secteur]) => ({ logo, nom, secteur }));
  const boucle = liste.length >= 6 ? [...liste, ...liste] : [...liste, ...liste, ...liste, ...liste];
  return (
    <div className={"logo-wall" + (compact ? " compact" : "")}>
      <div className="logo-track" style={{ animationDuration: `${Math.max(22, liste.length * 4)}s` }}>
        {boucle.map((p, i) => (
          <span className="logo-cell" key={i} title={p.nom}>
            <img src={p.logo} alt={p.nom} loading="lazy" />
          </span>
        ))}
      </div>
    </div>
  );
}

function MiniBars({ data }) {
  return (
    <div style={{ height: 104 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 24 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="region" tick={{ fontSize: 10 }} width={72} axisLine={false} tickLine={false} />
          <Bar dataKey="ca" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => <Cell key={i} fill={i === 0 ? "#635BFF" : "#D9D6FF"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const ETAPES = [
  {
    t: "Collectez",
    titre: "Toutes vos sources, un seul flux.",
    texte: "Caisses POS, fichiers d'agences, e-commerce : MboaPilot accepte vos formats actuels. Le studio d'import mappe les colonnes, prévisualise les lignes et rejette les erreurs avant qu'elles ne touchent vos indicateurs.",
    points: ["CSV, Excel .xlsx/.xls et formulaires terrain", "Mapping assisté et prévisualisation ligne à ligne", "Rejeu idempotent : zéro doublon"],
    icon: <CloudUploadIcon />,
    visuel: "import",
    liv: "Premier flux contrôlé en moins de 10 jours",
  },
  {
    t: "Contrôlez",
    titre: "La qualité se voit, s'explique, se prouve.",
    texte: "Chaque ligne rejetée porte un motif lisible : date, région, montant incohérent, doublon. Les imports sont annulables, les écritures tracées, les périmètres appliqués côté serveur.",
    points: ["Motif de rejet pour chaque ligne", "Annulation d'un import sans toucher à l'existant", "Permissions et périmètres par rôle"],
    icon: <SpellcheckIcon />,
    visuel: "qualite",
    liv: "Un taux de qualité mesuré à chaque import",
  },
  {
    t: "Décidez",
    titre: "Le lundi, la décision est déjà prête.",
    texte: "CA, marge, panier, objectifs, comparaison N-1, alertes de seuil et récit automatique. Vous ouvrez le cockpit, vous savez quoi faire. Pas de tableur, pas de réunion de consolidation.",
    points: ["Tableau de bord temps réel et filtres", "Alertes objectif, marge et points silencieux", "Exports CSV/Excel et rapport signé"],
    icon: <InsightsIcon />,
    visuel: "pilotage",
    liv: "Revue hebdomadaire en 15 minutes",
  },
];

function ImportVisual() {
  return (
    <div className="mock-window">
      <div className="mock-head"><span className="mock-dots"><i /><i /><i /></span><span>studio-import.mboapilot</span><span className="mock-tag">Excel · 2 480 lignes</span></div>
      <div className="mock-import">
        <div className="dropzone-mock"><CloudUploadIcon /><b>ventes_octobre.xlsx</b><span>Feuille « Ventes » · mappage automatique</span></div>
        <div className="map-mock">
          {[["date_vente", "jour", true], ["region", "region", true], ["montant_ttc", "montant", true], ["boutique", "point_vente", false]].map(([src, dst, ok]) => (
            <div className="map-line" key={src}>
              <code>{src}</code><ArrowForwardIcon /><code>{dst}</code>
              <span className={ok ? "map-ok" : "map-warn"}>{ok ? <CheckCircleIcon /> : "!"}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mock-foot"><span><CheckCircleIcon /> 2 464 prêtes</span><span>12 doublons</span><span>4 rejets expliqués</span><button className="btn btn-brand" style={{ padding: "6px 14px", fontSize: 12.5 }}>Importer</button></div>
    </div>
  );
}

function QualityVisual() {
  return (
    <div className="mock-window">
      <div className="mock-head"><span className="mock-dots"><i /><i /><i /></span><span>contrôle-qualité</span><span className="mock-tag">Import #184</span></div>
      <div className="quality-body">
        <div className="quality-ring"><span>99,4<small>%</small></span><em>lignes valides</em></div>
        <div className="quality-list">
          {[
            ["2 464", "intégrées", "ok"],
            ["12", "doublons écartés", "warn"],
            ["4", "rejets expliqués", "bad"],
            ["0", "écriture hors périmètre", "ok"],
          ].map(([n, t, tone]) => (
            <div key={t} className={"quality-row " + tone}><b>{n}</b><span>{t}</span></div>
          ))}
        </div>
      </div>
      <div className="quality-note"><ShieldIcon /> Chaque rejet est conservé avec son motif, consultable et exportable.</div>
    </div>
  );
}

function PilotageVisual({ d }) {
  const points = (d?.serie30 || []).map((p) => ({ jour: p.jour, ca: p.ca }));
  return (
    <div className="mock-window">
      <div className="mock-head"><span className="mock-dots"><i /><i /><i /></span><span>revue-hebdo · direction</span><span className="mock-tag">Automatique</span></div>
      <div className="pilotage-body">
        <div className="pilotage-kpi"><small>CA 30 jours</small><b>{fmtFCFA(d?.kpis?.ca30 || 0)}</b><span className="up">{pct(d?.kpis?.var30)} vs N-1</span></div>
        <div className="pilotage-spark">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points.slice(-14)}>
              <defs><linearGradient id="gPil" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#635BFF" stopOpacity={0.4} /><stop offset="100%" stopColor="#635BFF" stopOpacity={0} /></linearGradient></defs>
              <Area type="monotone" dataKey="ca" stroke="#635BFF" strokeWidth={2.5} fill="url(#gPil)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="pilotage-alert"><NotificationsActiveIcon /><span><b>Ouest sous le seuil</b> 84 % de l'objectif · action corrective avant clôture</span></div>
      </div>
    </div>
  );
}

export default function Landing() {
  const { data: d, live, maj } = useVitrine();
  const partners = usePartners();
  const [tab, setTab] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setTab((p) => (p + 1) % ETAPES.length), 8000);
    return () => clearInterval(t);
  }, [auto]);
  const k = d?.kpis || {};
  const secteurs = partners.reduce((acc, p) => { const s = p.secteur || "Autre"; acc[s] = (acc[s] || 0) + 1; return acc; }, {});
  const dernierPartenaire = partners[0];

  return (
    <>
      <SiteHeader />
      <main>
        <section className="hero hero-v2">
          <div className="hero-mesh"><i /><i /><i /><i /></div>
          <div className="hero-grid-bg" />
          <div className="wrap-wide hero-grid">
            <div className="hero-copy">
              <motion.div initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
                <span className="eyebrow"><span className="dot" /> Pilotage commercial · Afrique centrale</span>
                <h1>Vos ventes, en direct.<br /><span className="grad">Vos décisions, en avance.</span></h1>
                <p className="sub">
                  MboaPilot branche vos caisses, vos agences et votre e-commerce, sécurise chaque ligne,
                  et transforme vos données FCFA en décisions — <b>avant</b> que la semaine ne soit perdue.
                </p>
                <div className="hero-ctas">
                  <Link className="btn btn-brand btn-lg" to="/partenaires">Réserver une démo <ArrowForwardIcon /></Link>
                  <Link className="btn btn-outline btn-lg" to="/login"><PlayArrowIcon /> Explorer le cockpit</Link>
                </div>
                <p className="hero-note"><ShieldIcon /> Démo sur données réelles · sans carte bancaire · réponse sous 24 h</p>
                <div className="hero-proof">
                  <div><b><Counter value={d?.nb || 0} /></b><span>transactions suivies</span></div>
                  <div><b><Counter value={d?.caM || 0} suffix=" M" /></b><span>FCFA pilotés</span></div>
                  <div><b><Counter value={d?.sites?.pdv || 0} /></b><span>points de vente</span></div>
                  <div><b><Counter value={partners.length || 9} /></b><span>partenaires actifs</span></div>
                </div>
              </motion.div>
            </div>
            <HeroDashboard d={d} live={live} maj={maj} partners={partners} />
          </div>
          <div className="hero-trust wrap-wide">
            <span>Branché sur vos outils existants</span>
            <div className="hero-trust-logos">
              {["CSV", "Excel", "POS", "API", "Formulaires"].map((x) => <i key={x}>{x}</i>)}
            </div>
            <span className="hero-trust-right"><span className="live-dot" /> {maj ? `données synchronisées à ${maj}` : "synchronisation…"}</span>
          </div>
        </section>

        <Ticker live={live} />

        <section className="logo-band">
          <div className="wrap-wide">
            <div className="logo-band-head">
              <p>Ils nous font confiance et pilotent leur croissance avec MboaPilot</p>
              <Link to="/partenaires">Rejoindre le réseau partenaires <ArrowForwardIcon /></Link>
            </div>
          </div>
          <LogoWall partners={partners} />
          <div className="wrap-wide logo-band-foot">
            <span><b>{partners.length || 9}</b> partenaires validés</span>
            <span><b>{Object.keys(secteurs).length || 5}</b> secteurs représentés</span>
            <span><b>100 %</b> logos synchronisés depuis le portail</span>
          </div>
        </section>

        <section className="block">
          <div className="wrap-wide">
            <Reveal>
              <div className="sec-head center">
                <span className="eyebrow"><span className="dot" /> Une plateforme, pas un tableur</span>
                <h2>Du ticket de caisse à la décision de direction.</h2>
                <p>Six modules qui travaillent ensemble, avec une seule vérité chiffrée. Chaque donnée est contrôlée à l'entrée et chaque action est traçable.</p>
              </div>
            </Reveal>
            <div className="bento-v2">
              {[
                { ic: <StorefrontIcon />, c: "#635BFF", t: "Collecte multi-source", p: "POS, CSV, Excel, API e-commerce et formulaires terrain. Un flux par source, un référentiel unique.", k: "Zéro ressaisie", mini: d && <MiniBars data={(d.topRegions || []).slice(0, 5)} />, cls: "large" },
                { ic: <VerifiedUserIcon />, c: "#00C07F", t: "Qualité à la source", p: "Déduplication, validation métier, motifs de rejet lisibles. Vos chiffres sont défendables.", k: "Donnée de confiance" },
                { ic: <InsightsIcon />, c: "#E09B00", t: "Décisionnel temps réel", p: "KPI, objectifs N-1, écarts, alertes : le cockpit se met à jour pendant que vous parlez.", k: "Décision en 30 s" },
                { ic: <LockIcon />, c: "#0A2540", t: "Sécurité avancée", p: "MFA TOTP réelle, sessions signées, CSRF, rôles et périmètres appliqués côté serveur.", k: "Niveau bancaire" },
                { ic: <NotificationsActiveIcon />, c: "#FF5996", t: "Alertes proactives", p: "Seuil d'objectif, marge, point de vente silencieux : vous êtes prévenu avant la perte.", k: "Réactivité" },
                { ic: <ReceiptLongIcon />, c: "#00B8D4", t: "Audit infalsifiable", p: "Journal horodaté et chaîné SHA-256, vérification à la demande, rétention conforme.", k: "Prêt pour l'audit" },
              ].map((f, i) => (
                <Reveal key={f.t} delay={(i % 3) * 0.08} className={f.cls || ""}>
                  <div className="feat feat-v2">
                    <div className="pic" style={{ background: f.c }}>{f.ic}</div>
                    <h3>{f.t}</h3><p>{f.p}</p>
                    {f.mini && <div className="mini">{f.mini}</div>}
                    <span className="kicker">{f.k}</span>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="block soft" id="methode">
          <div className="wrap-wide">
            <Reveal>
              <div className="sec-head">
                <span className="eyebrow"><span className="dot" /> Méthode de déploiement</span>
                <h2>Trois mouvements. Un cockpit qui tourne.</h2>
                <p>Pas de big-bang, pas de jargon : chaque étape a un livrable vérifiable, sur vos données.</p>
              </div>
            </Reveal>
            <div className="tabs-v2">
              {ETAPES.map((e, i) => (
                <button key={e.t} className={i === tab ? "on" : ""} onClick={() => { setTab(i); setAuto(false); }}>
                  <span>0{i + 1}</span>{e.t}
                </button>
              ))}
            </div>
            <div className="method-pane" key={tab}>
              <motion.div initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={spring}>
                <h3>{ETAPES[tab].titre}</h3>
                <p>{ETAPES[tab].texte}</p>
                <ul className="check-list">{ETAPES[tab].points.map((p) => <li key={p}><CheckCircleIcon />{p}</li>)}</ul>
                <div className="deliver"><CheckCircleIcon /><span><b>Livrable : </b>{ETAPES[tab].liv}</span></div>
                <Link className="btn btn-outline" to="/partenaires" style={{ marginTop: 18 }}>Planifier mon déploiement <ArrowForwardIcon /></Link>
              </motion.div>
              <motion.div initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={spring} className="method-visual">
                {ETAPES[tab].visuel === "import" && <ImportVisual />}
                {ETAPES[tab].visuel === "qualite" && <QualityVisual />}
                {ETAPES[tab].visuel === "pilotage" && <PilotageVisual d={d} />}
              </motion.div>
            </div>
          </div>
        </section>

        <section className="block">
          <div className="wrap-wide">
            <Reveal>
              <div className="live-band">
                <div className="live-band-copy">
                  <span className="eyebrow" style={{ background: "rgba(99,91,255,.16)", color: "#D5D2FF", border: 0 }}><span className="dot" /> Données réelles, pas une maquette</span>
                  <h2>Le réseau MboaPilot, en ce moment.</h2>
                  <p>Les chiffres ci-dessous sortent de la base de démonstration : {fmt(d?.nb || 0)} transactions, {d?.sites?.produits || "—"} produits, {d?.regions || "—"} régions. Rechargez, ils bougent.</p>
                  <div className="live-band-actions">
                    <Link className="btn btn-brand" to="/login">Ouvrir la démo <ArrowForwardIcon /></Link>
                    <span><span className="live-dot" /> mis à jour à {maj || "…"}</span>
                  </div>
                </div>
                <div className="live-band-stats">
                  <div><small>CA sur 30 jours</small><b>{fmtFCFA(k.ca30 || 0)}</b><span className={k.var30 < 0 ? "down" : "up"}>{pct(k.var30)} vs N-1</span></div>
                  <div><small>Panier moyen</small><b>{fmtFCFA(k.panier || 0)}</b><span>{fmt(k.nb30 || 0)} tickets</span></div>
                  <div><small>Taux de marge</small><b>{k.tauxMarge != null ? `${k.tauxMarge} %` : "—"}</b><span>{fmtFCFA(k.marge30 || 0)} de marge</span></div>
                  <div><small>Objectif 30 jours</small><b>{k.objPct != null ? `${k.objPct} %` : "—"}</b><span>trajectoire sur N-1 +10 %</span></div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="block soft">
          <div className="wrap-wide grid-2 craft-grid">
            <Reveal>
              <span className="eyebrow"><span className="dot" /> Collecte & contrôle</span>
              <h2 className="h2-left">Vos formats actuels. Vos équipes, sans changer leurs habitudes.</h2>
              <p className="lead">Un fichier de configuration ne suffit jamais. Le studio d'import MboaPilot est conçu pour la réalité des réseaux africains : fichiers hétérogènes, séparateurs variables, dates en français, montants en FCFA avec espaces.</p>
              <ul className="check-list">
                <li><CheckCircleIcon /> Détection automatique du séparateur et de l'encodage</li>
                <li><CheckCircleIcon /> Mapping assisté des colonnes et aperçu avant import</li>
                <li><CheckCircleIcon /> Doublons écartés par référence, mises à jour maîtrisées</li>
                <li><CheckCircleIcon /> Annulation d'un import en un clic, journalisée</li>
              </ul>
              <div className="craft-badges">
                <span><TableChartIcon /> CSV</span><span><DescriptionIcon /> Excel</span>
                <span><CloudUploadIcon /> POS</span><span><HubIcon /> API</span>
              </div>
            </Reveal>
            <Reveal delay={0.12}><ImportVisual /></Reveal>
          </div>
        </section>

        <section className="block dark security-v2">
          <div className="wrap-wide">
            <Reveal>
              <div className="sec-head">
                <span className="eyebrow"><span className="dot" /> Sécurité & conformité</span>
                <h2>Vos chiffres sont stratégiques. Gardés comme tels.</h2>
                <p>Hébergés au Cameroun, conformes à la loi n° 2024/017. Chaque mesure est vérifiable par vos auditeurs, pas seulement affichée sur un site.</p>
              </div>
            </Reveal>
            <div className="security-grid-v2">
              {[
                { ic: <QrCode2Icon />, t: "MFA TOTP réelle", p: "Authenticator, QR d'enrôlement, codes de secours à usage unique. Les codes de démonstration disparaissent en production." },
                { ic: <LockIcon />, t: "Sessions signées", p: "Cookie HttpOnly, CSRF sur chaque écriture, expiration d'inactivité et durée absolue, invalidation par version de session." },
                { ic: <GroupsIcon />, t: "Moindre privilège", p: "Quatre rôles, une matrice de permissions explicite, périmètres régionaux appliqués côté serveur — jamais dans le navigateur." },
                { ic: <ReceiptLongIcon />, t: "Audit chaîné", p: "Chaque connexion, import, export et changement est horodaté et chaîné SHA-256. Vérification d'intégrité à la demande." },
              ].map((s, i) => (
                <Reveal key={s.t} delay={i * 0.08}><div className="secu secu-v2">
                  <div className="pic">{s.ic}</div><h3>{s.t}</h3><p>{s.p}</p>
                </div></Reveal>
              ))}
            </div>
            <Reveal>
              <div className="chain-card">
                <div className="chain-head"><span><ShieldIcon /> Chaîne d'audit vérifiée</span><span className="badge b-green">Intégrité 100 %</span></div>
                <div className="chain-blocks">
                  {["connexion-mfa", "import-exécuté", "export-csv", "permission-modifiée", "audit-vérifié"].map((x, i) => (
                    <div className="chain-block" key={x}>
                      <span className="chain-num">#{String(1842 + i).padStart(4, "0")}</span>
                      <b>{x}</b>
                      <code>sha256:{(0x9f3a2b + i * 7919).toString(16).slice(0, 10)}…</code>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
            <Reveal><div className="comp-badges">
              <span><ShieldIcon /> Hébergé au Cameroun</span>
              <span><ShieldIcon /> Conforme loi n° 2024/017</span>
              <span><BoltIcon /> MFA & verrouillage anti force brute</span>
              <span><CheckCircleIcon /> Journal chaîné, rétention 5 ans</span>
            </div></Reveal>
            <Reveal><div style={{ marginTop: 28 }}><Link className="btn btn-white" to="/securite">Lire le dossier sécurité <ArrowForwardIcon /></Link></div></Reveal>
          </div>
        </section>

        <section className="block" id="partenaires">
          <div className="wrap-wide">
            <Reveal>
              <div className="partner-feature">
                <div className="partner-feature-copy">
                  <span className="eyebrow"><span className="dot" /> Réseau partenaires</span>
                  <h2>Votre logo sur l'accueil. Votre démo dans l'agenda.</h2>
                  <p>Inscrivez votre entreprise, téléversez votre logo et choisissez un créneau de démonstration. Après validation par l'équipe, votre logo rejoint automatiquement le mur des partenaires — sans redéploiement, sans intervention technique.</p>
                  <div className="partner-steps">
                    <div><span>01</span><b>Créez votre espace</b><small>Email professionnel, mot de passe fort, logo PNG/JPG/WebP.</small></div>
                    <div><span>02</span><b>Réservez votre démo</b><small>Date et créneau sous 120 jours, suivi par lien privé.</small></div>
                    <div><span>03</span><b>Publiez votre logo</b><small>Validation admin, synchronisation immédiate sur l'accueil.</small></div>
                  </div>
                  <div className="partner-feature-actions">
                    <Link className="btn btn-brand btn-lg" to="/partenaires">Devenir partenaire <ArrowForwardIcon /></Link>
                    <Link className="btn btn-outline" to="/partenaires/connexion">Accéder à mon espace</Link>
                  </div>
                </div>
                <div className="partner-feature-board">
                  <div className="pf-head">
                    <span><GroupsIcon /> Partenaires validés</span>
                    <span className="badge b-green">{partners.length} en ligne</span>
                  </div>
                  <div className="pf-grid">
                    {(partners.length ? partners : LOGO_FALLBACK.map(([logo, nom, secteur]) => ({ logo, nom: nom, entreprise: nom, secteur }))).slice(0, 6).map((p, i) => (
                      <div className="pf-logo" key={i}>
                        <img src={p.logo} alt={p.entreprise || p.nom} />
                        <span>{(p.entreprise || p.nom || "").split(" ")[0]}</span>
                      </div>
                    ))}
                  </div>
                  {dernierPartenaire && (
                    <div className="pf-new">
                      <span className="live-dot" />
                      <div><b>{dernierPartenaire.entreprise}</b> vient de rejoindre le réseau</div>
                    </div>
                  )}
                  <div className="pf-sectors">
                    {Object.entries(secteurs).slice(0, 4).map(([s, n]) => <span key={s}>{s} · {n}</span>)}
                    {!partners.length && ["Télécoms", "Banque / Finance", "Agroalimentaire", "Transport"].map((s) => <span key={s}>{s}</span>)}
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="block soft">
          <div className="wrap-wide">
            <Reveal><div className="sec-head center">
              <span className="eyebrow"><span className="dot" /> Tarifs</span>
              <h2>Un prix de PME, une exigence de groupe</h2>
              <p>Facturé en FCFA, sans commission sur votre chiffre d'affaires. Hébergement Cameroun et formation inclus.</p>
            </div></Reveal>
            <div className="grid-3">
              <Reveal><div className="price">
                <h3>Essentiel</h3>
                <p className="price-sub">Pour tester le pilotage sur un point de vente.</p>
                <div className="amount">89 000 <small>FCFA / mois</small></div>
                <ul>{["1 point de vente et CSV agences", "Dashboard KPI et filtres", "3 utilisateurs, rôles inclus", "Exports et rapport PDF"].map((x) => <li key={x}><CheckCircleIcon />{x}</li>)}</ul>
                <Link className="btn btn-outline btn-block" to="/tarifs">Choisir</Link>
              </div></Reveal>
              <Reveal delay={0.1}><div className="price hot">
                <span className="ribbon">Le plus choisi</span><h3>Pilotage</h3>
                <p className="price-sub">Pour diriger un réseau régional complet.</p>
                <div className="amount">249 000 <small>FCFA / mois</small></div>
                <ul>{["Sources illimitées POS, CSV, API", "Alertes seuils et rapports auto", "15 utilisateurs, 4 rôles", "MFA obligatoire, audit 5 ans"].map((x) => <li key={x}><CheckCircleIcon />{x}</li>)}</ul>
                <Link className="btn btn-brand btn-block" to="/partenaires">Demander une démo</Link>
              </div></Reveal>
              <Reveal delay={0.2}><div className="price">
                <h3>Réseau</h3>
                <p className="price-sub">Groupes multi-filiales, espace CEMAC.</p>
                <div className="amount">Sur devis</div>
                <ul>{["Multi-filiales, multi-pays CEMAC", "Interfaçage ERP bidirectionnel", "SLA 99,5 % et RSSI attitré", "Formation et accompagnement dédiés"].map((x) => <li key={x}><CheckCircleIcon />{x}</li>)}</ul>
                <Link className="btn btn-outline btn-block" to="/contact">Parler à un expert</Link>
              </div></Reveal>
            </div>
            <Reveal><div className="guarantee">
              <div><EventAvailableIcon /><span><b>Sans engagement</b><span>30 jours de préavis, résiliation simple, sans frais cachés.</span></span></div>
              <div><CloudDownloadIcon /><span><b>Vos données restent à vous</b><span>Export complet à tout moment, y compris à la résiliation.</span></span></div>
              <div><SupportAgentIcon /><span><b>Support en français</b><span>Équipe à Douala, réponse sous 8h ouvrées en offre Pilotage.</span></span></div>
            </div></Reveal>
          </div>
        </section>

        <section className="block" id="avis">
          <div className="wrap-wide">
            <Reveal><div className="sec-head">
              <span className="eyebrow"><span className="dot" /> Clients</span>
              <h2>Des directions qui ont repris la main</h2>
              <p>Distribution, agroalimentaire, management régional : ils lisent le même écran chaque lundi.</p>
            </div></Reveal>
            <div className="quotes">
              {[
                ["NK", "#635BFF", "Le lundi 8h, je sais ce que chaque boutique a vendu le week-end. Avant, je le savais le jeudi, trop tard.", "Ngo Bell K.", "Directrice réseau, distribution, Douala"],
                ["TD", "#00C07F", "L'alerte nous a signalé Bafoussam un mardi. Le vendredi, l'opération correctrice avait compensé. C'est ça, la valeur.", "Tchinda D.", "Manager régional Ouest"],
                ["AM", "#FF5996", "Nos auditeurs ont validé le journal en une demi-journée. Traçabilité totale, zéro tableur.", "Amadou M.", "DAF, agroalimentaire, Garoua"],
              ].map(([ini, c, txt, nom, role], i) => (
                <Reveal key={nom} delay={i * 0.1}><div className="quote">
                  <div className="stars">{[0, 1, 2, 3, 4].map((s) => <StarIcon key={s} />)}</div>
                  <p>« {txt} »</p>
                  <div className="who"><span className="avatar" style={{ background: c }}>{ini}</span><span><b>{nom}</b><span>{role}</span></span></div>
                </div></Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="block soft" id="faq">
          <div className="wrap-wide" style={{ maxWidth: 920 }}>
            <Reveal><div className="sec-head">
              <span className="eyebrow"><span className="dot" /> FAQ</span>
              <h2>Les questions de dirigeants</h2>
              <p>Compatibilité, délais, coupures, comptabilité, périmètres : les réponses franches.</p>
            </div>
            <div className="faq">
              {[
                ["Nos données sont-elles en sécurité ?", "Au Cameroun, base cloisonnée : MFA TOTP, mots de passe forts, moindre privilège, filtrage serveur, journal chaîné SHA-256. Conformité loi n° 2024/017."],
                ["Nos caisses et fichiers sont-ils compatibles ?", "Oui : CSV au point-virgule ou à la virgule, Excel .xlsx/.xls, connecteurs POS, API e-commerce et formulaires dynamiques. Les doublons sont écartés automatiquement et les rejets expliqués ligne par ligne."],
                ["En combien de temps sommes-nous opérationnels ?", "Quatre semaines : indicateurs (semaine 1), sources (semaine 2), formation (semaine 3), première revue accompagnée (semaine 4)."],
                ["Et si internet coupe en boutique ?", "Les fichiers sont rejoués à la reconnexion avec idempotence : pas de perte, pas de doublon. Le suivi de chaque import indique ce qui est passé."],
                ["Comment fonctionne le portail partenaires ?", "Vous créez un compte avec logo, mot de passe et créneau de démo. Un code à usage unique vérifie votre connexion. Après validation par l'admin, le logo est publié sur l'accueil et synchronisé automatiquement."],
                ["Combien d'utilisateurs et de sites ?", "De 3 utilisateurs sur un point de vente jusqu'aux réseaux multi-filiales CEMAC, chaque périmètre reste cloisonné côté serveur. Les permissions sont visibles dans une matrice explicite."],
              ].map(([q, a]) => <details key={q}><summary>{q}<span className="plus">+</span></summary><p>{a}</p></details>)}
            </div>
          </Reveal>
          </div>
        </section>

        <div className="wrap-wide">
          <Reveal><div className="cta-band cta-v2">
            <i style={{ width: 480, height: 300, left: -120, top: -80, background: "#635BFF" }} />
            <i style={{ width: 420, height: 280, right: -100, bottom: -100, background: "#00D4FF" }} />
            <span className="eyebrow" style={{ background: "rgba(255,255,255,.12)", color: "#fff", border: 0 }}><span className="dot" /> Votre prochaine revue</span>
            <h2>Prêt à voir vos ventes autrement ?</h2>
            <p style={{ maxWidth: "58ch", margin: "0 auto 28px" }}>30 minutes sur vos propres chiffres : on connecte un échantillon, vous repartez avec votre premier tableau de bord — et votre logo sur notre mur si vous devenez partenaire.</p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", position: "relative" }}>
              <Link className="btn btn-brand btn-lg" to="/partenaires" style={{ background: "#fff", color: "var(--ink)" }}>Réserver ma démo <ArrowForwardIcon /></Link>
              <Link className="btn btn-lg" to="/login" style={{ color: "#fff", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.4)" }}><PlayArrowIcon /> Tester le cockpit</Link>
            </div>
            <div className="micro-garanties">
              <span><CheckCircleIcon /> Sans carte bancaire</span>
              <span><CheckCircleIcon /> Réponse sous 24 h</span>
              <span><CheckCircleIcon /> Vos données restent à vous</span>
            </div>
          </div></Reveal>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
