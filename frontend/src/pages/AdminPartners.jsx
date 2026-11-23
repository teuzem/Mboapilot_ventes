import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SearchIcon from "@mui/icons-material/Search";
import HandshakeIcon from "@mui/icons-material/Handshake";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import PlaceIcon from "@mui/icons-material/Place";
import CategoryIcon from "@mui/icons-material/Category";
import RefreshIcon from "@mui/icons-material/Refresh";
import { api, dateFR } from "../api";
import { Badge, Empty, Modal, PageHead, Spinner, Toast } from "../components";

const STATUTS = [
  ["tous", "Tous"],
  ["en_attente", "En attente"],
  ["valide", "Validés"],
  ["refuse", "Refusés"],
];
const DEMO = {
  demande: ["Demande envoyée", "amber"],
  confirme: ["Confirmée", "green"],
  realise: ["Réalisée", "brand"],
  annule: ["Annulée", "red"],
};
const TONE = { en_attente: "amber", valide: "green", refuse: "red" };
const LABEL = { en_attente: "En attente", valide: "Validé", refuse: "Refusé" };

function initiales(nom) {
  return String(nom || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join("");
}

export default function AdminPartners() {
  const [statut, setStatut] = useState("tous");
  const [data, setData] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [q, setQ] = useState("");
  const [choix, setChoix] = useState(null);
  const [notes, setNotes] = useState("");
  const [envoi, setEnvoi] = useState("");
  const [toast, setToast] = useState(null);
  const inputLogo = useRef(null);

  const charger = useCallback(async (s = statut) => {
    setChargement(true);
    try {
      const r = await api.get(`/api/partenaires${s !== "tous" ? `?statut=${s}` : ""}`);
      setData(r);
      setChoix((prev) => (prev ? r.partenaires.find((p) => p.id === prev.id) || null : null));
    } catch (ex) {
      setToast({ message: ex.message, tone: "error" });
    } finally {
      setChargement(false);
    }
  }, [statut]);

  useEffect(() => { charger(statut); }, [charger, statut]);

  const liste = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    if (!s) return data.partenaires;
    return data.partenaires.filter((p) =>
      [p.entreprise, p.contact_nom, p.email, p.secteur, p.region, p.telephone]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s))
    );
  }, [data, q]);

  const message = (txt, tone = "success") => setToast({ message: txt, tone });

  const notifierAccueil = () => window.dispatchEvent(new Event("mboa:partners"));

  const changerStatut = async (p, s) => {
    setEnvoi("statut");
    try {
      const r = await api.post(`/api/partenaires/${p.id}/statut`, { statut: s, notes_admin: notes });
      message(r.message);
      notifierAccueil();
      await charger(statut);
    } catch (ex) { message(ex.message, "error"); }
    setEnvoi("");
  };

  const basculerFeatured = async (p) => {
    setEnvoi("featured");
    try {
      const r = await api.post(`/api/partenaires/${p.id}/featured`);
      message(r.message);
      notifierAccueil();
      await charger(statut);
    } catch (ex) { message(ex.message, "error"); }
    setEnvoi("");
  };

  const changerDemo = async (p, demo_statut) => {
    setEnvoi("demo");
    try {
      const r = await api.post(`/api/partenaires/${p.id}/demo`, { demo_statut });
      message(r.message);
      await charger(statut);
    } catch (ex) { message(ex.message, "error"); }
    setEnvoi("");
  };

  const remplacerLogo = async (p, file) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      return message("Format attendu : PNG, JPG ou WebP.", "error");
    }
    if (file.size > 2 * 1024 * 1024) return message("Logo limité à 2 Mo.", "error");
    setEnvoi("logo");
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const r = await api.upload(`/api/partenaires/${p.id}/logo`, fd);
      message(r.message);
      notifierAccueil();
      if (inputLogo.current) inputLogo.current.value = "";
      await charger(statut);
    } catch (ex) { message(ex.message, "error"); }
    setEnvoi("");
  };

  const ouvrir = (p) => {
    setChoix(p);
    setNotes(p.notes_admin || "");
  };

  const stats = data?.stats || {};
  const totalAffiche = data?.total ?? 0;
  const compte = (s) => {
    if (s === "tous") return data?.total ?? 0;
    return stats[s] || 0;
  };

  return (
    <>
      <PageHead
        eyebrow="Réseau & visibilité"
        title="Partenaires"
        sub="Validez les entreprises, publiez leurs logos sur l'accueil et pilotez leurs démonstrations. Chaque décision est journalisée."
        actions={
          <button className="btn btn-outline" onClick={() => charger(statut)} disabled={chargement}>
            <RefreshIcon /> Actualiser
          </button>
        }
      />

      <div className="partner-admin-page">
        <div className="admin-stats">
          <div className="admin-stat">
            <small>Total réseau</small>
            <b>{data?.total ?? "-"}</b>
            <span>dossiers partenaires</span>
          </div>
          <div className="admin-stat warn">
            <small>En attente</small>
            <b>{stats.en_attente ?? 0}</b>
            <span>à examiner sous 24 h</span>
          </div>
          <div className="admin-stat good">
            <small>Validés</small>
            <b>{stats.valide ?? 0}</b>
            <span>logos publiés sur l'accueil</span>
          </div>
          <div className="admin-stat">
            <small>Secteurs</small>
            <b>{data ? new Set(data.partenaires.map((p) => p.secteur).filter(Boolean)).size : "-"}</b>
            <span>représentés dans le réseau</span>
          </div>
        </div>

        <div className="partner-filter-tabs" role="tablist" aria-label="Filtrer par statut">
          {STATUTS.map(([s, label]) => (
            <button key={s} className={statut === s ? "on" : ""} onClick={() => setStatut(s)} role="tab" aria-selected={statut === s}>
              {label} <span className="count">{compte(s)}</span>
            </button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", padding: "0 6px" }}>
            <span className="faint" style={{ fontSize: 10.5 }}>{totalAffiche} dossier(s) affiché(s)</span>
          </div>
        </div>

        <div className="user-toolbar">
          <div className="audit-search" style={{ maxWidth: 340 }}>
            <SearchIcon />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une entreprise, un contact, une région…" aria-label="Rechercher un partenaire" />
          </div>
          <Badge tone="brand">{liste.length} résultat(s)</Badge>
          <span className="faint" style={{ fontSize: 10.5 }}>Un logo validé est publié immédiatement sur la page d'accueil.</span>
        </div>

        {chargement && !data ? (
          <div className="panel" style={{ padding: 50, textAlign: "center" }}><Spinner label="Chargement des partenaires…" /></div>
        ) : liste.length === 0 ? (
          <div className="panel">
            <Empty
              icon={<HandshakeIcon />}
              title={q ? "Aucun résultat" : "Aucun partenaire dans ce filtre"}
              text={q ? "Essayez une autre recherche ou revenez à la liste complète." : "Les nouvelles demandes apparaîtront ici dès leur inscription."}
              action={q ? <button className="btn btn-outline" onClick={() => setQ("")}>Effacer la recherche</button> : null}
            />
          </div>
        ) : (
          <div className="partner-admin-list">
            {liste.map((p) => {
              const demo = DEMO[p.demo_statut] || ["-", "gray"];
              return (
                <article className="partner-admin-card" key={p.id}>
                  <div className="pac-logo">
                    {p.logo_url ? <img src={p.logo_url} alt={`Logo ${p.entreprise}`} /> : <span style={{ fontWeight: 800, color: "#697386" }}>{initiales(p.entreprise)}</span>}
                  </div>
                  <div className="pac-body">
                    <b>
                      {p.entreprise}
                      {p.featured ? <StarIcon className="pac-star" titleAccess="Mis en avant" /> : null}
                      <Badge tone={TONE[p.statut]}>{LABEL[p.statut]}</Badge>
                      <Badge tone={demo[1]}>{demo[0]}</Badge>
                    </b>
                    <div className="pac-meta">
                      <span>{initiales(p.contact_nom)} {p.contact_nom}</span>
                      <span>{p.email_masque || p.email}</span>
                      <span><CategoryIcon /> {p.secteur || "-"}</span>
                      <span><PlaceIcon /> {p.region || "-"}</span>
                      <span><EventAvailableIcon /> {p.demo_date ? `${dateFR(p.demo_date)} · ${p.demo_creneau}` : "démo non planifiée"}</span>
                    </div>
                    {p.notes_admin && <div className="partner-notes-preview">Note : {p.notes_admin}</div>}
                  </div>
                  <div className="pac-actions">
                    <button className="icon-btn" title={p.featured ? "Retirer de la mise en avant" : "Mettre en avant"} onClick={() => basculerFeatured(p)} disabled={Boolean(envoi)}>
                      {p.featured ? <StarIcon style={{ color: "#E09B00" }} /> : <StarBorderIcon />}
                    </button>
                    <button className="btn btn-outline" onClick={() => ouvrir(p)}>Dossier</button>
                    {p.statut !== "valide" && (
                      <button className="btn btn-success" onClick={() => changerStatut(p, "valide")} disabled={Boolean(envoi)}>
                        <CheckCircleIcon /> Valider
                      </button>
                    )}
                    {p.statut === "en_attente" && (
                      <button className="btn btn-ghost" onClick={() => changerStatut(p, "refuse")} disabled={Boolean(envoi)}>
                        <CancelIcon /> Refuser
                      </button>
                    )}
                    {p.statut === "valide" && (
                      <button className="btn btn-ghost" onClick={() => changerStatut(p, "en_attente")} disabled={Boolean(envoi)}>
                        <HourglassTopIcon /> Remettre en attente
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={Boolean(choix)}
        onClose={() => setChoix(null)}
        title={choix ? choix.entreprise : ""}
        subtitle={choix ? `${choix.contact_nom} · ${choix.email_masque || choix.email}` : ""}
        wide
        footer={choix ? (
          <>
            <button className="btn btn-ghost" onClick={() => setChoix(null)}>Fermer</button>
            <button
              className="btn btn-outline"
              onClick={() => basculerFeatured(choix)}
              disabled={Boolean(envoi)}
            >
              {choix.featured ? <StarIcon /> : <StarBorderIcon />} {choix.featured ? "Retirer la mise en avant" : "Mettre en avant"}
            </button>
            {choix.statut !== "valide" && <button className="btn btn-success" onClick={() => changerStatut(choix, "valide")} disabled={Boolean(envoi)}><CheckCircleIcon /> Valider & publier</button>}
            {choix.statut !== "refuse" && <button className="btn btn-danger" onClick={() => changerStatut(choix, "refuse")} disabled={Boolean(envoi)}><CancelIcon /> Refuser</button>}
          </>
        ) : null}
      >
        {choix && (
          <div className="partner-detail">
            <div className="partner-detail-head">
              {choix.logo_url ? <img src={choix.logo_url} alt={`Logo ${choix.entreprise}`} /> : <div className="logo-preview-lg">{initiales(choix.entreprise)}</div>}
              <div>
                <h3>{choix.entreprise} {choix.featured && <StarIcon style={{ fontSize: 16, color: "#E09B00" }} />}</h3>
                <p>{choix.contact_nom} · {choix.email_masque || choix.email} · {choix.telephone || "téléphone non renseigné"}</p>
                <div className="row-actions" style={{ marginTop: 6 }}>
                  <Badge tone={TONE[choix.statut]}>{LABEL[choix.statut]}</Badge>
                  <Badge tone={(DEMO[choix.demo_statut] || ["", "gray"])[1]}>{(DEMO[choix.demo_statut] || ["Démo -"])[0]}</Badge>
                  <Badge tone="gray">{choix.secteur || "Secteur -"}</Badge>
                </div>
              </div>
              {choix.site_web && (
                <a className="btn btn-outline btn-sm" href={choix.site_web} target="_blank" rel="noreferrer">
                  Site web <OpenInNewIcon />
                </a>
              )}
            </div>

            <div className="detail-dl">
              <div><small>Région</small><b>{choix.region || "-"}</b></div>
              <div><small>Taille</small><b>{choix.taille || "-"}</b></div>
              <div><small>Date de démo</small><b>{choix.demo_date ? `${dateFR(choix.demo_date)} · ${choix.demo_creneau}` : "-"}</b></div>
              <div><small>Inscrit le</small><b>{dateFR(choix.cree_le, true)}</b></div>
              <div><small>Dernière mise à jour</small><b>{dateFR(choix.maj_le, true)}</b></div>
              <div><small>Validation</small><b>{choix.valide_le ? dateFR(choix.valide_le, true) : "-"}</b></div>
            </div>

            {choix.message && <div className="detail-block"><b>Message du partenaire</b>{choix.message}</div>}

            <div className="detail-block">
              <b>Logo affiché sur l'accueil</b>
              <div className="logo-preview-lg" style={{ margin: "6px 0 8px" }}>
                {choix.logo_url ? <img src={choix.logo_url} alt={`Logo ${choix.entreprise}`} /> : <span className="faint">Aucun logo</span>}
              </div>
              <div className="logo-replace">
                <input ref={inputLogo} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => remplacerLogo(choix, e.target.files?.[0])} />
                <button className="btn btn-outline btn-sm" onClick={() => inputLogo.current?.click()} disabled={envoi === "logo"}>
                  <CloudUploadIcon /> Remplacer le logo
                </button>
                <span className="faint" style={{ fontSize: 9.5 }}>PNG, JPG ou WebP · 2 Mo max · publication immédiate si validé.</span>
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label>Statut de la démonstration</label>
                <select
                  value={choix.demo_statut || "demande"}
                  onChange={(e) => changerDemo(choix, e.target.value)}
                  disabled={envoi === "demo"}
                >
                  {Object.entries(DEMO).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Statut du dossier</label>
                <select
                  value={choix.statut}
                  onChange={(e) => changerStatut(choix, e.target.value)}
                  disabled={Boolean(envoi)}
                >
                  <option value="en_attente">En attente</option>
                  <option value="valide">Validé</option>
                  <option value="refuse">Refusé</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label>Note interne (visible uniquement par les admins)</label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Contexte de validation, informations à vérifier, décision de refus…"
              />
              <small>La note est enregistrée avec la prochaine décision de statut.</small>
            </div>
          </div>
        )}
      </Modal>

      <Toast message={toast?.message} tone={toast?.tone} onClose={() => setToast(null)} />
    </>
  );
}
