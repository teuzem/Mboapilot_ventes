# -*- coding: utf-8 -*-
"""MboaPilot V2 — noyau : configuration, base, sécurité, permissions, helpers."""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta
from functools import wraps
from pathlib import Path

from flask import g, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE = Path(__file__).resolve().parent.parent
DB = BASE / "sales.db"
DIST = BASE / "frontend" / "dist"
UPLOADS = BASE / "uploads"
LOGOS_DIR = UPLOADS / "logos"
LOGOS_DIR.mkdir(parents=True, exist_ok=True)

DEMO = os.environ.get("MBOA_DEMO", "1") == "1"
MFA_OBLIGATOIRE = os.environ.get("MBOA_MFA", "1") == "1"
SESSION_MINUTES = int(os.environ.get("MBOA_SESSION_MINUTES", "30"))
SESSION_MAX_HEURES = int(os.environ.get("MBOA_SESSION_MAX_HOURS", "8"))
MAX_UPLOAD = 24 * 1024 * 1024
MAX_LIGNES_IMPORT = 20000

REGIONS = ["Centre", "Littoral", "Ouest", "Nord-Ouest", "Sud-Ouest", "Sud",
           "Est", "Adamaoua", "Nord", "Extreme-Nord"]
CANAUX = ["POS", "Agence", "E-commerce"]
FAMILLES = ["Alimentaire", "Agricole", "Boissons", "Textile", "Cosmetique", "Equipement"]
ROLES = ["Admin", "Manager", "Commercial", "Auditeur"]
SECTEURS = ["Distribution", "Agroalimentaire", "Télécoms", "Banque / Finance",
            "Transport", "Retail / Mode", "Industrie", "Services", "Autre"]
TAILLES = ["1 à 10", "11 à 50", "51 à 200", "201 à 1000", "1000+"]
CRENEAUX = ["09:00 - 10:00", "10:00 - 11:00", "11:00 - 12:00",
            "14:00 - 15:00", "15:00 - 16:00", "16:00 - 17:00"]
DEVISES = ["FCFA", "XAF", "XOF"]

PERMISSIONS = {
    "dashboard.view": "Consulter le tableau de bord",
    "sales.write": "Enregistrer une vente",
    "imports.read": "Consulter les imports",
    "imports.write": "Importer des données",
    "imports.cancel": "Annuler un import",
    "forms.read": "Utiliser les formulaires dynamiques",
    "forms.manage": "Créer et modifier les formulaires",
    "forms.submit": "Soumettre un formulaire",
    "exports.csv": "Exporter les données",
    "reports.view": "Consulter les rapports",
    "audit.view": "Consulter le journal d'audit",
    "users.manage": "Gérer les utilisateurs",
    "partners.manage": "Gérer les partenaires",
    "partners.read": "Consulter les partenaires",
}
ROLE_PERMISSIONS = {
    "Admin": set(PERMISSIONS.keys()),
    "Manager": {"dashboard.view", "sales.write", "imports.read", "imports.write",
                "forms.read", "forms.manage", "forms.submit", "exports.csv",
                "reports.view", "audit.view", "partners.read"},
    "Commercial": {"dashboard.view", "sales.write", "imports.read", "imports.write",
                   "forms.read", "forms.submit", "exports.csv", "reports.view"},
    "Auditeur": {"dashboard.view", "imports.read", "forms.read", "exports.csv",
                 "reports.view", "audit.view"},
}

CHAMPS_VENTE = {
    "ref": {"label": "Référence", "type": "text", "obligatoire": False},
    "jour": {"label": "Date de la vente", "type": "date", "obligatoire": True},
    "canal": {"label": "Canal", "type": "select", "obligatoire": True, "options": CANAUX},
    "region": {"label": "Région", "type": "select", "obligatoire": True, "options": REGIONS},
    "ville": {"label": "Ville", "type": "text", "obligatoire": False},
    "point_vente": {"label": "Point de vente", "type": "text", "obligatoire": False},
    "vendeur": {"label": "Vendeur", "type": "text", "obligatoire": False},
    "produit": {"label": "Produit", "type": "text", "obligatoire": True},
    "famille": {"label": "Famille", "type": "select", "obligatoire": True, "options": FAMILLES},
    "qte": {"label": "Quantité", "type": "number", "obligatoire": True},
    "prix_unit": {"label": "Prix unitaire (FCFA)", "type": "number", "obligatoire": True},
    "remise_pct": {"label": "Remise (%)", "type": "number", "obligatoire": False},
    "montant": {"label": "Montant TTC (FCFA)", "type": "number", "obligatoire": False},
    "cout_unit": {"label": "Coût unitaire (FCFA)", "type": "number", "obligatoire": False},
    "devise": {"label": "Devise", "type": "select", "obligatoire": False, "options": DEVISES},
}
TAUX_MARGE = {"Alimentaire": 0.22, "Agricole": 0.38, "Boissons": 0.30,
              "Textile": 0.45, "Cosmetique": 0.50, "Equipement": 0.18}

SYNONYMES = {
    "ref": ["ref", "reference", "id", "transaction", "ticket", "numero", "no"],
    "jour": ["jour", "date", "datevente", "date_de_vente", "datedevente", "day", "dat"],
    "canal": ["canal", "channel", "source", "circuit"],
    "region": ["region", "province", "zone", "territoire"],
    "ville": ["ville", "city", "localite", "commune"],
    "point_vente": ["pointvente", "point_de_vente", "pdv", "boutique", "magasin", "site", "agence"],
    "vendeur": ["vendeur", "commercial", "seller", "agent", "caissier"],
    "produit": ["produit", "product", "article", "designation", "libelle"],
    "famille": ["famille", "category", "categorie", "rayon", "gamme"],
    "qte": ["qte", "quantite", "quantity", "qty", "nombre", "volume"],
    "prix_unit": ["prixunit", "prix_unitaire", "prix", "price", "pu", "prixvente", "prixu"],
    "remise_pct": ["remisepct", "remise", "discount", "reduction", "remise_pourcent"],
    "montant": ["montant", "amount", "total", "ca", "chiffre", "montantttc"],
    "cout_unit": ["coutunit", "cout_unitaire", "cout", "cost", "prixachat", "coutu"],
    "devise": ["devise", "currency", "monnaie"],
}

MOTS_INTERDITS = {"password123456", "motdepasse123", "azerty123456", "123456789012",
                  "mboapilot2026", "adminadmin12", "qwerty123456"}

_LIMITES = defaultdict(list)
_LIMITE_LOCK = threading.Lock()


# ---------- Base de données ----------
def db():
    if "cx" not in g:
        g.cx = sqlite3.connect(DB, timeout=30)
        g.cx.row_factory = sqlite3.Row
        g.cx.execute("PRAGMA foreign_keys=ON")
        g.cx.execute("PRAGMA journal_mode=WAL")
    return g.cx


def init_app(app):
    @app.teardown_appcontext
    def close_cx(_e=None):
        cx = g.pop("cx", None)
        if cx is not None:
            cx.close()


def _cols(cx, table):
    return {r[1] for r in cx.execute(f"PRAGMA table_info({table})")}


def _add_col(cx, table, col, ddl):
    if col not in _cols(cx, table):
        cx.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")


def migrate():
    """Migration idempotente : conserve les données existantes."""
    cx = sqlite3.connect(DB, timeout=30)
    cx.row_factory = sqlite3.Row
    cx.execute("PRAGMA journal_mode=WAL")
    cx.execute("""CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT UNIQUE, nom TEXT, role TEXT,
        perimetre TEXT, hash TEXT, mfa_secret TEXT, actif INTEGER DEFAULT 1,
        echecs INTEGER DEFAULT 0, bloque_jusqua TEXT, bloque_def INTEGER DEFAULT 0)""")
    for col, ddl in [
        ("email", "TEXT"), ("telephone", "TEXT"),
        ("mfa_actif", "INTEGER DEFAULT 0"), ("mfa_confirme", "INTEGER DEFAULT 0"),
        ("derniere_connexion", "TEXT"), ("cree_le", "TEXT"),
        ("mot_de_passe_maj", "TEXT"), ("doit_changer_mdp", "INTEGER DEFAULT 0"),
        ("session_version", "INTEGER DEFAULT 1"),
    ]:
        _add_col(cx, "users", col, ddl)

    cx.execute("""CREATE TABLE IF NOT EXISTS recovery_codes(
        id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT NOT NULL,
        code_hash TEXT NOT NULL, utilise INTEGER DEFAULT 0,
        cree_le TEXT DEFAULT (datetime('now')))""")
    cx.execute("""CREATE TABLE IF NOT EXISTS mfa_codes(
        id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT, code TEXT,
        expire TEXT, utilise INTEGER DEFAULT 0, tentatives INTEGER DEFAULT 0)""")
    cx.execute("""CREATE TABLE IF NOT EXISTS reset_tokens(
        id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT, token TEXT UNIQUE,
        expire TEXT, utilise INTEGER DEFAULT 0)""")
    _add_col(cx, "reset_tokens", "cree_le", "TEXT")
    cx.execute("""CREATE TABLE IF NOT EXISTS login_attempts(
        id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT, ip TEXT,
        action TEXT, succes INTEGER, horo TEXT DEFAULT (datetime('now')))""")

    cx.execute("""CREATE TABLE IF NOT EXISTS imports(
        id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, nom_fichier TEXT, jour TEXT,
        lignes_recues INTEGER, lignes_integrees INTEGER, doublons INTEGER,
        rejets INTEGER, statut TEXT, created_at TEXT DEFAULT (datetime('now')))""")
    for col, ddl in [
        ("user_login", "TEXT"), ("type", "TEXT DEFAULT 'fichier'"),
        ("details", "TEXT"), ("hash_fichier", "TEXT"), ("duree_ms", "INTEGER"),
        ("annule", "INTEGER DEFAULT 0"), ("mapping", "TEXT"), ("feuille", "TEXT"),
        ("mode", "TEXT DEFAULT 'ignorer'"), ("mises_a_jour", "INTEGER DEFAULT 0"),
    ]:
        _add_col(cx, "imports", col, ddl)
    cx.execute("""CREATE TABLE IF NOT EXISTS import_rows(
        id INTEGER PRIMARY KEY AUTOINCREMENT, import_id INTEGER, ligne INTEGER,
        ref TEXT, statut TEXT, motif TEXT)""")
    cx.execute("CREATE INDEX IF NOT EXISTS idx_import_rows ON import_rows(import_id)")

    _add_col(cx, "sales", "import_id", "INTEGER")
    _add_col(cx, "sales", "import_created", "INTEGER DEFAULT 0")
    cx.execute("CREATE INDEX IF NOT EXISTS idx_sales_jour ON sales(jour)")
    cx.execute("CREATE INDEX IF NOT EXISTS idx_sales_region ON sales(region)")
    cx.execute("CREATE INDEX IF NOT EXISTS idx_sales_import ON sales(import_id)")

    _add_col(cx, "audit_logs", "details", "TEXT")
    _add_col(cx, "audit_logs", "version", "INTEGER DEFAULT 1")

    cx.execute("""CREATE TABLE IF NOT EXISTS partners(
        id INTEGER PRIMARY KEY AUTOINCREMENT, entreprise TEXT NOT NULL,
        contact_nom TEXT NOT NULL, email TEXT UNIQUE NOT NULL, telephone TEXT,
        secteur TEXT, taille TEXT, region TEXT, site_web TEXT, logo_path TEXT,
        message TEXT, statut TEXT DEFAULT 'en_attente', demo_date TEXT,
        demo_creneau TEXT, demo_statut TEXT DEFAULT 'demande', token TEXT UNIQUE,
        password_hash TEXT, featured INTEGER DEFAULT 0, notes_admin TEXT,
        cree_le TEXT DEFAULT (datetime('now')), maj_le TEXT DEFAULT (datetime('now')),
        valide_le TEXT, session_version INTEGER DEFAULT 1)""")
    cx.execute("CREATE INDEX IF NOT EXISTS idx_partners_statut ON partners(statut)")

    cx.execute("""CREATE TABLE IF NOT EXISTS form_templates(
        id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL, description TEXT,
        champs TEXT NOT NULL, created_by TEXT, cree_le TEXT DEFAULT (datetime('now')),
        maj_le TEXT DEFAULT (datetime('now')))""")
    cx.execute("""CREATE TABLE IF NOT EXISTS form_submissions(
        id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, login TEXT,
        import_id INTEGER, lignes INTEGER, cree_le TEXT DEFAULT (datetime('now')))""")
    cx.execute("""CREATE TABLE IF NOT EXISTS messages(
        id INTEGER PRIMARY KEY AUTOINCREMENT, horo TEXT DEFAULT (datetime('now')),
        nom TEXT, entreprise TEXT, email TEXT, tel TEXT, profil TEXT, message TEXT)""")

    # Modèle de formulaire par défaut
    if not cx.execute("SELECT id FROM form_templates LIMIT 1").fetchone():
        champs = [
            {"cle": "jour", "label": "Date de la vente", "type": "date", "requis": True},
            {"cle": "canal", "label": "Canal", "type": "select", "requis": True, "options": CANAUX},
            {"cle": "region", "label": "Région", "type": "select", "requis": True, "options": REGIONS},
            {"cle": "ville", "label": "Ville", "type": "text", "requis": False},
            {"cle": "point_vente", "label": "Point de vente", "type": "text", "requis": False},
            {"cle": "vendeur", "label": "Vendeur", "type": "text", "requis": False},
            {"cle": "produit", "label": "Produit", "type": "text", "requis": True},
            {"cle": "famille", "label": "Famille", "type": "select", "requis": True, "options": FAMILLES},
            {"cle": "qte", "label": "Quantité", "type": "number", "requis": True},
            {"cle": "prix_unit", "label": "Prix unitaire (FCFA)", "type": "number", "requis": True},
            {"cle": "remise_pct", "label": "Remise (%)", "type": "number", "requis": False, "defaut": 0},
            {"cle": "devise", "label": "Devise", "type": "select", "requis": False, "options": DEVISES, "defaut": "FCFA"},
        ]
        cx.execute("INSERT INTO form_templates(nom,description,champs,created_by) VALUES(?,?,?,?)",
                   ("Formulaire de saisie terrain",
                    "Saisie guidée d'une ou plusieurs ventes, avec les mêmes contrôles que l'import fichier.",
                    json.dumps(champs, ensure_ascii=False), "system"))

    # Partenaires historiques (logo gris/our wall) : la landing lit la base, pas une liste codée.
    if not cx.execute("SELECT id FROM partners LIMIT 1").fetchone():
        seeds = [
            ("MTN Cameroun", "mtn.cm", "Télécoms", "Littoral", "/img/logos/mtn.png", 1),
            ("Orange Cameroun", "orange.cm", "Télécoms", "Centre", "/img/logos/orange.png", 1),
            ("Guinness Cameroun", "guinness.cm", "Agroalimentaire", "Littoral", "/img/logos/guinness.png", 1),
            ("Ecobank Cameroun", "ecobank.cm", "Banque / Finance", "Littoral", "/img/logos/ecobank.png", 1),
            ("Tradex", "tradex.cm", "Distribution", "Centre", "/img/logos/tradex.png", 0),
            ("Tecno Mobile", "tecno.cm", "Retail / Mode", "Littoral", "/img/logos/tecno.png", 0),
            ("Turkish Airlines", "turkishairlines.cm", "Transport", "Littoral", "/img/logos/turkish.png", 0),
            ("Ethiopian Airlines", "ethiopianairlines.cm", "Transport", "Centre", "/img/logos/ethiopian.png", 0),
            ("Nestlé Cameroun", "nestle.cm", "Agroalimentaire", "Centre", "/img/logos/nestle.png", 0),
        ]
        for nom, site, secteur, region, logo, featured in seeds:
            email = "contact+" + re.sub(r"[^a-z0-9]+", "-", nom.lower()).strip("-") + "@partenaires.mboapilot.cm"
            cx.execute("""INSERT INTO partners(entreprise,contact_nom,email,telephone,secteur,taille,
                region,site_web,logo_path,message,statut,demo_statut,token,featured,valide_le,maj_le)
                VALUES(?,?,?,?,?,?,?,?,?,?,'valide','realise',?,?,datetime('now'),datetime('now'))""",
                       (nom, "Référent MboaPilot", email, "+237 6 00 00 00 00", secteur,
                        "51 à 200", region, "https://" + site, logo,
                        "Partenaire de référence MboaPilot.", secrets.token_urlsafe(24), featured))
    cx.commit()
    cx.close()


# ---------- Audit ----------
def audit(acteur, action, ressource="", resultat="OK", details=""):
    cx = db()
    prev = cx.execute("SELECT empreinte FROM audit_logs ORDER BY id DESC LIMIT 1").fetchone()
    prev = prev["empreinte"] if prev else "GENESIS"
    horo = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    details = (details or "")[:1200]
    raw = f"{prev}|{horo}|{acteur}|{request.remote_addr or '-'}|{action}|{ressource}|{resultat}|{details}"
    emp = hashlib.sha256(raw.encode()).hexdigest()
    cx.execute("""INSERT INTO audit_logs(horo,acteur,ip,action,ressource,resultat,details,empreinte,version)
                  VALUES(?,?,?,?,?,?,?,?,2)""",
               (horo, acteur, request.remote_addr or "-", action, ressource, resultat, details, emp))
    cx.commit()


def verifier_audit():
    cx = db()
    rows = cx.execute("SELECT * FROM audit_logs ORDER BY id").fetchall()
    prev = "GENESIS"
    verifiees = 0
    for r in rows:
        if (r["version"] or 1) >= 2:
            raw = f"{prev}|{r['horo']}|{r['acteur']}|{r['ip']}|{r['action']}|{r['ressource']}|{r['resultat']}|{r['details'] or ''}"
            if hashlib.sha256(raw.encode()).hexdigest() != r["empreinte"]:
                return {"valide": False, "verifiees": verifiees, "premiere_erreur": r["id"]}
            verifiees += 1
        prev = r["empreinte"]
    return {"valide": True, "verifiees": verifiees, "premiere_erreur": None}


# ---------- Permissions et gardes ----------
def perms(role):
    return sorted(ROLE_PERMISSIONS.get(role, set()))


def has_perm(permission):
    return permission in ROLE_PERMISSIONS.get(session.get("role"), set())


def login_required(f):
    @wraps(f)
    def w(*a, **k):
        if "user" not in session:
            return jsonify({"message": "Session expirée. Reconnectez-vous.", "code": "session"}), 401
        return f(*a, **k)
    return w


def perm_required(permission):
    def deco(f):
        @wraps(f)
        def w(*a, **k):
            if "user" not in session:
                return jsonify({"message": "Session expirée. Reconnectez-vous.", "code": "session"}), 401
            if not has_perm(permission):
                audit(session.get("user", "?"), "acces-refuse", permission, "KO")
                return jsonify({"message": "Habilitation insuffisante pour cette action.", "code": "forbidden"}), 403
            return f(*a, **k)
        return w
    return deco


def partner_required(f):
    @wraps(f)
    def w(*a, **k):
        if not session.get("partner_id"):
            return jsonify({"message": "Session partenaire expirée. Reconnectez-vous.", "code": "partner_session"}), 401
        return f(*a, **k)
    return w


def filtre_perimetre():
    role, perim = session.get("role"), session.get("perimetre")
    if role in ("Admin", "Auditeur"):
        return "", []
    if role == "Manager" and perim == "National":
        return "", []
    return " AND region = ?", [perim]


def peut_ecrire_region(region):
    role, perim = session.get("role"), session.get("perimetre")
    if role in ("Admin", "Auditeur"):
        return role == "Admin"
    if perim == "National":
        return True
    return region == perim


def session_user():
    u = {"login": session["user"], "nom": session.get("nom"), "role": session.get("role"),
         "perimetre": session.get("perimetre"), "email": session.get("email"),
         "mfa": bool(session.get("mfa")), "permissions": perms(session.get("role"))}
    return u


# ---------- Rate limiting ----------
def rate_limit(cle, maxi, fenetre):
    now = time.time()
    with _LIMITE_LOCK:
        arr = [t for t in _LIMITES[cle] if now - t < fenetre]
        if len(arr) >= maxi:
            _LIMITES[cle] = arr
            return False
        arr.append(now)
        _LIMITES[cle] = arr
        if len(_LIMITES) > 5000:
            for k in list(_LIMITES)[:1000]:
                _LIMITES.pop(k, None)
    return True


# ---------- Mots de passe ----------
def valider_mot_de_passe(pwd, login=""):
    pwd = pwd or ""
    if len(pwd) < 12:
        return False, "Le mot de passe doit contenir au moins 12 caractères."
    if not (re.search(r"[A-Z]", pwd) and re.search(r"[a-z]", pwd)
            and re.search(r"[0-9]", pwd) and re.search(r"[^A-Za-z0-9]", pwd)):
        return False, "Il faut au moins une majuscule, une minuscule, un chiffre et un symbole."
    if login and login.lower() in pwd.lower():
        return False, "Le mot de passe ne doit pas contenir l'identifiant."
    if pwd.lower() in MOTS_INTERDITS or len(set(pwd)) < 6:
        return False, "Ce mot de passe est trop prévisible. Choisissez une phrase secrète unique."
    if re.search(r"(.)\1{3,}", pwd):
        return False, "Évitez les caractères répétés quatre fois de suite."
    return True, ""


def hash_password(pwd):
    return generate_password_hash(pwd, method="pbkdf2:sha256:600000")


def verifier_mot_de_passe(u, pwd):
    return check_password_hash(u["hash"], pwd)


# ---------- Dates / nombres ----------
def norm_cle(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def parse_date_fr(v):
    if v is None or v == "":
        raise ValueError("date manquante")
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()
    if re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", s):
        d, m, y = [int(x) for x in s.split("/")]
        return date(y, m, d)
    if re.fullmatch(r"\d{1,2}-\d{1,2}-\d{4}", s):
        d, m, y = [int(x) for x in s.split("-")]
        return date(y, m, d)
    if re.fullmatch(r"\d+(\.0+)?", s) and 20000 < float(s) < 80000:
        base = date(1899, 12, 30)
        return base + timedelta(days=int(float(s)))
    return date.fromisoformat(s[:10])


def parse_nombre(v, defaut=None):
    if v is None or v == "":
        return defaut
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("\u202f", "").replace(" ", "").replace("FCFA", "").replace("XAF", "")
    s = s.replace("%", "")
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        raise ValueError(f"nombre invalide : {v}")


def ref_date(cx=None):
    cx = cx or db()
    m = cx.execute("SELECT MAX(jour) m FROM sales").fetchone()
    try:
        return date.fromisoformat(m["m"]) if m and m["m"] else date.today()
    except Exception:
        return date.today()


def periode_fenetre(jours, decalage_annee=0):
    fin = ref_date()
    if decalage_annee:
        try:
            fin = fin.replace(year=fin.year - decalage_annee)
        except ValueError:
            fin = fin.replace(year=fin.year - decalage_annee, day=28)
    debut = fin - timedelta(days=int(jours))
    return debut.isoformat(), fin.isoformat()


def jolie_date(iso):
    try:
        return date.fromisoformat(str(iso)[:10]).strftime("%d/%m/%Y")
    except Exception:
        return str(iso or "")


# ---------- Fichiers / logos ----------
def extension_ok(nom):
    return Path(nom or "").suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")


def verifier_magic_logo(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


def sauver_logo(fs, prefix):
    if not fs or not fs.filename:
        raise ValueError("logo requis")
    data = fs.read(MAX_UPLOAD + 1)
    if len(data) > 2 * 1024 * 1024:
        raise ValueError("logo trop volumineux (2 Mo maximum)")
    ext = verifier_magic_logo(data)
    if not ext:
        raise ValueError("format de logo non reconnu (PNG, JPG ou WebP)")
    nom = f"{prefix}_{secrets.token_hex(8)}{ext}"
    (LOGOS_DIR / nom).write_bytes(data)
    return "/media/logos/" + nom


def supprimer_logo(path):
    if path and str(path).startswith("/media/logos/"):
        try:
            (LOGOS_DIR / str(path).split("/")[-1]).unlink(missing_ok=True)
        except Exception:
            pass


def nettoyer_texte(v, maxi=200):
    return str(v or "").strip()[:maxi]


def email_valide(email):
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}", email or ""))


def csrf_token():
    return session.get("csrf", "")


def nouvelle_csrf():
    if not session.get("csrf"):
        session["csrf"] = secrets.token_urlsafe(32)
    return session["csrf"]


def audit_connexion(login, action, succes, ip=None):
    try:
        cx = db()
        cx.execute("INSERT INTO login_attempts(login,ip,action,succes) VALUES(?,?,?,?)",
                   (login, ip or request.remote_addr or "-", action, 1 if succes else 0))
        cx.commit()
    except Exception:
        pass
