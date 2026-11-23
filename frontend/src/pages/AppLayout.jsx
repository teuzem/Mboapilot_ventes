import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import DashboardIcon from "@mui/icons-material/Dashboard";
import PointOfSaleIcon from "@mui/icons-material/PointOfSale";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CloudSyncIcon from "@mui/icons-material/CloudSync";
import GroupIcon from "@mui/icons-material/Group";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import DescriptionIcon from "@mui/icons-material/Description";
import LogoutIcon from "@mui/icons-material/Logout";
import PublicIcon from "@mui/icons-material/Public";
import HandshakeIcon from "@mui/icons-material/Handshake";
import ManageAccountsIcon from "@mui/icons-material/ManageAccounts";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { Logo } from "../components";
import NotificationBell from "../components/NotificationBell";
import { useAuth } from "../auth";

const SECTIONS = [
  {
    label: "Pilotage",
    items: [
      { to: "/app", end: true, label: "Tableau de bord", icon: <DashboardIcon /> },
      { to: "/app/saisie", label: "Saisie vente", icon: <PointOfSaleIcon />, perm: "sales.write" },
      { to: "/app/imports", label: "Collecte & imports", icon: <CloudUploadIcon />, perm: "imports.read" },
      { to: "/app/connecteurs", label: "Connecteurs & ETL", icon: <CloudSyncIcon />, perm: "imports.write" },
    ],
  },
  {
    label: "Réseau",
    items: [
      { to: "/app/partenaires", label: "Partenaires", icon: <HandshakeIcon />, perm: "partners.manage" },
      { to: "/app/users", label: "Utilisateurs", icon: <GroupIcon />, perm: "users.manage" },
    ],
  },
  {
    label: "Contrôle",
    items: [
      { to: "/app/audit", label: "Journal d'audit", icon: <ReceiptLongIcon />, perm: "audit.view" },
      { to: "/app/rapport", label: "Rapport signé", icon: <DescriptionIcon />, perm: "reports.view" },
    ],
  },
];

function initiales(nom) {
  return String(nom || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join("");
}

export default function AppLayout() {
  const { user, can, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [ouvert, setOuvert] = useState(false);

  useEffect(() => { setOuvert(false); }, [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = ouvert ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [ouvert]);

  const deconnexion = async () => {
    await logout();
    nav("/", { replace: true });
  };

  return (
    <div className="app app-shell">
      <aside className={"sidebar app-side" + (ouvert ? " open" : "")} aria-label="Navigation de l'espace client">
        <div className="side-brand">
          <Logo />
          <button className="icon-btn side-close" onClick={() => setOuvert(false)} aria-label="Fermer le menu"><CloseIcon /></button>
        </div>
        <div className="side-scroll">
          <nav className="side-nav">
            {SECTIONS.map((section) => {
              const items = section.items.filter((i) => !i.perm || can(i.perm));
              if (!items.length) return null;
              return (
                <div className="side-group" key={section.label}>
                  <span className="side-group-label">{section.label}</span>
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) => "side-link" + (isActive ? " on" : "")}
                    >
                      {item.icon}<span>{item.label}</span><ChevronRightIcon className="side-chev" />
                    </NavLink>
                  ))}
                </div>
              );
            })}
            <div className="side-group">
              <span className="side-group-label">Compte</span>
              <NavLink to="/app/compte" className={({ isActive }) => "side-link" + (isActive ? " on" : "")}>
                <ManageAccountsIcon /><span>Mon compte & MFA</span><ChevronRightIcon className="side-chev" />
              </NavLink>
              <Link className="side-link" to="/"><PublicIcon /><span>Voir le site</span></Link>
            </div>
          </nav>
        </div>
        <div className="side-foot">
          <Link to="/app/compte" className="side-user">
            <span className="side-avatar">{initiales(user?.nom)}</span>
            <span className="side-user-info">
              <b>{user?.nom}</b>
              <small>{user?.role}{user?.perimetre ? " · " + user.perimetre : ""}</small>
            </span>
          </Link>
          <button className="side-logout" onClick={deconnexion}><LogoutIcon /> Déconnexion</button>
        </div>
      </aside>

      {ouvert && <div className="drawer-back" onClick={() => setOuvert(false)} aria-hidden="true" />}

      <main className="main app-main">
        <div className="app-topbar">
          <NotificationBell />
        </div>
        <div className="mobile-bar">
          <button className="icon-btn" onClick={() => setOuvert(true)} aria-label="Ouvrir le menu"><MenuIcon /></button>
          <Logo />
          <Link to="/app/compte" className="mobile-avatar" aria-label="Mon compte">{initiales(user?.nom)}</Link>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
