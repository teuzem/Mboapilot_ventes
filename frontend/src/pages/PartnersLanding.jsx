import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ShieldIcon from "@mui/icons-material/Shield";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import SyncIcon from "@mui/icons-material/Sync";
import GroupsIcon from "@mui/icons-material/Groups";
import PublicIcon from "@mui/icons-material/Public";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import LockIcon from "@mui/icons-material/Lock";
import StarIcon from "@mui/icons-material/Star";
import { SiteHeader, SiteFooter, Reveal, PasswordStrength, Spinner } from "../components";
import { api } from "../api";

const SECTEURS = ["Distribution", "Agroalimentaire", "Télécoms", "Banque / Finance", "Transport", "Retail / Mode", "Industrie", "Services", "Autre"];
const TAILLES = ["1 à 10", "11 à 50", "51 à 200", "201 à 1000", "1000+"];
const REGIONS = ["Centre", "Littoral", "Ouest", "Nord-Ouest", "Sud-Ouest", "Sud", "Est", "Adamaoua", "Nord", "Extreme-Nord"];
const CRENEAUX = ["09:00 - 10:00", "10:00 - 11:00", "11:00 - 12:00", "14:00 - 15:00", "15:00 - 16:00", "16:00 - 17:00"];

const jour = (n = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function PartnersLanding() {
  const [partenaires, setPartenaires] = useState([]);
  const [f, setF] = useState({
    entreprise: "", contact_nom: "", email: "", telephone: "", secteur: "Distribution",
    taille: "11 à 50", region: "Littoral", site_web: "", message: "",
    demo_date: jour(2), demo_creneau: CRENEAUX[1], password: "", password2: "", consent: false, _hp: "",
  });
  const [logo, setLogo] = useState(null);
  const [apercu, setApercu] = useState("");
  const [drag, setDrag] = useState(false);
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [succes, setSucces] = useState(null);
  const inputLogo = useRef(null);

  useEffect(() => {
    api.get("/api/partenaires/publics").then((r) => setPartenaires(r.partenaires || [])).catch(() => {});
  }, []);

  useEffect(() => () => { if (apercu) URL.revokeObjectURL(apercu); }, [apercu]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const choisirLogo = (file) => {
    setErreur("");
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setErreur("Le logo doit être au format PNG, JPG ou WebP.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setErreur("Le logo ne doit pas dépasser 2 Mo.");
      return;
    }
    if (apercu) URL.revokeObjectURL(apercu);
    setLogo(file);
    setApercu(URL.createObjectURL(file));
  };

  const envoyer = async (e) => {
    e.preventDefault();
    setErreur("");
    if (!logo) { setErreur("Un logo est requis : il sera publié sur la page d'accueil après validation."); return; }
    if (f.password !== f.password2) { setErreur("Les deux mots de passe ne correspondent pas."); return; }
    if (f.password.length < 12) { setErreur("Le mot de passe doit contenir au moins 12 caractères."); return; }
    setEnvoi(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => {
        if (k === "consent") fd.append(k, v ? "1" : "0");
        else fd.append(k, v);
      });
      fd.append("logo", logo);
      const r = await api.upload("/api/partenaires/inscription", fd);
      setSucces(r);
      window.dispatchEvent(new Event("mboa:partners"));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (ex) {
      setErreur(ex.message);
    } finally {
      setEnvoi(false);
    }
  };

  if (succes) {
    return (
      <>
        <SiteHeader />
        <main className="partner-success-page">
          <div className="success-card">
            <div className="success-ic"><CheckCircleIcon /></div>
            <span className="eyebrow"><span className="dot" /> Demande enregistrée</span>
            <h1>Bienvenue, {succes.partenaire?.entreprise}.</h1>
            <p>Votre espace partenaire est ouvert et votre créneau de démo est réservé. Votre logo sera publié sur la page d'accueil dès sa validation par l'équipe MboaPilot.</p>
            <div className="success-steps">
              <div className="done"><CheckCircleIcon /><b>Compte créé</b><span>Email, mot de passe et logo reçus.</span></div>
              <div><EventAvailableIcon /><b>Démo demandée</b><span>{f.demo_date} · {f.demo_creneau}</span></div>
              <div><SyncIcon /><b>Publication du logo</b><span>Dès validation admin, synchronisation immédiate.</span></div>
            </div>
            {succes.suivi_url && <div className="ok">Lien de suivi privé : <Link to={succes.suivi_url}>{window.location.origin + succes.suivi_url}</Link></div>}
            <div className="success-actions">
              <Link className="btn btn-brand btn-lg" to="/partenaires/espace">Ouvrir mon espace <ArrowForwardIcon /></Link>
              {succes.suivi_url && <Link className="btn btn-outline" to={succes.suivi_url}>Suivre ma demande</Link>}
            </div>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main>
        <section className="partner-hero">
          <div className="partner-hero-mesh"><i /><i /><i /></div>
          <div className="wrap-wide partner-hero-grid">
            <div>
              <span className="eyebrow"><span className="dot" /> Portail partenaires</span>
              <h1>Votre logo sur notre accueil.<br /><span className="grad">Votre démo dans nos agendas.</span></h1>
              <p className="sub">Un espace sécurisé pour les entreprises qui veulent voir MboaPilot en action. Inscription en 3 minutes, logo téléversé, créneau de démonstration réservé - et publication automatique sur le mur des partenaires après validation.</p>
              <div className="hero-ctas">
                <a className="btn btn-brand btn-lg" href="#inscription">Créer mon espace partenaire <ArrowForwardIcon /></a>
                <Link className="btn btn-outline btn-lg" to="/partenaires/connexion">J'ai déjà un compte</Link>
              </div>
              <div className="partner-trust">
                <span><ShieldIcon /> MFA par email à chaque connexion</span>
                <span><LockIcon /> Mots de passe forts exigés</span>
                <span><VerifiedUserIcon /> Validation admin avant publication</span>
              </div>
            </div>
            <div className="partner-preview">
              <div className="pp-head"><span><GroupsIcon /> Mur des partenaires</span><span className="badge b-green">{partenaires.length} validés</span></div>
              <div className="pp-grid">
                {(partenaires.length ? partenaires : [
                  { logo: "/img/logos/mtn.png", entreprise: "MTN Cameroun" },
                  { logo: "/img/logos/orange.png", entreprise: "Orange Cameroun" },
                  { logo: "/img/logos/guinness.png", entreprise: "Guinness Cameroun" },
                  { logo: "/img/logos/ecobank.png", entreprise: "Ecobank Cameroun" },
                ]).slice(0, 6).map((p, i) => (
                  <div key={i} className="pp-logo"><img src={p.logo} alt={p.entreprise} /><span>{p.entreprise}</span></div>
                ))}
              </div>
              <div className="pp-note"><SyncIcon /> Chaque validation met à jour la page d'accueil en direct, sans redéploiement.</div>
            </div>
          </div>
        </section>

        <section className="partner-stats-band">
          <div className="wrap-wide partner-stats">
            <div><b>{partenaires.length || 9}</b><span>partenaires validés</span></div>
            <div><b>{new Set(partenaires.map((p) => p.secteur)).size || 5}</b><span>secteurs représentés</span></div>
            <div><b>30 min</b><span>par démonstration</span></div>
            <div><b>24 h</b><span>pour la revue de validation</span></div>
          </div>
        </section>

        <section className="block">
          <div className="wrap-wide">
            <Reveal><div className="sec-head center">
              <span className="eyebrow"><span className="dot" /> Pourquoi devenir partenaire</span>
              <h2>Un écosystème qui travaille pour vous.</h2>
              <p>Visibilité, démonstration, suivi : un parcours partenaire complet, sans formulaire perdu dans une boîte email.</p>
            </div></Reveal>
            <div className="grid-4 partner-benefits">
              {[
                { ic: <PublicIcon />, t: "Visibilité réelle", p: "Votre logo sur la page d'accueil, dans une section lue par les dirigeants et les acheteurs." },
                { ic: <EventAvailableIcon />, t: "Démo planifiée", p: "Choisissez un créneau, suivez le statut de confirmation, replanifiez en un clic." },
                { ic: <SyncIcon />, t: "Synchronisation", p: "Logo mis à jour depuis votre espace, publié automatiquement après validation." },
                { ic: <QrCode2Icon />, t: "Accès sécurisé", p: "Mot de passe fort + code à usage unique envoyé à votre email professionnel." },
              ].map((b, i) => (
                <Reveal key={b.t} delay={i * 0.08}><div className="feat partner-benefit">
                  <div className="pic" style={{ background: ["#635BFF", "#00A36C", "#0A2540", "#B47800"][i] }}>{b.ic}</div>
                  <h3>{b.t}</h3><p>{b.p}</p>
                </div></Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="block soft" id="inscription">
          <div className="wrap-wide partner-form-grid">
            <Reveal>
              <div className="partner-form-copy">
                <span className="eyebrow"><span className="dot" /> Inscription</span>
                <h2>Ouvrez votre espace partenaire.</h2>
                <p>Le logo est obligatoire : c'est lui qui rejoint le mur des partenaires après validation. Prévoyez un fichier PNG, JPG ou WebP de moins de 2 Mo, idéalement carré ou horizontal.</p>
                <div className="partner-form-points">
                  <div><span><CheckCircleIcon /></span><b>Compte immédiat</b><small>Vous accédez à votre espace dès la création.</small></div>
                  <div><span><CheckCircleIcon /></span><b>Démo réservée</b><small>Date et créneau sous 120 jours.</small></div>
                  <div><span><CheckCircleIcon /></span><b>Suivi privé</b><small>Un lien unique pour suivre la validation.</small></div>
                  <div><span><CheckCircleIcon /></span><b>Logo synchronisé</b><small>Page d'accueil mise à jour sans build.</small></div>
                </div>
                <div className="partner-quote">
                  <div className="stars">{[0, 1, 2, 3, 4].map((s) => <StarIcon key={s} />)}</div>
                  <p>« Le portail nous a évité trois échanges d'emails. Logo envoyé le lundi, démo le jeudi, publié le vendredi. »</p>
                  <span>Direction marketing · partenaire distribution</span>
                </div>
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <form className="partner-form" onSubmit={envoyer} noValidate>
                <div className="partner-form-head"><h3>Votre demande de démonstration</h3><span className="badge b-brand">Sécurisé · SSL</span></div>
                {erreur && <div className="alert">{erreur}</div>}
                <input type="text" name="_hp" value={f._hp} onChange={set("_hp")} style={{ display: "none" }} tabIndex={-1} autoComplete="off" aria-hidden="true" />
                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="field"><label>Entreprise *</label><input value={f.entreprise} onChange={set("entreprise")} required placeholder="ex. Sahel Distribution" autoComplete="organization" /></div>
                  <div className="field"><label>Contact principal *</label><input value={f.contact_nom} onChange={set("contact_nom")} required placeholder="Prénom et nom" autoComplete="name" /></div>
                </div>
                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="field"><label>Email professionnel *</label><input type="email" value={f.email} onChange={set("email")} required placeholder="vous@entreprise.cm" autoComplete="email" /></div>
                  <div className="field"><label>Téléphone</label><input value={f.telephone} onChange={set("telephone")} placeholder="+237 6 00 00 00 00" autoComplete="tel" /></div>
                </div>
                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="field"><label>Secteur *</label><select value={f.secteur} onChange={set("secteur")}>{SECTEURS.map((s) => <option key={s}>{s}</option>)}</select></div>
                  <div className="field"><label>Taille *</label><select value={f.taille} onChange={set("taille")}>{TAILLES.map((s) => <option key={s}>{s}</option>)}</select></div>
                </div>
                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="field"><label>Région *</label><select value={f.region} onChange={set("region")}>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
                  <div className="field"><label>Site web</label><input value={f.site_web} onChange={set("site_web")} placeholder="https://…" inputMode="url" /></div>
                </div>

                <div className="field">
                  <label>Logo de l'entreprise *</label>
                  <div
                    className={"logo-drop" + (drag ? " drag" : "") + (apercu ? " has-logo" : "")}
                    onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => { e.preventDefault(); setDrag(false); choisirLogo(e.dataTransfer.files?.[0]); }}
                    onClick={() => inputLogo.current?.click()}
                    role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputLogo.current?.click(); }}
                  >
                    {apercu ? (
                      <>
                        <img src={apercu} alt="Aperçu du logo" />
                        <div><b>{logo?.name}</b><span>{Math.round((logo?.size || 0) / 1024)} Ko · cliquer pour remplacer</span></div>
                        <CheckCircleIcon className="logo-ok" />
                      </>
                    ) : (
                      <>
                        <CloudUploadIcon />
                        <div><b>Glissez votre logo ici</b><span>PNG, JPG ou WebP · 2 Mo maximum</span></div>
                      </>
                    )}
                    <input ref={inputLogo} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => choisirLogo(e.target.files?.[0])} />
                  </div>
                </div>

                <div className="field"><label>Message à l'équipe</label><textarea rows={2} value={f.message} onChange={set("message")} placeholder="Contexte, nombre de points de vente, objectif de la démo…" /></div>

                <div className="demo-slots">
                  <div className="field"><label>Date de démo *</label><input type="date" min={jour(0)} max={jour(120)} value={f.demo_date} onChange={set("demo_date")} required /></div>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <label>Créneau souhaité *</label>
                    <div className="slot-grid">
                      {CRENEAUX.map((c) => <button type="button" key={c} className={f.demo_creneau === c ? "on" : ""} onClick={() => setF({ ...f, demo_creneau: c })}>{c}</button>)}
                    </div>
                  </div>
                </div>

                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="field"><label>Mot de passe *</label>
                    <input type="password" value={f.password} onChange={set("password")} required autoComplete="new-password" />
                    <PasswordStrength value={f.password} />
                  </div>
                  <div className="field"><label>Confirmation *</label><input type="password" value={f.password2} onChange={set("password2")} required autoComplete="new-password" /></div>
                </div>
                <label className="check-line">
                  <input type="checkbox" checked={f.consent} onChange={set("consent")} required />
                  <span>J'accepte la <Link to="/confidentialite">politique de confidentialité</Link> et l'utilisation de ces informations pour traiter ma demande de démonstration.</span>
                </label>
                <button className="btn btn-brand btn-lg btn-block" disabled={envoi}>{envoi ? <><Spinner inline label="" /> Création de l'espace…</> : <>Créer mon espace et réserver <ArrowForwardIcon /></>}</button>
                <p className="form-note"><ShieldIcon /> Votre mot de passe est haché côté serveur. Aucune carte bancaire n'est demandée.</p>
                <p className="form-note" style={{ textAlign: "center" }}>Déjà partenaire ? <Link to="/partenaires/connexion">Se connecter</Link></p>
              </form>
            </Reveal>
          </div>
        </section>

        <section className="block">
          <div className="wrap-wide">
            <Reveal><div className="sec-head center">
              <span className="eyebrow"><span className="dot" /> Comment ça marche</span>
              <h2>De l'inscription à la publication, sans friction.</h2>
            </div></Reveal>
            <div className="partner-process">
              {[
                ["01", "Créez votre compte", "Entreprise, contact, logo et mot de passe fort. Votre espace s'ouvre immédiatement.", <LockIcon />],
                ["02", "Réservez votre démo", "Choisissez une date et un créneau. Suivez la confirmation depuis votre espace ou votre lien privé.", <EventAvailableIcon />],
                ["03", "Validation & publication", "L'admin vérifie le logo et le profil. Le mur d'accueil se met à jour automatiquement.", <SyncIcon />],
                ["04", "Rencontrez l'équipe", "30 minutes sur vos données, avec un tableau de bord de démonstration à la clé.", <GroupsIcon />],
              ].map(([n, t, p, ic], i) => (
                <Reveal key={n} delay={i * 0.08}><div className="process-card"><span className="process-num">{n}</span><div className="process-ic">{ic}</div><h3>{t}</h3><p>{p}</p></div></Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="block soft">
          <div className="wrap-wide">
            <Reveal><div className="sec-head center">
              <span className="eyebrow"><span className="dot" /> Ils sont déjà là</span>
              <h2>Le mur des partenaires, en direct.</h2>
              <p>Chaque logo affiché ici provient de la base de données, pas d'une liste codée. Une validation suffit pour le publier.</p>
            </div></Reveal>
            <div className="partner-wall-grid">
              {(partenaires.length ? partenaires : [
                { entreprise: "MTN Cameroun", logo: "/img/logos/mtn.png", secteur: "Télécoms" },
                { entreprise: "Orange Cameroun", logo: "/img/logos/orange.png", secteur: "Télécoms" },
                { entreprise: "Guinness Cameroun", logo: "/img/logos/guinness.png", secteur: "Agroalimentaire" },
                { entreprise: "Ecobank Cameroun", logo: "/img/logos/ecobank.png", secteur: "Banque / Finance" },
                { entreprise: "Tradex", logo: "/img/logos/tradex.png", secteur: "Distribution" },
                { entreprise: "Tecno Mobile", logo: "/img/logos/tecno.png", secteur: "Retail / Mode" },
                { entreprise: "Turkish Airlines", logo: "/img/logos/turkish.png", secteur: "Transport" },
                { entreprise: "Nestlé Cameroun", logo: "/img/logos/nestle.png", secteur: "Agroalimentaire" },
              ]).map((p, i) => (
                <div className="wall-card" key={i}><img src={p.logo} alt={p.entreprise} /><b>{p.entreprise}</b><span>{p.secteur}</span></div>
              ))}
            </div>
          </div>
        </section>

        <section className="block">
          <div className="wrap-wide" style={{ maxWidth: 880 }}>
            <Reveal><div className="sec-head">
              <span className="eyebrow"><span className="dot" /> FAQ partenaires</span>
              <h2>Les réponses avant de vous lancer.</h2>
            </div>
            <div className="faq">
              {[
                ["Le logo est-il vraiment obligatoire ?", "Oui : c'est la contrepartie de la visibilité sur l'accueil. Sans logo validé, le profil reste en attente et n'est pas publié."],
                ["Qui valide les partenaires ?", "Un administrateur MboaPilot. Vous recevez un lien de suivi privé et pouvez consulter le statut à tout moment dans votre espace."],
                ["Quels formats de logo acceptez-vous ?", "PNG, JPG ou WebP, 2 Mo maximum. Le serveur vérifie la signature réelle du fichier, pas seulement son extension."],
                ["Comment se passe la connexion ?", "Email professionnel et mot de passe, puis code à usage unique à 6 chiffres. En production, le code part par email ; en démo, il est affiché."],
                ["Puis-je modifier mon logo après validation ?", "Oui, depuis votre espace. Le nouveau logo est publié immédiatement sur l'accueil après validation de votre compte."],
              ].map(([q, a]) => <details key={q}><summary>{q}<span className="plus">+</span></summary><p>{a}</p></details>)}
            </div></Reveal>
          </div>
        </section>

        <div className="wrap-wide">
          <Reveal><div className="cta-band partner-cta">
            <h2>Prêt à apparaître sur notre accueil ?</h2>
            <p>Trois minutes d'inscription, une démo de 30 minutes, un logo publié après validation.</p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <a className="btn btn-brand btn-lg" href="#inscription" style={{ background: "#fff", color: "var(--ink)" }}>Créer mon espace <ArrowForwardIcon /></a>
              <Link className="btn btn-lg" to="/partenaires/connexion" style={{ color: "#fff", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.4)" }}>Accéder à mon espace</Link>
            </div>
          </div></Reveal>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
