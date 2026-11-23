# -*- coding: utf-8 -*-
"""Portail partenaires : inscription sécurisée, réservation de démo, OTP, logos synchronisés."""
import hashlib
import json
import re
import secrets
import time
from datetime import date, datetime, timedelta

from flask import Blueprint, jsonify, request, session

from .core import (CRENEAUX, DEMO, REGIONS, SECTEURS, TAILLES, audit, db,
                   email_valide, hash_password, login_required, nettoyer_texte,
                   partner_required, perm_required, rate_limit, sauver_logo,
                   supprimer_logo, valider_mot_de_passe, verifier_mot_de_passe)

bp = Blueprint("partners", __name__)


def _mask_email(email):
    a, b = (email or "").split("@", 1) if "@" in (email or "") else ((email or ""), "")
    return (a[:2] + "•••@" + b) if b else "•••"


def _partner_json(p):
    if not p:
        return None
    d = {k: p[k] for k in p.keys() if k not in ("password_hash", "token")}
    d["logo_url"] = p["logo_path"]
    d["email_masque"] = _mask_email(p["email"])
    return d


def _partenaire_courant():
    pid = session.get("partner_id")
    if not pid:
        return None
    return db().execute("SELECT * FROM partners WHERE id=?", (pid,)).fetchone()


def _code_partenaire(p):
    from . import mfa, notifications
    code = f"{secrets.randbelow(900000) + 100000:06d}"
    exp = (datetime.utcnow() + timedelta(minutes=10)).isoformat()
    cle = "partner:" + p["email"]
    cx = db()
    cx.execute("UPDATE mfa_codes SET utilise=1 WHERE login=? AND utilise=0", (cle,))
    cx.execute("INSERT INTO mfa_codes(login,code,expire) VALUES(?,?,?)",
               (cle, mfa.hash_code_secours(code), exp))
    cx.commit()
    notifications.envoyer_email(
        p["email"], "Votre code d'accès partenaire MboaPilot",
        "Bonjour " + (p["contact_nom"] or "") + ",\n\nVotre code d'accès est " + code +
        ". Il expire dans 10 minutes. Si vous n'avez pas demandé ce code, ignorez ce message.",
        "partner-otp",
    )
    audit("partenaire:" + p["email"], "otp-envoi", "email", "OK")
    return code


def _verifier_code_partenaire(p, code):
    from . import mfa
    import hmac
    cle = "partner:" + p["email"]
    r = db().execute("SELECT * FROM mfa_codes WHERE login=? AND utilise=0 ORDER BY id DESC LIMIT 1",
                     (cle,)).fetchone()
    if not r:
        return False
    if (r["tentatives"] or 0) >= 5 or datetime.utcnow() > datetime.fromisoformat(r["expire"]):
        db().execute("UPDATE mfa_codes SET utilise=1 WHERE id=?", (r["id"],))
        db().commit()
        return False
    if not hmac.compare_digest(mfa.hash_code_secours(str(code or "")), r["code"]):
        db().execute("UPDATE mfa_codes SET tentatives=tentatives+1 WHERE id=?", (r["id"],))
        db().commit()
        return False
    db().execute("UPDATE mfa_codes SET utilise=1 WHERE id=?", (r["id"],))
    db().commit()
    return True


# ---------- API publique (landing) ----------
@bp.route("/api/partenaires/publics")
def api_partenaires_publics():
    cx = db()
    rows = cx.execute("""SELECT id,entreprise,secteur,region,site_web,logo_path,featured,maj_le
                         FROM partners WHERE statut='valide' AND logo_path IS NOT NULL
                         ORDER BY featured DESC, entreprise""").fetchall()
    secteurs = {}
    for r in rows:
        secteurs[r["secteur"] or "Autre"] = secteurs.get(r["secteur"] or "Autre", 0) + 1
    maj = max([r["maj_le"] or "" for r in rows], default="")
    return jsonify({
        "partenaires": [{"id": r["id"], "entreprise": r["entreprise"], "secteur": r["secteur"],
                         "region": r["region"], "site_web": r["site_web"],
                         "logo": r["logo_path"], "featured": bool(r["featured"])} for r in rows],
        "total": len(rows), "secteurs": secteurs, "maj": maj,
    })


@bp.route("/api/partenaires/suivi/<token>")
def api_partenaire_suivi(token):
    if not rate_limit("suivi:" + (request.remote_addr or "-"), 60, 60):
        return jsonify({"message": "Trop de requêtes."}), 429
    p = db().execute("SELECT * FROM partners WHERE token=?", (token,)).fetchone()
    if not p:
        return jsonify({"message": "Lien de suivi invalide."}), 404
    return jsonify({"partenaire": {
        "entreprise": p["entreprise"], "contact_nom": p["contact_nom"], "email_masque": _mask_email(p["email"]),
        "secteur": p["secteur"], "statut": p["statut"], "demo_date": p["demo_date"],
        "demo_creneau": p["demo_creneau"], "demo_statut": p["demo_statut"],
        "logo_url": p["logo_path"], "cree_le": p["cree_le"], "valide_le": p["valide_le"],
        "message": ("Votre partenaire est validé : votre logo est visible sur la page d'accueil."
                    if p["statut"] == "valide" else
                    "Votre demande est en cours de revue par l'équipe MboaPilot." if p["statut"] == "en_attente"
                    else "Votre demande n'a pas été retenue. Contactez notre équipe pour en savoir plus."),
    }})


# ---------- Inscription / connexion ----------
@bp.route("/api/partenaires/inscription", methods=["POST"])
def api_partenaire_inscription():
    if not rate_limit("partner-inscr:" + (request.remote_addr or "-"), 6, 3600):
        return jsonify({"message": "Trop de demandes depuis cette adresse. Réessayez plus tard.", "code": "rate"}), 429
    f = request.form
    if (f.get("_hp") or "").strip():
        return jsonify({"message": "Requête refusée."}), 400
    entreprise = nettoyer_texte(f.get("entreprise"), 100)
    contact = nettoyer_texte(f.get("contact_nom"), 80)
    email = nettoyer_texte(f.get("email"), 120).lower()
    telephone = nettoyer_texte(f.get("telephone"), 30)
    secteur = nettoyer_texte(f.get("secteur"), 60)
    taille = nettoyer_texte(f.get("taille"), 30)
    region = nettoyer_texte(f.get("region"), 40)
    site = nettoyer_texte(f.get("site_web"), 200)
    message = nettoyer_texte(f.get("message"), 1200)
    demo_date = nettoyer_texte(f.get("demo_date"), 10)
    creneau = nettoyer_texte(f.get("demo_creneau"), 20)
    pwd, pwd2 = f.get("password") or "", f.get("password2") or ""
    consent = f.get("consent") in ("1", "true", "on", "oui")
    if not entreprise or not contact:
        return jsonify({"message": "Le nom de l'entreprise et du contact sont requis."}), 400
    if not email_valide(email):
        return jsonify({"message": "Adresse email professionnelle invalide."}), 400
    if secteur not in SECTEURS or taille not in TAILLES or region not in REGIONS:
        return jsonify({"message": "Secteur, taille ou région invalide."}), 400
    if not consent:
        return jsonify({"message": "Vous devez accepter la politique de confidentialité."}), 400
    if site and not re.fullmatch(r"https?://[^\s<>\"']+", site):
        return jsonify({"message": "Site web invalide (https://…)."}), 400
    try:
        jd = date.fromisoformat(demo_date)
        if jd < date.today() or jd > date.today() + timedelta(days=120):
            raise ValueError()
    except Exception:
        return jsonify({"message": "Date de démo invalide (entre aujourd'hui et J+120)."}), 400
    if creneau not in CRENEAUX:
        return jsonify({"message": "Créneau de démo invalide."}), 400
    if pwd != pwd2:
        return jsonify({"message": "Les mots de passe ne correspondent pas."}), 400
    ok, msg = valider_mot_de_passe(pwd, email.split("@")[0])
    if not ok:
        return jsonify({"message": msg}), 400
    cx = db()
    if cx.execute("SELECT 1 FROM partners WHERE lower(email)=?", (email,)).fetchone():
        return jsonify({"message": "Une demande existe déjà avec cet email. Connectez-vous à votre espace partenaire."}), 409
    try:
        logo = sauver_logo(request.files.get("logo"), "partner-" + secrets.token_hex(4))
    except ValueError as e:
        return jsonify({"message": str(e)}), 400
    token = secrets.token_urlsafe(32)
    try:
        cur = cx.execute("""INSERT INTO partners(entreprise,contact_nom,email,telephone,secteur,taille,
                            region,site_web,logo_path,message,statut,demo_date,demo_creneau,demo_statut,
                            token,password_hash) VALUES(?,?,?,?,?,?,?,?,?,?,'en_attente',?,?,'demande',?,?)""",
                         (entreprise, contact, email, telephone, secteur, taille, region, site,
                          logo, message, demo_date, creneau, token, hash_password(pwd)))
        cx.commit()
    except Exception:
        supprimer_logo(logo)
        return jsonify({"message": "Email déjà utilisé. Connectez-vous à votre espace."}), 409
    pid = cur.lastrowid
    audit("partenaire:" + email, "inscription-partenaire", str(pid), "OK", f"{entreprise}/{region}")
    session["partner_id"] = pid
    session["partner_email"] = email
    session["partner_nom"] = contact
    session["partner_started"] = time.time()
    session["partner_sv"] = 1
    session["partner_last_seen"] = time.time()
    p = cx.execute("SELECT * FROM partners WHERE id=?", (pid,)).fetchone()
    return jsonify({"ok": True, "message": "Compte partenaire créé. Votre logo sera publié après validation.",
                    "partenaire": _partner_json(p), "suivi_url": "/partenaires/suivi/" + token,
                    "espace_url": "/partenaires/espace"})


@bp.route("/api/partenaires/connexion", methods=["POST"])
def api_partenaire_connexion():
    if not rate_limit("partner-login:" + (request.remote_addr or "-"), 15, 60):
        return jsonify({"message": "Trop de tentatives.", "code": "rate"}), 429
    d = request.get_json(force=True, silent=True) or {}
    email = nettoyer_texte(d.get("email"), 120).lower()
    pwd = d.get("password") or ""
    p = db().execute("SELECT * FROM partners WHERE lower(email)=?", (email,)).fetchone()
    if not p or not p["password_hash"] or not verifier_mot_de_passe(p, pwd):
        audit("partenaire:" + email, "connexion-partenaire", "login", "KO")
        return jsonify({"message": "Email ou mot de passe invalide."}), 401
    code = _code_partenaire(p)
    session["pre_partner"] = p["id"]
    session["pre_partner_started"] = time.time()
    rep = {"mfa_required": True, "email_masque": _mask_email(p["email"]),
           "mode": "email", "message": "Code de vérification envoyé à l'email du compte (10 min)."}
    if DEMO:
        rep["code_demo"] = code
    return jsonify(rep)


@bp.route("/api/partenaires/mfa", methods=["POST"])
def api_partenaire_mfa():
    pid = session.get("pre_partner")
    if not pid:
        return jsonify({"message": "Session de vérification expirée.", "code": "session"}), 401
    if time.time() - float(session.get("pre_partner_started", 0)) > 600:
        session.pop("pre_partner", None)
        return jsonify({"message": "Code expiré. Reconnectez-vous.", "code": "session"}), 401
    if not rate_limit("partner-mfa:" + str(pid), 10, 300):
        return jsonify({"message": "Trop d'essais.", "code": "rate"}), 429
    p = db().execute("SELECT * FROM partners WHERE id=?", (pid,)).fetchone()
    d = request.get_json(force=True, silent=True) or {}
    if not p or not _verifier_code_partenaire(p, re.sub(r"\s", "", str(d.get("code") or ""))):
        return jsonify({"message": "Code incorrect ou expiré."}), 401
    session.pop("pre_partner", None)
    session["partner_id"] = p["id"]
    session["partner_email"] = p["email"]
    session["partner_nom"] = p["contact_nom"]
    session["partner_started"] = time.time()
    session["partner_sv"] = int(p["session_version"] or 1)
    session["partner_last_seen"] = time.time()
    audit("partenaire:" + p["email"], "connexion-partenaire-mfa", "email", "OK")
    return jsonify({"partenaire": _partner_json(p)})


@bp.route("/api/partenaires/deconnexion", methods=["POST"])
def api_partenaire_deconnexion():
    if session.get("partner_id"):
        audit("partenaire:" + str(session.get("partner_email")), "deconnexion-partenaire", "logout", "OK")
    for k in ("partner_id", "partner_email", "partner_nom", "partner_started", "pre_partner"):
        session.pop(k, None)
    return jsonify({"ok": True})


# ---------- Espace partenaire ----------
@bp.route("/api/partenaires/moi")
@partner_required
def api_partenaire_moi():
    p = _partenaire_courant()
    if not p:
        return jsonify({"message": "Compte partenaire introuvable."}), 404
    return jsonify({"partenaire": _partner_json(p)})


@bp.route("/api/partenaires/moi", methods=["POST"])
@partner_required
def api_partenaire_maj():
    p = _partenaire_courant()
    if not p:
        return jsonify({"message": "Compte partenaire introuvable."}), 404
    d = request.get_json(force=True, silent=True) or {}
    entreprise = nettoyer_texte(d.get("entreprise"), 100)
    contact = nettoyer_texte(d.get("contact_nom"), 80)
    telephone = nettoyer_texte(d.get("telephone"), 30)
    secteur = nettoyer_texte(d.get("secteur"), 60)
    taille = nettoyer_texte(d.get("taille"), 30)
    region = nettoyer_texte(d.get("region"), 40)
    site = nettoyer_texte(d.get("site_web"), 200)
    message = nettoyer_texte(d.get("message"), 1200)
    if not entreprise or not contact:
        return jsonify({"message": "Entreprise et contact requis."}), 400
    if secteur not in SECTEURS or taille not in TAILLES or region not in REGIONS:
        return jsonify({"message": "Secteur, taille ou région invalide."}), 400
    if site and not re.fullmatch(r"https?://[^\s<>\"']+", site):
        return jsonify({"message": "Site web invalide."}), 400
    cx = db()
    cx.execute("""UPDATE partners SET entreprise=?,contact_nom=?,telephone=?,secteur=?,taille=?,
                  region=?,site_web=?,message=?,maj_le=datetime('now') WHERE id=?""",
               (entreprise, contact, telephone, secteur, taille, region, site, message, p["id"]))
    cx.commit()
    audit("partenaire:" + p["email"], "maj-profil", str(p["id"]), "OK")
    return jsonify({"ok": True, "partenaire": _partner_json(cx.execute("SELECT * FROM partners WHERE id=?", (p["id"],)).fetchone())})


@bp.route("/api/partenaires/moi/logo", methods=["POST"])
@partner_required
def api_partenaire_logo():
    p = _partenaire_courant()
    if not p:
        return jsonify({"message": "Compte partenaire introuvable."}), 404
    try:
        logo = sauver_logo(request.files.get("logo"), "partner-" + secrets.token_hex(4))
    except ValueError as e:
        return jsonify({"message": str(e)}), 400
    ancien = p["logo_path"]
    db().execute("UPDATE partners SET logo_path=?, maj_le=datetime('now') WHERE id=?", (logo, p["id"]))
    db().commit()
    supprimer_logo(ancien)
    audit("partenaire:" + p["email"], "maj-logo", str(p["id"]), "OK")
    return jsonify({"ok": True, "logo_url": logo, "message": "Logo mis à jour. La page d'accueil se synchronise automatiquement."})


@bp.route("/api/partenaires/moi/suivi")
@partner_required
def api_partenaire_suivi_prive():
    p = _partenaire_courant()
    if not p:
        return jsonify({"message": "Compte partenaire introuvable."}), 404
    return jsonify({"url": "/partenaires/suivi/" + p["token"]})


@bp.route("/api/partenaires/moi/password", methods=["POST"])
@partner_required
def api_partenaire_password():
    p = _partenaire_courant()
    if not p:
        return jsonify({"message": "Compte partenaire introuvable."}), 404
    d = request.get_json(force=True, silent=True) or {}
    actuel = d.get("actuel") or ""
    p1, p2 = d.get("password") or "", d.get("password2") or ""
    if not p["password_hash"] or not verifier_mot_de_passe(p, actuel):
        return jsonify({"message": "Mot de passe actuel incorrect."}), 401
    if p1 != p2:
        return jsonify({"message": "Les deux nouveaux mots de passe ne correspondent pas."}), 400
    ok, msg = valider_mot_de_passe(p1, p["email"].split("@")[0])
    if not ok:
        return jsonify({"message": msg}), 400
    if p1 == actuel:
        return jsonify({"message": "Le nouveau mot de passe doit être différent de l'ancien."}), 400
    db().execute("""UPDATE partners SET password_hash=?, session_version=session_version+1,
                    maj_le=datetime('now') WHERE id=?""", (hash_password(p1), p["id"]))
    db().commit()
    audit("partenaire:" + p["email"], "password-change", "partenaire", "OK")
    return jsonify({"ok": True, "message": "Mot de passe mis à jour. Vos prochaines connexions utiliseront le nouveau."})


@bp.route("/api/partenaires/moi/demo", methods=["POST"])
@partner_required
def api_partenaire_demo():
    p = _partenaire_courant()
    if not p:
        return jsonify({"message": "Compte partenaire introuvable."}), 404
    d = request.get_json(force=True, silent=True) or {}
    demo_date = nettoyer_texte(d.get("demo_date"), 10)
    creneau = nettoyer_texte(d.get("demo_creneau"), 20)
    try:
        jd = date.fromisoformat(demo_date)
        if jd < date.today() or jd > date.today() + timedelta(days=120):
            raise ValueError()
    except Exception:
        return jsonify({"message": "Date de démo invalide."}), 400
    if creneau not in CRENEAUX:
        return jsonify({"message": "Créneau invalide."}), 400
    db().execute("""UPDATE partners SET demo_date=?,demo_creneau=?,demo_statut='demande',
                    maj_le=datetime('now') WHERE id=?""", (demo_date, creneau, p["id"]))
    db().commit()
    from . import notifications
    notifications.notifier_admin(
        "Nouvelle demande de démo partenaire",
        p["entreprise"] + " souhaite une démo le " + demo_date + " de " + creneau + ".",
        "partner-demo-request",
    )
    notifications.envoyer_email(
        p["email"], "MboaPilot : demande de démo enregistrée",
        "Bonjour,\n\nVotre demande de démo pour le " + demo_date + " (" + creneau +
        ") est enregistrée. Notre équipe vous confirmera le créneau.",
        "partner-demo-ack",
    )
    audit("partenaire:" + p["email"], "demo-replanifiee", f"{demo_date} {creneau}", "OK")
    return jsonify({"ok": True, "message": "Créneau demandé. L'équipe confirme sous 24h ouvrées."})


# ---------- Administration partenaires ----------
def _admin_ou_refuse():
    if session.get("role") not in ("Admin",):
        return jsonify({"message": "Habilitation insuffisante."}), 403
    return None


@bp.route("/api/partenaires")
@perm_required("partners.read")
def api_partenaires_admin():
    if session.get("role") != "Admin":
        return jsonify({"message": "Habilitation insuffisante."}), 403
    statut = request.args.get("statut", "")
    cx = db()
    if statut in ("en_attente", "valide", "refuse"):
        rows = cx.execute("SELECT * FROM partners WHERE statut=? ORDER BY cree_le DESC", (statut,)).fetchall()
    else:
        rows = cx.execute("SELECT * FROM partners ORDER BY CASE statut WHEN 'en_attente' THEN 0 ELSE 1 END, cree_le DESC").fetchall()
    stats = {r["statut"]: r["c"] for r in cx.execute("SELECT statut,COUNT(*) c FROM partners GROUP BY statut")}
    return jsonify({"partenaires": [_partner_json(p) for p in rows], "stats": stats,
                    "total": len(rows), "secteurs": SECTEURS, "tailles": TAILLES, "creneaux": CRENEAUX})


@bp.route("/api/partenaires/<int:pid>/statut", methods=["POST"])
@perm_required("partners.manage")
def api_partenaire_statut(pid):
    if session.get("role") != "Admin":
        return jsonify({"message": "Habilitation insuffisante."}), 403
    d = request.get_json(force=True, silent=True) or {}
    statut = d.get("statut")
    if statut not in ("en_attente", "valide", "refuse"):
        return jsonify({"message": "Statut invalide."}), 400
    cx = db()
    p = cx.execute("SELECT * FROM partners WHERE id=?", (pid,)).fetchone()
    if not p:
        return jsonify({"message": "Partenaire introuvable."}), 404
    notes = nettoyer_texte(d.get("notes_admin"), 1000)
    cx.execute("""UPDATE partners SET statut=?,notes_admin=?,maj_le=datetime('now'),
                  valide_le=CASE WHEN ?='valide' THEN datetime('now') ELSE valide_le END WHERE id=?""",
               (statut, notes, statut, pid))
    cx.commit()
    audit(session["user"], "partenaire-statut", f"{p['entreprise']} #{pid}", statut, notes)
    return jsonify({"ok": True, "message": {"valide": "Partenaire validé : logo publié sur l'accueil.",
                                            "refuse": "Partenaire refusé.",
                                            "en_attente": "Partenaire remis en attente."}[statut]})


@bp.route("/api/partenaires/<int:pid>/logo", methods=["POST"])
@perm_required("partners.manage")
def api_partenaire_logo_admin(pid):
    if session.get("role") != "Admin":
        return jsonify({"message": "Habilitation insuffisante."}), 403
    p = db().execute("SELECT * FROM partners WHERE id=?", (pid,)).fetchone()
    if not p:
        return jsonify({"message": "Partenaire introuvable."}), 404
    try:
        logo = sauver_logo(request.files.get("logo"), "partner-" + secrets.token_hex(4))
    except ValueError as e:
        return jsonify({"message": str(e)}), 400
    ancien = p["logo_path"]
    db().execute("UPDATE partners SET logo_path=?,maj_le=datetime('now') WHERE id=?", (logo, pid))
    db().commit()
    supprimer_logo(ancien)
    audit(session["user"], "partenaire-logo", f"{p['entreprise']} #{pid}", "OK")
    return jsonify({"ok": True, "logo_url": logo, "message": "Logo mis à jour et synchronisé."})


@bp.route("/api/partenaires/<int:pid>/featured", methods=["POST"])
@perm_required("partners.manage")
def api_partenaire_featured(pid):
    if session.get("role") != "Admin":
        return jsonify({"message": "Habilitation insuffisante."}), 403
    cx = db()
    p = cx.execute("SELECT * FROM partners WHERE id=?", (pid,)).fetchone()
    if not p:
        return jsonify({"message": "Partenaire introuvable."}), 404
    nouvelle = 0 if p["featured"] else 1
    cx.execute("UPDATE partners SET featured=?,maj_le=datetime('now') WHERE id=?", (nouvelle, pid))
    cx.commit()
    audit(session["user"], "partenaire-featured", f"{p['entreprise']} #{pid}", str(nouvelle))
    return jsonify({"ok": True, "featured": bool(nouvelle),
                    "message": "Mis en avant sur l'accueil." if nouvelle else "Retiré de la mise en avant."})


@bp.route("/api/partenaires/<int:pid>/demo", methods=["POST"])
@perm_required("partners.manage")
def api_partenaire_demo_admin(pid):
    if session.get("role") != "Admin":
        return jsonify({"message": "Habilitation insuffisante."}), 403
    d = request.get_json(force=True, silent=True) or {}
    statut = d.get("demo_statut") or "confirme"
    if statut not in ("demande", "confirme", "realise", "annule"):
        return jsonify({"message": "Statut de démo invalide."}), 400
    cx = db()
    p = cx.execute("SELECT entreprise,email FROM partners WHERE id=?", (pid,)).fetchone()
    if not p:
        return jsonify({"message": "Partenaire introuvable."}), 404
    cx.execute("UPDATE partners SET demo_statut=?,maj_le=datetime('now') WHERE id=?", (statut, pid))
    cx.commit()
    from . import notifications
    notifications.envoyer_email(
        p["email"], "MboaPilot : votre démo a été mise à jour",
        "Bonjour,\n\nLe statut de votre démo est désormais : " + statut + ".",
        "partner-demo",
    )
    audit(session["user"], "partenaire-demo", str(pid), statut)
    return jsonify({"ok": True, "message": "Démo mise à jour."})
