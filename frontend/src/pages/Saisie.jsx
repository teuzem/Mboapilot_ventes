import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import PointOfSaleIcon from "@mui/icons-material/PointOfSale";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import BoltIcon from "@mui/icons-material/Bolt";
import SearchIcon from "@mui/icons-material/Search";
import CategoryIcon from "@mui/icons-material/Category";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import PlaceIcon from "@mui/icons-material/Place";
import StorefrontIcon from "@mui/icons-material/Storefront";
import ShieldIcon from "@mui/icons-material/Shield";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import RefreshIcon from "@mui/icons-material/Refresh";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { api, fmt } from "../api";
import { useAuth } from "../auth";
import { Badge, PageHead, Spinner, Toast } from "../components";

const CANAUX = ["POS", "Agence", "E-commerce"];
const TAUX_MARGE = {
  Alimentaire: 0.22, Agricole: 0.38, Boissons: 0.30,
  Textile: 0.45, Cosmetique: 0.50, Equipement: 0.18,
};
const AUJOURDHUI = new Date().toISOString().slice(0, 10);

function aujourdHui() { return new Date().toISOString().slice(0, 10); }

export default function Saisie() {
  const { user, can } = useAuth();
  const [catalogue, setCatalogue] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [toast, setToast] = useState(null);
  const [envoi, setEnvoi] = useState("");
  const [recherche, setRecherche] = useState("");
  const [succes, setSucces] = useState(null);
  const [pos, setPos] = useState(null);
  const [f, setF] = useState({
    produit: "", qte: "1", prix_unit: "", remise_pct: "0", canal: "POS",
    region: "", ville: "", point_vente: "", vendeur: "", jour: AUJOURDHUI,
  });

  const message = (txt, tone = "success") => setToast({ message: txt, tone });

  const national = user?.role === "Admin" || user?.role === "Auditeur" || user?.perimetre === "National";
  const regionsDispo = useMemo(() => {
    const toutes = catalogue?.regions || [];
    if (national) return toutes;
    return toutes.includes(user?.perimetre) ? [user.perimetre] : toutes;
  }, [catalogue, national, user]);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const r = await api.get("/api/filtres");
      setCatalogue(r);
      setF((prec) => {
        const premier = r.produits?.[0];
        const region = national
          ? (r.regions?.[0] || "")
          : (r.regions?.includes(user?.perimetre) ? user.perimetre : (r.regions?.[0] || ""));
        return {
          ...prec,
          produit: prec.produit || premier?.produit || "",
          prix_unit: prec.prix_unit || String(Math.round(premier?.prix || 0)),
          region: prec.region || region,
          vendeur: prec.vendeur || user?.nom || user?.login || "",
          jour: prec.jour || aujourdHui(),
        };
      });
    } catch (ex) {
      message(ex.message, "error");
    } finally {
      setChargement(false);
    }
  }, [national, user]);

  useEffect(() => { charger(); }, [charger]);

  const produits = catalogue?.produits || [];
  const produitsFiltres = useMemo(() => {
    const texte = recherche.trim().toLowerCase();
    if (!texte) return produits;
    return produits.filter((p) => [p.produit, p.famille].some((x) => String(x).toLowerCase().includes(texte)));
  }, [produits, recherche]);

  const produitCourant = useMemo(() => produits.find((p) => p.produit === f.produit) || null, [produits, f.produit]);

  const choisirProduit = (p) => {
    setF((prec) => ({ ...prec, produit: p.produit, prix_unit: String(Math.round(p.prix || 0)) }));
    setSucces(null);
  };

  const set = (cle) => (e) => {
    setF((prec) => ({ ...prec, [cle]: e.target.value }));
    if (cle === "qte" || cle === "prix_unit" || cle === "remise_pct") setSucces(null);
  };

  const nombre = (v) => {
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };

  const qte = Math.max(0, Math.floor(nombre(f.qte)));
  const prix = Math.max(0, nombre(f.prix_unit));
  const remise = Math.min(100, Math.max(0, nombre(f.remise_pct)));
  const montant = Math.round(qte * prix * (1 - remise / 100));
  const cout = produitCourant ? Math.round(montant * (1 - (TAUX_MARGE[produitCourant.famille] ?? 0.25))) : 0;
  const marge = montant - cout;
  const taux = montant ? (marge / montant) * 100 : 0;
  const regionAutorisee = regionsDispo.length === 0 || regionsDispo.includes(f.region);

  const envoyer = async (e) => {
    e?.preventDefault();
    setSucces(null);
    if (!f.produit) return message("Sélectionnez un produit du catalogue.", "error");
    if (!qte || qte < 1) return message("La quantité doit être au moins 1.", "error");
    if (!prix || prix <= 0) return message("Le prix unitaire doit être strictement positif.", "error");
    if (remise < 0 || remise > 50) return message("La remise doit être comprise entre 0 et 50 %.", "error");
    if (!f.region) return message("Sélectionnez une région.", "error");
    if (!regionAutorisee) return message("Cette région n'est pas dans votre périmètre.", "error");
    setEnvoi("vente");
    try {
      const r = await api.post("/api/ventes-manuelle", {
        produit: f.produit, qte, prix_unit: prix, remise_pct: remise,
        canal: f.canal, region: f.region, ville: f.ville, point_vente: f.point_vente,
        vendeur: f.vendeur, jour: f.jour,
      });
      setSucces({ ...r, montant: r.montant ?? montant, produit: f.produit, famille: produitCourant?.famille, canal: f.canal, region: r.region || f.region, qte });
      message(`Vente enregistrée : ${r.ref}.`);
      setF((prec) => ({ ...prec, qte: "1", remise_pct: "0" }));
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("mboa:sale"));
    } catch (ex) {
      message(ex.message, "error");
    }
    setEnvoi("");
  };

  const posPush = async () => {
    setEnvoi("pos");
    try {
      const r = await api.post("/api/pos-push");
      if (r.ok) {
        setPos(`Vente live ${r.ref} · ${fmt(r.montant)} FCFA encaissée.`);
        message(`Encaissement POS ${r.ref} injecté dans le flux direct.`);
      } else {
        setPos("Doublon écarté par le contrôle d'idempotence.");
        message("Doublon écarté, aucun doublon inséré.", "warn");
      }
      window.dispatchEvent(new CustomEvent("mboa:sale"));
    } catch (ex) {
      message(ex.message, "error");
    }
    setEnvoi("");
  };

  if (chargement && !catalogue) {
    return <div className="panel" style={{ padding: 60, textAlign: "center" }}><Spinner label="Chargement du catalogue et de vos périmètres…" /></div>;
  }

  if (!can("sales.write")) {
    return (
      <>
        <PageHead eyebrow="Encaissement" title="Saisie d'une vente" sub="Votre rôle ne permet pas d'enregistrer une vente." />
        <div className="panel" style={{ padding: 30 }}>
          <div className="form-note"><ShieldIcon /> Seuls les rôles Admin, Manager et Commercial disposent du droit <code>sales.write</code>. Contactez un administrateur si vous pensez qu'il s'agit d'une erreur.</div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Encaissement & terrain"
        title="Saisir une vente"
        sub="Le geste commercial de bout en bout : produit du catalogue, quantité, remise et point de vente. La ligne rejoint immédiatement le cockpit et le flux direct."
        actions={
          <button className="btn btn-ghost" onClick={charger} disabled={chargement}><RefreshIcon /> Recharger le catalogue</button>
        }
      />

      <div className="pos-strip">
        <span><span className="live-dot" /> Caisse live disponible</span>
        <span className="faint" style={{ fontSize: 10.5 }}>Injecte une vente simulée sur la journée de référence, visible dans le tableau de bord.</span>
        {pos && <span className="ok-inline">{pos}</span>}
        <button className="btn btn-outline btn-sm" onClick={posPush} disabled={envoi === "pos"}>
          {envoi === "pos" ? <><Spinner inline label="" /> Encaissement…</> : <><BoltIcon /> Simuler un encaissement POS</>}
        </button>
      </div>

      <div className="sale-layout">
        <div className="sale-form">
          <section className="panel">
            <div className="dash-panel-head" style={{ marginBottom: 12 }}>
              <div>
                <h2><CategoryIcon style={{ fontSize: 18, color: "var(--brand)", verticalAlign: "-3px" }} /> Catalogue produits</h2>
                <p className="hint" style={{ marginBottom: 0 }}>Sélectionnez la référence vendue. Le prix catalogue se remplit automatiquement.</p>
              </div>
              <Badge tone="brand">{produitsFiltres.length} référence(s)</Badge>
            </div>
            <div className="audit-search" style={{ marginBottom: 10 }}>
              <SearchIcon />
              <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher un produit ou une famille…" aria-label="Rechercher un produit" />
            </div>
            <div className="sale-catalog">
              {produitsFiltres.map((p) => (
                <button type="button" key={p.produit} className={"catalog-item" + (p.produit === f.produit ? " on" : "")} onClick={() => choisirProduit(p)}>
                  <span><PointOfSaleIcon /></span>
                  <div>
                    <b>{p.produit}</b>
                    <small>{p.famille} · {fmt(p.prix)} FCFA</small>
                  </div>
                  {p.produit === f.produit && <CheckCircleIcon style={{ fontSize: 15, color: "var(--brand)" }} />}
                </button>
              ))}
              {produitsFiltres.length === 0 && <p className="faint" style={{ fontSize: 11.5, padding: 8 }}>Aucun produit ne correspond à cette recherche.</p>}
            </div>
          </section>

          <section className="panel" style={{ marginTop: 16 }}>
            <h2><ReceiptLongIcon style={{ fontSize: 18, color: "var(--brand)", verticalAlign: "-3px" }} /> Détail de l'encaissement</h2>
            <p className="hint">Les contrôles serveur refusent les dates futures, les remises supérieures à 50 % et les régions hors périmètre.</p>
            <form onSubmit={envoyer}>
              <div className="cols-2">
                <div className="field">
                  <label>Produit sélectionné</label>
                  <input value={f.produit} onChange={set("produit")} required list="catalogue-produits" placeholder="Choisissez dans le catalogue" />
                  <datalist id="catalogue-produits">
                    {produits.map((p) => <option key={p.produit} value={p.produit}>{p.famille} · {fmt(p.prix)} FCFA</option>)}
                  </datalist>
                  {produitCourant && <small>Famille {produitCourant.famille} · prix catalogue {fmt(produitCourant.prix)} FCFA</small>}
                </div>
                <div className="field">
                  <label>Date de la vente</label>
                  <input type="date" value={f.jour} max={AUJOURDHUI} onChange={set("jour")} required />
                </div>
              </div>

              <div className="cols-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label>Quantité</label>
                  <div style={{ display: "flex", gap: 5 }}>
                    <button type="button" className="icon-btn" onClick={() => setF((p) => ({ ...p, qte: String(Math.max(1, (parseInt(p.qte, 10) || 1) - 1)) }))} aria-label="Diminuer"><RemoveIcon /></button>
                    <input type="number" min="1" max="100000" step="1" value={f.qte} onChange={set("qte")} required style={{ textAlign: "center" }} />
                    <button type="button" className="icon-btn" onClick={() => setF((p) => ({ ...p, qte: String((parseInt(p.qte, 10) || 0) + 1) }))} aria-label="Augmenter"><AddIcon /></button>
                  </div>
                </div>
                <div className="field">
                  <label>Prix unitaire (FCFA)</label>
                  <input type="number" min="1" step="1" value={f.prix_unit} onChange={set("prix_unit")} required />
                </div>
                <div className="field">
                  <label>Remise (%)</label>
                  <input type="number" min="0" max="50" step="0.5" value={f.remise_pct} onChange={set("remise_pct")} />
                </div>
              </div>

              <div className="cols-2">
                <div className="field">
                  <label>Canal</label>
                  <select value={f.canal} onChange={set("canal")}>
                    {CANAUX.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Région {!national && <span className="faint">· périmètre imposé</span>}</label>
                  <select value={f.region} onChange={set("region")} required disabled={!national && regionsDispo.length <= 1}>
                    {regionsDispo.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              <div className="cols-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label>Ville</label>
                  <input value={f.ville} onChange={set("ville")} maxLength={60} placeholder="ex. Douala" />
                </div>
                <div className="field">
                  <label>Point de vente</label>
                  <input value={f.point_vente} onChange={set("point_vente")} maxLength={80} placeholder="ex. Boutique Akwa" />
                </div>
                <div className="field">
                  <label>Vendeur</label>
                  <input value={f.vendeur} onChange={set("vendeur")} maxLength={80} />
                </div>
              </div>

              <div className="form-note" style={{ marginTop: 4 }}>
                <ShieldIcon /> Écriture journalisée sous <b>{user?.login}</b> · rôle {user?.role} · périmètre {user?.perimetre}.
              </div>
            </form>
          </section>
        </div>

        <aside className="sale-recap">
          <div className="panel">
            <h2><PointOfSaleIcon style={{ fontSize: 17, verticalAlign: "-3px" }} /> Récapitulatif</h2>
            <p className="hint">Vérifiez le montant avant validation. L'écriture est immédiate et irréversible.</p>
            <div className="sale-total">
              <small>Total à encaisser</small>
              <b>{fmt(montant)} <em>FCFA</em></b>
            </div>
            <div className="sale-lines">
              <div><span>{f.produit || "Produit"}</span><b>{qte} × {fmt(prix)} FCFA</b></div>
              <div><span>Remise appliquée</span><b>{remise || 0} %</b></div>
              <div><span>Canal / région</span><b>{f.canal} · {f.region || "-"}</b></div>
              <div><span>Marge brute estimée</span><b>{fmt(marge)} FCFA</b></div>
              <div><span>Taux de marge</span><b>{taux ? `${taux.toFixed(1)} %` : "-"}</b></div>
            </div>
            <button className="btn btn-success btn-block" onClick={envoyer} disabled={envoi === "vente"}>
              {envoi === "vente" ? <><Spinner inline label="" /> Enregistrement…</> : <><CheckCircleIcon /> Valider l'encaissement</>}
            </button>
            {succes && (
              <div className="sale-success">
                <b><CheckCircleIcon style={{ fontSize: 14, verticalAlign: "-2px" }} /> Vente {succes.ref} enregistrée</b>
                {succes.produit} · {succes.qte} unité(s) · {fmt(succes.montant)} FCFA · {succes.region}
                <div className="row-actions" style={{ marginTop: 8 }}>
                  <Link className="btn btn-outline btn-sm" to="/app">Voir le tableau de bord <ArrowForwardIcon /></Link>
                </div>
              </div>
            )}
            {!regionAutorisee && <div className="alert" style={{ marginTop: 10 }}>Région hors de votre périmètre.</div>}
          </div>

          <div className="sale-side" style={{ marginTop: 14 }}>
            <div className="panel">
              <h2><PlaceIcon style={{ fontSize: 17, color: "var(--brand)", verticalAlign: "-3px" }} /> Votre périmètre</h2>
              <p className="hint" style={{ marginBottom: 8 }}>Les écritures sont automatiquement limitées à votre zone d'habilitation.</p>
              <div className="row-actions">
                <Badge tone="brand">{user?.role}</Badge>
                <Badge tone="gray">{user?.perimetre}</Badge>
                <Badge tone={national ? "green" : "amber"}>{national ? "National" : "Régional"}</Badge>
              </div>
              <div className="form-note" style={{ marginTop: 10 }}>
                <InfoOutlinedIcon /> {national
                  ? "Votre rôle autorise toutes les régions du réseau."
                  : `Seules les ventes de la région ${user?.perimetre} sont acceptées par le serveur.`}
              </div>
            </div>

            <div className="panel">
              <h2><StorefrontIcon style={{ fontSize: 17, color: "var(--brand)", verticalAlign: "-3px" }} /> Bonnes pratiques</h2>
              <div className="stack" style={{ gap: 7 }}>
                <div className="studio-note"><CheckCircleIcon /><span><b>Date réelle.</b> Une vente en retard se saisit à sa date effective, jamais dans le futur.</span></div>
                <div className="studio-note"><CheckCircleIcon /><span><b>Remise maîtrisée.</b> Au-delà de 50 %, utilisez le circuit de validation commerciale.</span></div>
                <div className="studio-note"><CheckCircleIcon /><span><b>Traçabilité.</b> La référence générée et l'auteur sont inscrits au journal d'audit.</span></div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <Toast message={toast?.message} tone={toast?.tone} onClose={() => setToast(null)} />
    </>
  );
}
