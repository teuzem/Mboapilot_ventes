import { useEffect, useState } from "react";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { api, fmt } from "../api";
import { useAuth } from "../auth";

const CANAUX = ["POS", "Agence", "E-commerce"];

export default function Saisie() {
  const { user } = useAuth();
  const [cat, setCat] = useState({ produits: [], regions: [] });
  const [f, setF] = useState({ produit: "", qte: "1", prix_unit: "", remise_pct: "0", canal: "POS", region: "", ville: "", point_vente: "", vendeur: "", jour: new Date().toISOString().slice(0, 10) });
  const [msg, setMsg] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    api.get("/api/filtres").then((r) => {
      setCat(r);
      setF((p) => ({
        ...p,
        produit: r.produits[0]?.produit || "",
        prix_unit: String(Math.round(r.produits[0]?.prix || 0)),
        region: (user?.role === "Admin" || user?.perimetre === "National") ? (r.regions[0] || "") : (user?.perimetre || ""),
        vendeur: user?.nom || "",
      }));
    }).catch(() => {});
  }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const choisirProduit = (e) => {
    const p = cat.produits.find((x) => x.produit === e.target.value);
    setF({ ...f, produit: e.target.value, prix_unit: p ? String(Math.round(p.prix)) : f.prix_unit });
  };
  const montant = Math.max(0, Math.round((parseFloat(f.qte) || 0) * (parseFloat(f.prix_unit) || 0) * (1 - (parseFloat(f.remise_pct) || 0) / 100)));
  const verrouille = user?.role !== "Admin" && user?.perimetre !== "National";

  const envoyer = async (e) => {
    e.preventDefault(); setMsg(null); setEnvoi(true);
    try {
      const r = await api.post("/api/ventes-manuelle", {
        produit: f.produit, qte: parseInt(f.qte, 10), prix_unit: parseFloat(f.prix_unit),
        remise_pct: parseFloat(f.remise_pct), canal: f.canal, region: f.region,
        ville: f.ville, point_vente: f.point_vente, vendeur: f.vendeur, jour: f.jour,
      });
      setMsg({ ok: true, txt: `Vente enregistrée : ${r.ref}, ${fmt(r.montant)} FCFA.` });
    } catch (ex) { setMsg({ ok: false, txt: ex.message }); }
    setEnvoi(false);
  };
  return (<>
    <div className="topbar"><h1>Saisie manuelle d'une vente</h1><span className="who"><span className="role-pill">{verrouille ? "Périmètre : " + user?.perimetre + " (imposé)" : "Tous périmètres"}</span></span></div>
    <p style={{ color: "var(--muted)", marginTop: -12 }}>Ticket de caisse, vente comptoir ou régularisation : contrôlée, journalisée, dédupliquée par référence unique.</p>
    {msg && <div className={msg.ok ? "ok" : "alert"}>{msg.txt}</div>}
    <div className="cols-2">
      <div className="panel"><h2>Ticket de vente</h2>
        <form onSubmit={envoyer}>
          <div className="field"><label>Produit (catalogue)</label>
            <select value={f.produit} onChange={choisirProduit}>{cat.produits.map((p) => <option key={p.produit} value={p.produit}>{p.produit} ({p.famille})</option>)}</select></div>
          <div style={{ display: "flex", gap: 10 }}>
            <div className="field"><label>Quantité</label><input type="number" min="1" max="1000" value={f.qte} onChange={set("qte")} required /></div>
            <div className="field"><label>Prix unitaire (FCFA)</label><input type="number" min="1" value={f.prix_unit} onChange={set("prix_unit")} required /></div>
            <div className="field"><label>Remise %</label><input type="number" min="0" max="50" step="0.5" value={f.remise_pct} onChange={set("remise_pct")} /></div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div className="field"><label>Canal</label><select value={f.canal} onChange={set("canal")}>{CANAUX.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div className="field"><label>Région {verrouille && "(imposée)"}</label>
              {verrouille
                ? <input value={f.region} disabled />
                : <select value={f.region} onChange={set("region")}>{cat.regions.map((r) => <option key={r}>{r}</option>)}</select>}</div>
            <div className="field"><label>Date</label><input type="date" value={f.jour} onChange={set("jour")} required /></div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div className="field"><label>Ville / point de vente</label><input value={f.point_vente} onChange={set("point_vente")} placeholder="ex. Akwa, boutique 3" /></div>
            <div className="field"><label>Vendeur</label><input value={f.vendeur} onChange={set("vendeur")} placeholder="Nom du vendeur" /></div>
          </div>
          <button className="btn btn-brand btn-lg btn-block" disabled={envoi}>{envoi ? "Enregistrement…" : `Encaisser ${fmt(montant)} FCFA`}</button>
        </form></div>
      <div>
        <div className="panel"><h2>Récapitulatif temps réel</h2>
          <table className="grid"><tbody>
            <tr><td>Montant TTC</td><td className="num"><b>{fmt(montant)} FCFA</b></td></tr>
            <tr><td>Marge estimée</td><td className="num">{fmt(Math.round(montant * 0.28))} FCFA</td></tr>
            <tr><td>Devise</td><td className="num">FCFA (XAF)</td></tr>
            <tr><td>Traçabilité</td><td className="num">référence unique + journal</td></tr>
          </tbody></table></div>
        <div className="panel"><h2>Bonnes pratiques</h2>
          <p className="hint" style={{ display: "flex", gap: 8 }}><CheckCircleIcon style={{ color: "var(--green)" }} /> Un ticket = une vente réelle, jamais de doublon : la référence est générée côté serveur.</p>
          <p className="hint" style={{ display: "flex", gap: 8 }}><CheckCircleIcon style={{ color: "var(--green)" }} /> Pour les volumes, préférez l'import CSV/Excel (page Collecte).</p>
        </div>
      </div>
    </div>
  </>);
}
