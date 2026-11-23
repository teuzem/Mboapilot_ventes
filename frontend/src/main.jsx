import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import "./theme.css";
import "./wow.css";
import "./v2.css";
import { AuthProvider, useAuth } from "./auth";
import Landing from "./pages/Landing";
import Features from "./pages/Features";
import Pricing from "./pages/Pricing";
import Security from "./pages/Security";
import Contact from "./pages/Contact";
import Legal from "./pages/Legal";
import Login from "./pages/Login";
import Mfa from "./pages/Mfa";
import Inscription from "./pages/Inscription";
import Reset from "./pages/Reset";
import PartnersLanding from "./pages/PartnersLanding";
import PartnerLogin from "./pages/PartnerLogin";
import PartnerSpace from "./pages/PartnerSpace";
import PartnerTracking from "./pages/PartnerTracking";
import AppLayout from "./pages/AppLayout";
import Dashboard from "./pages/Dashboard";
import Saisie from "./pages/Saisie";
import Imports from "./pages/Imports";
import Users from "./pages/Users";
import Compte from "./pages/Compte";
import AdminPartners from "./pages/AdminPartners";
import Audit from "./pages/Audit";
import Rapport from "./pages/Rapport";
import Connecteurs from "./pages/Connecteurs";
import { Spinner } from "./components";
import { activerNotifications } from "./push";

function ScrollTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const t = setTimeout(() => document.querySelector(hash)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      return () => clearTimeout(t);
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

function Garde({ children, perm }) {
  const { user, ready, can } = useAuth();
  if (!ready) return <div className="boot"><Spinner label="Ouverture de votre espace…" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (perm && !can(perm)) {
    return (
      <div className="forbidden">
        <span className="page-eyebrow">Accès restreint</span>
        <h1>Habilitation insuffisante</h1>
        <p>Votre rôle <b>{user.role}</b> ne permet pas d'ouvrir cette page. Contactez un administrateur si vous pensez qu'il s'agit d'une erreur.</p>
      </div>
    );
  }
  return children;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

activerNotifications().catch(() => {});

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <AuthProvider>
      <ScrollTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/fonctionnalites" element={<Features />} />
        <Route path="/tarifs" element={<Pricing />} />
        <Route path="/securite" element={<Security />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/mentions-legales" element={<Legal page="mentions-legales" />} />
        <Route path="/confidentialite" element={<Legal page="confidentialite" />} />
        <Route path="/cgu" element={<Legal page="cgu" />} />
        <Route path="/login" element={<Login />} />
        <Route path="/mfa" element={<Mfa />} />
        <Route path="/inscription" element={<Inscription />} />
        <Route path="/reset" element={<Reset />} />
        <Route path="/reset/:token" element={<Reset />} />
        <Route path="/partenaires" element={<PartnersLanding />} />
        <Route path="/partenaires/connexion" element={<PartnerLogin />} />
        <Route path="/partenaires/espace" element={<PartnerSpace />} />
        <Route path="/partenaires/suivi/:token" element={<PartnerTracking />} />
        <Route path="/app" element={<Garde><AppLayout /></Garde>}>
          <Route index element={<Dashboard />} />
          <Route path="saisie" element={<Garde perm="sales.write"><Saisie /></Garde>} />
          <Route path="imports" element={<Garde perm="imports.read"><Imports /></Garde>} />
          <Route path="connecteurs" element={<Garde perm="imports.write"><Connecteurs /></Garde>} />
          <Route path="partenaires" element={<Garde perm="partners.manage"><AdminPartners /></Garde>} />
          <Route path="users" element={<Garde perm="users.manage"><Users /></Garde>} />
          <Route path="audit" element={<Garde perm="audit.view"><Audit /></Garde>} />
          <Route path="rapport" element={<Garde perm="reports.view"><Rapport /></Garde>} />
          <Route path="compte" element={<Compte />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>
);
