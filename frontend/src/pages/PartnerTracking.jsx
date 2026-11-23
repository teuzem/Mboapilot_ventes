import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import CancelIcon from "@mui/icons-material/Cancel";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import SyncIcon from "@mui/icons-material/Sync";
import ShieldIcon from "@mui/icons-material/Shield";
import GroupsIcon from "@mui/icons-material/Groups";
import { SiteHeader, SiteFooter, Spinner, Badge } from "../components";
import { api, dateFR } from "../api";

export default function PartnerTracking() {
  const { token } = useParams();
  const [p, setP] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.get(`/api/partenaires/suivi/${encodeURIComponent(token)}`)
      .then((r) => setP(r.partenaire))
      .catch((ex) => setErr(ex.message));
  }, [token]);

  const statut = p?.statut || "en_attente";
  const ton = statut === "valide" ? "green" : statut === "refuse" ? "red" : "amber";
  return (
    <>
      <SiteHeader />
      <main className="tracking-page">
        {err ? (
          <div className="success-card">
            <div className="success-ic warn"><CancelIcon /></div>
            <h1>Lien invalide</h1>
            <p>{err}</p>
            <Link className="btn btn-brand" to="/partenaires">Ouvrir le portail partenaires <ArrowForwardIcon /></Link>
          </div>
        ) : !p ? (
          <Spinner label="Chargement de votre suivi…" />
        ) : (
          <div className="tracking-grid">
            <div className="tracking-card">
              <div className="tracking-head">
                <div className="tracking-logo">{p.logo_url ? <img src={p.logo_url} alt={p.entreprise} /> : <GroupsIcon />}</div>
                <div>
                  <span className="page-eyebrow">Suivi de candidature</span>
                  <h1>{p.entreprise}</h1>
                  <p>{p.contact_nom} · {p.email_masque} · {p.secteur}</p>
                </div>
                <Badge tone={ton}>{statut === "valide" ? "Validé" : statut === "refuse" ? "Refusé" : "En attente"}</Badge>
              </div>
              <div className="tracking-message"><ShieldIcon /><p>{p.message}</p></div>
              <div className="tracking-timeline">
                <div className="done"><span><CheckCircleIcon /></span><div><b>Demande reçue</b><small>{dateFR(p.cree_le, true)}</small></div></div>
                <div className={statut !== "en_attente" ? "done" : "on"}>
                  <span>{statut === "en_attente" ? <HourglassTopIcon /> : <CheckCircleIcon />}</span>
                  <div><b>Revue de l'équipe</b><small>{statut === "en_attente" ? "En cours · réponse sous 24 h ouvrées" : statut === "valide" ? `Validé le ${dateFR(p.valide_le)}` : "Décision rendue"}</small></div>
                </div>
                <div className={statut === "valide" ? "done" : ""}>
                  <span><SyncIcon /></span>
                  <div><b>Logo sur la page d'accueil</b><small>{statut === "valide" ? "Publié automatiquement" : "Après validation"}</small></div>
                </div>
                <div className={p.demo_statut === "realise" ? "done" : ""}>
                  <span><EventAvailableIcon /></span>
                  <div><b>Démonstration</b><small>{p.demo_date ? `${dateFR(p.demo_date)} · ${p.demo_creneau}` : "Créneau à confirmer"} · {p.demo_statut}</small></div>
                </div>
              </div>
              <div className="tracking-actions">
                <Link className="btn btn-brand" to="/partenaires/connexion">Accéder à mon espace <ArrowForwardIcon /></Link>
                <Link className="btn btn-outline" to="/">Voir le site</Link>
              </div>
            </div>
            <aside className="tracking-aside">
              <div className="panel">
                <h2><ShieldIcon /> Pourquoi ce lien ?</h2>
                <p className="hint">Ce lien privé vous permet de suivre votre demande sans mot de passe. Ne le partagez pas : il contient un jeton unique.</p>
              </div>
              <div className="panel">
                <h2>Votre logo</h2>
                {p.logo_url ? <div className="tracking-logo-preview"><img src={p.logo_url} alt={p.entreprise} /></div> : <p className="hint">Aucun logo reçu.</p>}
                <p className="hint" style={{ marginTop: 10 }}>{statut === "valide" ? "Visible sur la page d'accueil. Mettez-le à jour depuis votre espace, il se synchronise." : "Il sera publié après validation de votre compte."}</p>
              </div>
              <div className="panel">
                <h2>Besoin d'aide ?</h2>
                <p className="hint">Écrivez à <a href="mailto:partenaires@mboapilot.cm">partenaires@mboapilot.cm</a> en rappelant votre entreprise et votre email de contact.</p>
              </div>
            </aside>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
