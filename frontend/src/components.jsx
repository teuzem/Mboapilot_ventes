import { Link, NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import MenuIcon from "@mui/icons-material/Menu";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ShieldIcon from "@mui/icons-material/Shield";
import { classe } from "./api";

export function Logo({ light = false }) {
  return (
    <Link className="wordmark" to="/" style={light ? { color: "#fff" } : undefined} aria-label="MboaPilot, accueil">
      <img src="/logo.svg" alt="" />
      <b style={light ? { color: "#fff" } : undefined}>mboapilot</b>
    </Link>
  );
}

const NAV = [
  ["Produit", "/fonctionnalites"],
  ["Méthode", "/#methode"],
  ["Partenaires", "/partenaires"],
  ["Tarifs", "/tarifs"],
  ["Sécurité", "/securite"],
];

export function SiteHeader() {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const f = () => setSolid(window.scrollY > 16);
    window.addEventListener("scroll", f, { passive: true });
    f();
    return () => window.removeEventListener("scroll", f);
  }, []);
  return (
    <>
      <div className="announce">
        <span className="live-dot" style={{ marginRight: 8 }} />
        Nouveau : <b>MFA par authenticator</b>, portail partenaires et studio d'imports Excel
        <Link to="/partenaires" className="announce-link">Réserver une démo <ArrowForwardIcon /></Link>
      </div>
      <header className={"site-head" + (solid || open ? " solid" : "")}>
        <div className="wrap-wide bar">
          <Logo />
          <nav className="site-nav" aria-label="Navigation principale">
            {NAV.map(([label, to]) => (
              <NavLink key={label} to={to} className={({ isActive }) => (isActive && !to.includes("#") ? "on" : "")}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="head-actions">
            <Link className="btn btn-ghost" to="/login">Se connecter</Link>
            <Link className="btn btn-brand" to="/partenaires">Réserver une démo <ArrowForwardIcon /></Link>
            <button className="menu-btn" onClick={() => setOpen((v) => !v)} aria-label="Ouvrir le menu" aria-expanded={open}>
              {open ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>
        {open && (
          <div className="mobile-nav">
            {NAV.map(([label, to]) => <Link key={label} to={to} onClick={() => setOpen(false)}>{label}</Link>)}
            <Link to="/login" onClick={() => setOpen(false)}>Se connecter</Link>
            <Link to="/partenaires" className="btn btn-brand" onClick={() => setOpen(false)}>Réserver une démo</Link>
          </div>
        )}
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="wrap-wide">
        <div className="foot-cta">
          <div>
            <span className="eyebrow" style={{ marginBottom: 10 }}><span className="dot" /> Prêt quand vous l'êtes</span>
            <h2>Vos chiffres méritent un vrai cockpit.</h2>
            <p>Réservez 30 minutes avec notre équipe : nous branchons un échantillon de vos données et vous repartez avec votre premier tableau de bord.</p>
          </div>
          <div className="foot-cta-actions">
            <Link className="btn btn-brand btn-lg" to="/partenaires">Réserver ma démo <ArrowForwardIcon /></Link>
            <Link className="btn btn-outline btn-lg" to="/login">Explorer la démo live</Link>
            <span className="foot-secure"><ShieldIcon /> Sans carte bancaire · données hébergées au Cameroun</span>
          </div>
        </div>
        <div className="foot-grid">
          <div>
            <Logo />
            <p style={{ color: "var(--muted)", marginTop: 14, maxWidth: "34ch" }}>
              Le pilotage commercial pensé pour l'Afrique : données FCFA en temps réel, sécurité de niveau bancaire.
            </p>
            <p style={{ color: "var(--faint)", fontSize: 13 }}>Bonanjo, Douala, Cameroun · contact@mboapilot.cm</p>
          </div>
          <div>
            <h4>Produit</h4>
            <Link to="/fonctionnalites">Fonctionnalités</Link>
            <Link to="/tarifs">Tarifs</Link>
            <Link to="/securite">Sécurité</Link>
            <Link to="/login">Espace client</Link>
          </div>
          <div>
            <h4>Écosystème</h4>
            <Link to="/partenaires">Devenir partenaire</Link>
            <Link to="/partenaires/connexion">Espace partenaire</Link>
            <Link to="/#methode">Méthode de déploiement</Link>
            <Link to="/#faq">FAQ</Link>
          </div>
          <div>
            <h4>Légal</h4>
            <Link to="/mentions-legales">Mentions légales</Link>
            <Link to="/confidentialite">Confidentialité</Link>
            <Link to="/cgu">CGU</Link>
            <Link to="/contact">Contact</Link>
          </div>
        </div>
        <div className="foot-bottom">
          <span>© 2026 MboaPilot SARL, Douala, Cameroun. Tous droits réservés.</span>
          <span className="foot-status"><span className="live-dot" /> Tous systèmes opérationnels</span>
          <span>FCFA · données hébergées au Cameroun</span>
        </div>
      </div>
    </footer>
  );
}

export function Reveal({ children, delay = 0, className = "", as: Tag = "div" }) {
  const [vis, setVis] = useState(false);
  const [node, setNode] = useState(null);
  useEffect(() => {
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { setVis(true); io.disconnect(); }
      }),
      { threshold: 0.12 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [node]);
  return (
    <Tag ref={setNode} className={className} style={{
      opacity: vis ? 1 : 0,
      transform: vis ? "none" : "translateY(26px)",
      transition: `opacity .7s var(--spring) ${delay}s, transform .7s var(--spring) ${delay}s`,
    }}>{children}</Tag>
  );
}

export function Modal({ open, onClose, title, subtitle, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label={title || "Fenêtre"} onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose?.();
    }}>
      <div className={"modal" + (wide ? " modal-wide" : "")}>
        <div className="modal-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer"><CloseIcon /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Toast({ message, tone = "success", onClose, duration = 5200 }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => onClose?.(), duration);
    return () => clearTimeout(t);
  }, [message, tone, duration, onClose]);
  if (!message) return null;
  return (
    <div className={"toast toast-" + tone} role="status">
      <span className="toast-dot" />
      <div>{message}</div>
      <button onClick={onClose} aria-label="Fermer"><CloseIcon /></button>
    </div>
  );
}

export function PageHead({ eyebrow, title, sub, actions }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <span className="page-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Badge({ tone = "gray", children }) {
  return <span className={"badge b-" + tone}>{children}</span>;
}

export function Spinner({ label = "Chargement…", inline = false }) {
  return (
    <span className={"spinner-wrap" + (inline ? " inline" : "")}>
      <span className="spinner" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Empty({ icon, title, text, action }) {
  return (
    <div className="empty">
      {icon && <div className="empty-ic">{icon}</div>}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function CopyButton({ value, label = "Copier", className = "" }) {
  const [done, setDone] = useState(false);
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch { /* clipboard refusé */ }
  };
  return (
    <button type="button" className={"copy-btn " + className} onClick={copier}>
      {done ? <CheckIcon /> : <ContentCopyIcon />} {done ? "Copié" : label}
    </button>
  );
}

export function PasswordStrength({ value }) {
  const score = [
    value.length >= 12,
    /[A-Z]/.test(value) && /[a-z]/.test(value),
    /[0-9]/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ].filter(Boolean).length;
  const mots = ["Très faible", "Faible", "Correct", "Fort", "Excellent"];
  const cols = ["#DF1B41", "#DF1B41", "#FFC247", "#00C07F", "#00C07F"];
  return (
    <div className="pw-strength">
      <span className="meter"><i style={{ width: `${score * 25}%`, background: cols[score] }} /></span>
      <small style={{ color: score >= 3 ? "var(--green)" : "var(--muted)" }}>{value ? mots[score] : "12 caractères minimum"}</small>
    </div>
  );
}

export function Money({ value, className = "" }) {
  return <span className={classe("money", className)}>{new Intl.NumberFormat("fr-FR").format(Math.round(Number(value) || 0))} <small>FCFA</small></span>;
}
