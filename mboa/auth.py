# -*- coding: utf-8 -*-
"""Authentification V2 : TOTP réel, codes de secours, CSRF, sessions, RBAC, utilisateurs."""
import hashlib
import hmac
import io
import json
import re
import secrets
import time
from datetime import datetime, timedelta

import pyotp
from flask import Blueprint, Response, jsonify, request, session

from . import mfa, notifications
from .config import DEMO, MFA_OBLIGATOIRE, STEP_UP_MINUTES
from .core import (REGIONS, ROLES, PERMISSIONS, ROLE_PERMISSIONS, audit,
                   audit_connexion, db, email_valide, hash_password, has_perm,
                   login_required, nouvelle_csrf, perm_required, perms, rate_limit,
                   session_user, valider_mot_de_passe, verifier_mot_de_passe)

bp = Blueprint("auth", __name__)

DEMO_MDP = {
    "admin": "MboaPilot-Admin-2026!",
    "manager": "MboaPilot-Mgr-2026!",
    "commercial": "MboaPilot-Com-2026!",
    "auditeur": "MboaPilot-Audit-2026!",
    "demo": "Mboa-Demo-2026!",
}
DEMO_EMAILS = {
    "admin": "admin@mboapilot.cm", "manager": "manager@mboapilot.cm",
    "commercial": "commercial@mboapilot.cm", "auditeur": "auditeur@mboapilot.cm",
    "demo": "demo@mboapilot.cm",
}


def _mask_email(email):
    email = email or ""
    if "@" not in email:
        return "•••"
    a, b = email.split("@", 1)
    return (a[:2] + "•••@" + b) if len(a) > 2 else ("•@" + b)


def _secret_utilisateur(u):
    return mfa.secret_utilisateur(u)


def _uri_totp(login, secret):
    return mfa.uri_provisioning(login, secret)


def _defi_mfa(u):
    """Prépare la session intermédiaire et renvoie le défi (setup ou TOTP)."""
    login = u["login"]
    secret = mfa.secret_utilisateur(u)
    u = db().execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone()
    mode = "totp" if u["mfa_actif"] else "setup"
    csrf = session.get("csrf")
    session.clear()
    session["pre_mfa"] = login
    session["pre_mfa_started"] = time.time()
    session["mfa_attempts"] = 0
    session["mfa_mode"] = mode
    session["csrf"] = csrf or nouvelle_csrf()
    session.modified = True
    rep = {
        "mfa_required": True,
        "mode": mode,
        "login": login,
        "nom": u["nom"],
        "email_masque": _mask_email(u["email"]),
        "recovery_disponible": mfa.codes_restants(login) > 0,
        "expire_minutes": 10,
        "email_code_disponible": bool(u["email"]),
    }
    if mode == "setup":
        rep.update({"otpauth_url": _uri_totp(login, secret), "secret": secret,
                    "qr_url": "/api/auth/mfa/qr"})
    if DEMO:
        rep["code_demo"] = mfa.code_courant(secret, u["mfa_drift"])
        rep["demo_note"] = "Mode démo : le code TOTP courant est fourni pour la démonstration."
    audit(login, "mfa-defi", mode, "OK")
    return rep


def _ouvrir_session(u):
    csrf = session.get("csrf")
    session.clear()
    session.permanent = True
    session["csrf"] = csrf or nouvelle_csrf()
    session.update({
        "user": u["login"], "nom": u["nom"], "role": u["role"],
        "perimetre": u["perimetre"], "email": u["email"], "uid": u["id"],
        "sv": int(u["session_version"] or 1), "mfa": True,
        "step_up_at": time.time(),
        "started": time.time(), "last_seen": time.time(),
    })
    db().execute("UPDATE users SET derniere_connexion=datetime('now'), echecs=0, bloque_jusqua=NULL WHERE id=?",
                 (u["id"],))
    db().commit()
    audit(u["login"], "connexion-mfa", "totp" if u["mfa_actif"] else "setup", "OK")


def step_up_valide():
    t = session.get("step_up_at", 0)
    return (time.time() - float(t)) <= STEP_UP_MINUTES * 60


def step_up_required(f):
    from functools import wraps
    @wraps(f)
    def w(*a, **k):
        if "user" not in session:
            return jsonify({"message": "Session expirée.", "code": "session"}), 401
        if not step_up_valide():
            return jsonify({"message": "Vérification récente requise. Validez votre code TOTP.",
                            "code": "step_up"}), 403
        return f(*a, **k)
    return w


# ---------- CSRF / session ----------
@bp.route("/api/auth/csrf")
def api_csrf():
    return jsonify({"csrf": nouvelle_csrf()})


@bp.route("/api/auth/me")
def api_me():
    if "user" not in session:
        return jsonify({"message": "Non connecté.", "code": "session"}), 401
    return jsonify(session_user())


@bp.route("/api/auth/demo-secrets")
def api_demo_secrets():
    if not DEMO:
        return jsonify({"message": "Mode démo désactivé.", "code": "forbidden"}), 403
    rows = db().execute(
        "SELECT login, nom, role, perimetre FROM users WHERE login IN ('admin','manager','commercial','auditeur','demo') ORDER BY login"
    ).fetchall()
    return jsonify({"comptes": [{
        "login": r["login"], "nom": r["nom"], "role": r["role"],
        "perimetre": r["perimetre"], "password": DEMO_MDP.get(r["login"])
    } for r in rows]})


# ---------- Connexion ----------
@bp.route("/api/auth/login", methods=["POST"])
def api_login():
    if not rate_limit("login-ip:" + (request.remote_addr or "-"), 20, 60):
        return jsonify({"message": "Trop de tentatives. Réessayez dans une minute.", "code": "rate"}), 429
    d = request.get_json(force=True, silent=True) or {}
    lg = re.sub(r"[^a-zA-Z0-9_.-]", "", (d.get("login") or "").strip())[:40]
    pwd = d.get("password") or ""
    if not lg or not pwd:
        return jsonify({"message": "Identifiant et mot de passe requis."}), 400
    if not rate_limit("login-compte:" + lg, 8, 60):
        return jsonify({"message": "Trop de tentatives sur ce compte. Patience une minute.", "code": "rate"}), 429
    if session.get("user"):
        csrf = session.get("csrf")
        session.clear()
        if csrf:
            session["csrf"] = csrf
    cx = db()
    u = cx.execute("SELECT * FROM users WHERE login=? AND actif=1", (lg,)).fetchone()
    now = datetime.utcnow()
    if not u:
        audit(lg or "?", "connexion", "login", "KO-inconnu")
        audit_connexion(lg, "connexion", False)
        return jsonify({"message": "Identifiants invalides."}), 401
    if u["bloque_def"]:
        audit(lg, "connexion", "login", "KO-bloque-def")
        return jsonify({"message": "Compte bloqué définitivement. Contactez un administrateur.", "code": "locked"}), 403
    bj = u["bloque_jusqua"]
    if bj and now < datetime.fromisoformat(bj):
        audit(lg, "connexion", "login", "KO-verrouille")
        return jsonify({"message": f"Compte verrouillé jusqu'à {bj} UTC.", "code": "locked"}), 403
    if not verifier_mot_de_passe(u, pwd):
        ech = (u["echecs"] or 0) + 1
        if ech >= 10:
            cx.execute("UPDATE users SET echecs=?, bloque_def=1, session_version=session_version+1 WHERE id=?",
                       (ech, u["id"]))
            msg, code = "10 échecs : compte bloqué définitivement. Contactez un administrateur.", "locked"
        elif ech >= 5:
            jusqua = (now + timedelta(minutes=15)).isoformat()
            cx.execute("UPDATE users SET echecs=?, bloque_jusqua=? WHERE id=?", (ech, jusqua, u["id"]))
            msg, code = "5 échecs : compte verrouillé 15 minutes.", "locked"
        else:
            cx.execute("UPDATE users SET echecs=? WHERE id=?", (ech, u["id"]))
            msg, code = f"Identifiants invalides ({ech}/5 avant verrouillage).", "auth"
        cx.commit()
        audit(lg, "connexion", "login", "KO-echec")
        audit_connexion(lg, "connexion", False)
        return jsonify({"message": msg, "code": code}), 401
    audit_connexion(lg, "connexion", True)
    return jsonify(_defi_mfa(u))


@bp.route("/api/auth/logout", methods=["POST"])
def api_logout():
    if "user" in session:
        audit(session.get("user", "?"), "deconnexion", "logout", "OK")
    session.clear()
    return jsonify({"ok": True})


# ---------- Vérification MFA ----------
@bp.route("/api/auth/mfa-confirmer", methods=["POST"])
def api_mfa_confirmer():
    lg = session.get("pre_mfa")
    if not lg:
        return jsonify({"message": "Session de vérification expirée. Reconnectez-vous.", "code": "session"}), 401
    if time.time() - float(session.get("pre_mfa_started", 0)) > 600:
        session.pop("pre_mfa", None)
        return jsonify({"message": "Défi MFA expiré (10 min). Reconnectez-vous.", "code": "session"}), 401
    if not rate_limit("mfa:" + lg, 12, 300):
        return jsonify({"message": "Trop d'essais MFA. Réessayez dans 5 minutes.", "code": "rate"}), 429
    d = request.get_json(force=True, silent=True) or {}
    code = re.sub(r"\s", "", str(d.get("code") or ""))
    secours = str(d.get("recovery_code") or "").strip()
    u = db().execute("SELECT * FROM users WHERE login=? AND actif=1", (lg,)).fetchone()
    if not u:
        return jsonify({"message": "Compte introuvable.", "code": "auth"}), 401
    ok = False
    moyen = "totp"
    if secours:
        moyen = "secours"
        ok = mfa.consommer_code_secours(lg, secours)
        if not ok:
            audit(lg, "mfa-secours", "login", "KO")
    elif re.fullmatch(r"\d{6}", code):
        accepte, raison = mfa.verifier_totp(u, code)
        if accepte:
            ok = True
        elif raison == "replay":
            audit(lg, "mfa-replay", "login", "KO")
        else:
            moyen = "email"
            ok = mfa.verifier_code_email(lg, code)
    if not ok:
        essais = int(session.get("mfa_attempts", 0)) + 1
        session["mfa_attempts"] = essais
        audit(lg, "mfa-verif", "login", "KO")
        if essais >= 5:
            session.pop("pre_mfa", None)
            return jsonify({"message": "5 essais MFA échoués. Reconnectez-vous.", "code": "session"}), 401
        return jsonify({"message": f"Code incorrect ({essais}/5).", "code": "mfa"}), 401

    recup = None
    if not u["mfa_actif"]:
        recup = mfa.generer_codes_secours(lg)
        db().execute("UPDATE users SET mfa_actif=1, mfa_confirme=1 WHERE id=?", (u["id"],))
        db().commit()
        u = db().execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone()
        audit(lg, "mfa-active", "totp", "OK")
        notifications.envoyer_email(
            u["email"], "MboaPilot : authentification activée",
            "Bonjour " + u["nom"] + ",\n\nVotre authentification à deux facteurs est active. "
            "Si vous n'êtes pas à l'origine de cette action, contactez immédiatement l'administrateur.",
            "mfa-activation",
        )
    audit(lg, "mfa-verif", moyen, "OK")
    _ouvrir_session(u)
    rep = {"user": session_user()}
    if recup:
        rep["recovery_codes"] = recup
        rep["message"] = "MFA activé. Conservez ces codes de secours hors ligne : ils ne seront plus affichés."
    return jsonify(rep)


@bp.route("/api/auth/mfa-demande", methods=["POST"])
def api_mfa_demande():
    lg = session.get("pre_mfa")
    if not lg:
        return jsonify({"message": "Session expirée. Reconnectez-vous.", "code": "session"}), 401
    if not rate_limit("mfa-envoi:" + lg, 5, 600):
        return jsonify({"message": "Trop de demandes de code. Réessayez dans 10 minutes.", "code": "rate"}), 429
    code = mfa.generer_code_email(lg)
    u = db().execute("SELECT email FROM users WHERE login=?", (lg,)).fetchone()
    if u and u["email"]:
        notifications.envoyer_email(
            u["email"], "Votre code de vérification MboaPilot",
            "Votre code de vérification est " + code + ". Il expire dans 10 minutes. "
            "Si vous n'avez pas demandé ce code, ignorez ce message.",
            "mfa-code-email",
        )
    audit(lg, "mfa-reenvoi", "email", "OK")
    rep = {"ok": True, "message": "Un code de vérification a été envoyé à l'email du compte."}
    if DEMO:
        rep["code_demo"] = code
    return jsonify(rep)


@bp.route("/api/auth/mfa/etat")
def api_mfa_etat():
    """État du défi MFA en cours (permet de rafraîchir la page de vérification)."""
    lg = session.get("pre_mfa")
    if not lg:
        return jsonify({"message": "Aucun défi en cours. Reconnectez-vous.", "code": "session"}), 401
    u = db().execute("SELECT * FROM users WHERE login=? AND actif=1", (lg,)).fetchone()
    if not u:
        return jsonify({"message": "Compte introuvable.", "code": "auth"}), 401
    secret = mfa.secret_utilisateur(u)
    u = db().execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone()
    mode = "totp" if u["mfa_actif"] else "setup"
    rep = {
        "mfa_required": True, "mode": mode, "login": lg, "nom": u["nom"],
        "email_masque": _mask_email(u["email"]),
        "recovery_disponible": mfa.codes_restants(lg) > 0,
        "email_code_disponible": bool(u["email"]),
        "expire_minutes": max(0, 10 - int((time.time() - float(session.get("pre_mfa_started", time.time()))) // 60)),
    }
    if mode == "setup":
        rep.update({"otpauth_url": _uri_totp(lg, secret), "secret": secret,
                    "qr_url": "/api/auth/mfa/qr"})
    if DEMO:
        rep["code_demo"] = mfa.code_courant(secret, u["mfa_drift"])
    return jsonify(rep)


@bp.route("/api/auth/mfa/qr")
def api_mfa_qr():
    if "user" in session and session.get("mfa_pending_secret"):
        secret = session["mfa_pending_secret"]
        login = session["user"]
    else:
        login = session.get("pre_mfa")
        if not login:
            return jsonify({"message": "Aucun enrôlement en cours.", "code": "session"}), 401
        u = db().execute("SELECT mfa_secret FROM users WHERE login=?", (login,)).fetchone()
        if not u:
            return jsonify({"message": "Compte introuvable."}), 404
        secret = mfa.dechiffrer(u["mfa_secret"]) or mfa.secret_utilisateur(u)
    uri = _uri_totp(login, secret)
    try:
        import qrcode
        img = qrcode.make(uri, box_size=6, border=2)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return Response(buf.read(), mimetype="image/png",
                        headers={"Cache-Control": "no-store", "Content-Disposition": "inline; filename=mboa-qr.png"})
    except Exception:
        return jsonify({"message": "Génération QR indisponible. Utilisez la clé manuelle.",
                        "otpauth_url": uri, "secret": secret}), 501


# ---------- Inscription ----------
@bp.route("/api/auth/inscription", methods=["POST"])
def api_inscription():
    if not rate_limit("inscription:" + (request.remote_addr or "-"), 8, 3600):
        return jsonify({"message": "Trop de créations de compte depuis cette adresse.", "code": "rate"}), 429
    d = request.get_json(force=True, silent=True) or {}
    login = re.sub(r"[^a-z0-9_.-]", "", (d.get("login") or "").strip().lower())[:40]
    nom = (d.get("nom") or "").strip()[:80]
    email = (d.get("email") or "").strip().lower()[:120]
    perimetre = (d.get("perimetre") or "").strip()
    telephone = (d.get("telephone") or "").strip()[:30]
    pwd, pwd2 = d.get("password") or "", d.get("password2") or ""
    if len(login) < 3 or not nom or perimetre not in REGIONS:
        return jsonify({"message": "Identifiant (≥ 3 car.), nom et région camerounaise requis."}), 400
    if not email_valide(email):
        return jsonify({"message": "Une adresse email valide est requise pour la MFA et les alertes."}), 400
    if pwd != pwd2:
        return jsonify({"message": "Les deux mots de passe ne correspondent pas."}), 400
    ok, msg = valider_mot_de_passe(pwd, login)
    if not ok:
        return jsonify({"message": msg}), 400
    cx = db()
    if cx.execute("SELECT 1 FROM users WHERE email=? AND email<>''", (email,)).fetchone():
        return jsonify({"message": "Cette adresse email est déjà utilisée."}), 400
    try:
        secret = pyotp.random_base32()
        cx.execute("""INSERT INTO users(login,nom,role,perimetre,hash,email,telephone,mfa_secret,
                      mfa_actif,mfa_confirme,cree_le) VALUES(?,?,?,?,?,?,?,?,0,0,datetime('now'))""",
                   (login, nom, "Commercial", perimetre, hash_password(pwd), email, telephone, secret))
        cx.commit()
    except Exception:
        return jsonify({"message": "Identifiant ou email déjà utilisé. Choisissez-en un autre."}), 400
    audit(login, "inscription", f"commercial/{perimetre}", "OK", email)
    return jsonify({"ok": True, "login": login,
                    "message": "Compte créé. À la première connexion, activez votre authenticator TOTP."})


# ---------- Réinitialisation ----------
@bp.route("/api/auth/reset-request", methods=["POST"])
def api_reset_request():
    if not rate_limit("reset:" + (request.remote_addr or "-"), 8, 3600):
        return jsonify({"message": "Trop de demandes. Réessayez plus tard.", "code": "rate"}), 429
    d = request.get_json(force=True, silent=True) or {}
    lg = (d.get("login") or "").strip()
    u = db().execute("SELECT login FROM users WHERE login=? AND actif=1", (lg,)).fetchone()
    message = "Si ce compte existe, un lien de réinitialisation valable 30 minutes a été généré."
    lien = None
    if u:
        tok = secrets.token_urlsafe(32)
        exp = (datetime.utcnow() + timedelta(minutes=30)).isoformat()
        db().execute("INSERT INTO reset_tokens(login,token,expire,cree_le) VALUES(?,?,?,datetime('now'))",
                     (lg, hashlib.sha256(tok.encode()).hexdigest(), exp))
        db().commit()
        audit(lg, "reset-demande", "password", "OK")
        lu = db().execute("SELECT email FROM users WHERE login=?", (lg,)).fetchone()
        if lu and lu["email"]:
            url = "/reset/" + tok
            notifications.envoyer_email(
                lu["email"], "Réinitialisation de votre mot de passe MboaPilot",
                "Bonjour,\n\nUtilisez ce lien pour choisir un nouveau mot de passe : " + url +
                "\n\nCe lien expire dans 30 minutes et ne peut être utilisé qu'une fois. "
                "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
                "reset-password",
            )
        if DEMO:
            lien = f"/reset/{tok}"
    return jsonify({"ok": True, "message": message, "lien": lien})


@bp.route("/api/auth/reset-use", methods=["POST"])
def api_reset_use():
    d = request.get_json(force=True, silent=True) or {}
    tok = d.get("token") or ""
    p1, p2 = d.get("p1") or "", d.get("p2") or ""
    h = hashlib.sha256(tok.encode()).hexdigest()
    cx = db()
    r = cx.execute("SELECT * FROM reset_tokens WHERE token=? AND utilise=0", (h,)).fetchone()
    if not r or datetime.utcnow() > datetime.fromisoformat(r["expire"]):
        return jsonify({"message": "Lien expiré ou déjà utilisé (30 min, usage unique)."}), 400
    if p1 != p2:
        return jsonify({"message": "Les deux mots de passe ne correspondent pas."}), 400
    ok, msg = valider_mot_de_passe(p1, r["login"])
    if not ok:
        return jsonify({"message": msg}), 400
    cx.execute("""UPDATE users SET hash=?, echecs=0, bloque_jusqua=NULL, bloque_def=0,
                  session_version=session_version+1, mot_de_passe_maj=datetime('now') WHERE login=?""",
               (hash_password(p1), r["login"]))
    cx.execute("UPDATE reset_tokens SET utilise=1 WHERE id=?", (r["id"],))
    cx.commit()
    audit(r["login"], "reset-effectif", "password", "OK")
    return jsonify({"ok": True, "message": "Mot de passe réinitialisé. Toutes les sessions ont été invalidées."})


# ---------- Compte / sécurité ----------
@bp.route("/api/auth/security")
@login_required
def api_security():
    u = db().execute("SELECT * FROM users WHERE login=?", (session["user"],)).fetchone()
    return jsonify({
        "login": u["login"], "nom": u["nom"], "email": _mask_email(u["email"]),
        "email_complet": u["email"], "telephone": u["telephone"], "role": u["role"],
        "perimetre": u["perimetre"], "mfa_actif": bool(u["mfa_actif"]),
        "codes_secours_restants": mfa.codes_restants(u["login"]),
        "derniere_connexion": u["derniere_connexion"], "cree_le": u["cree_le"],
        "mot_de_passe_maj": u["mot_de_passe_maj"],
    })


@bp.route("/api/auth/password", methods=["POST"])
@login_required
def api_password():
    d = request.get_json(force=True, silent=True) or {}
    actuel, p1, p2 = d.get("actuel") or "", d.get("nouveau") or "", d.get("confirmation") or ""
    u = db().execute("SELECT * FROM users WHERE login=?", (session["user"],)).fetchone()
    if not verifier_mot_de_passe(u, actuel):
        audit(session["user"], "password-change", "compte", "KO")
        return jsonify({"message": "Mot de passe actuel incorrect."}), 401
    if p1 != p2:
        return jsonify({"message": "Les deux nouveaux mots de passe ne correspondent pas."}), 400
    ok, msg = valider_mot_de_passe(p1, u["login"])
    if not ok:
        return jsonify({"message": msg}), 400
    if p1 == actuel:
        return jsonify({"message": "Le nouveau mot de passe doit être différent de l'ancien."}), 400
    cx = db()
    cx.execute("""UPDATE users SET hash=?, mot_de_passe_maj=datetime('now'),
                  session_version=session_version+1 WHERE id=?""",
               (hash_password(p1), u["id"]))
    cx.commit()
    session["sv"] = int(u["session_version"] or 1) + 1
    audit(session["user"], "password-change", "compte", "OK")
    return jsonify({"ok": True, "message": "Mot de passe mis à jour. Les autres sessions sont invalidées."})


@bp.route("/api/auth/mfa/activer", methods=["POST"])
@step_up_required
def api_mfa_activer():
    d = request.get_json(force=True, silent=True) or {}
    u = db().execute("SELECT * FROM users WHERE login=?", (session["user"],)).fetchone()
    if not verifier_mot_de_passe(u, d.get("password") or ""):
        return jsonify({"message": "Mot de passe incorrect."}), 401
    if u["mfa_actif"]:
        ok, _ = mfa.verifier_totp(u, d.get("code") or "")
        if not ok:
            return jsonify({"message": "Code TOTP actuel requis pour remplacer l'authenticator."}), 401
    secret = mfa.nouvelle_graine()
    session["mfa_pending_secret"] = secret
    return jsonify({"ok": True, "secret": secret, "otpauth_url": _uri_totp(u["login"], secret),
                    "qr_url": "/api/auth/mfa/qr"})


@bp.route("/api/auth/mfa/confirmer-activation", methods=["POST"])
@step_up_required
def api_mfa_confirmer_activation():
    d = request.get_json(force=True, silent=True) or {}
    secret = session.get("mfa_pending_secret")
    if not secret:
        return jsonify({"message": "Aucun enrôlement en cours."}), 400
    code = re.sub(r"\s", "", str(d.get("code") or ""))
    maintenant = int(time.time() // 30)
    totp = pyotp.TOTP(secret, interval=30)
    if not any(hmac.compare_digest(totp.at((maintenant - dec) * 30), code) for dec in (0, 1)):
        return jsonify({"message": "Code incorrect. Vérifiez l'heure de votre téléphone."}), 401
    db().execute("""UPDATE users SET mfa_secret=?, mfa_actif=1, mfa_confirme=1,
                    mfa_last_step=-1, mfa_drift=0 WHERE login=?""",
                 (mfa.chiffrer(secret), session["user"]))
    db().commit()
    session.pop("mfa_pending_secret", None)
    codes = mfa.generer_codes_secours(session["user"])
    u = db().execute("SELECT email,nom FROM users WHERE login=?", (session["user"],)).fetchone()
    if u and u["email"]:
        notifications.envoyer_email(
            u["email"], "Authenticator MboaPilot remplacé",
            "Bonjour " + u["nom"] + ",\n\nVotre authenticator a été remplacé. "
            "Si vous n'êtes pas à l'origine de cette action, contactez immédiatement l'administrateur.",
            "mfa-rotate",
        )
    audit(session["user"], "mfa-rotate", "totp", "OK")
    return jsonify({"ok": True, "recovery_codes": codes,
                    "message": "Authenticator activé. Conservez ces codes de secours hors ligne."})


@bp.route("/api/auth/mfa/desactiver", methods=["POST"])
@step_up_required
def api_mfa_desactiver():
    if MFA_OBLIGATOIRE and mfa.mfa_requise(session.get("role")):
        return jsonify({"message": "La MFA est obligatoire pour ce rôle.", "code": "policy"}), 403
    d = request.get_json(force=True, silent=True) or {}
    u = db().execute("SELECT * FROM users WHERE login=?", (session["user"],)).fetchone()
    if not verifier_mot_de_passe(u, d.get("password") or ""):
        return jsonify({"message": "Mot de passe incorrect."}), 401
    if u["mfa_actif"]:
        ok, _ = mfa.verifier_totp(u, d.get("code") or "")
        if not ok:
            return jsonify({"message": "Code TOTP incorrect."}), 401
    db().execute("UPDATE users SET mfa_actif=0, mfa_confirme=0 WHERE login=?", (u["login"],))
    db().execute("DELETE FROM recovery_codes WHERE login=?", (u["login"],))
    db().commit()
    if u["email"]:
        notifications.envoyer_email(
            u["email"], "Authentification à deux facteurs désactivée",
            "Bonjour " + u["nom"] + ",\n\nLa MFA de votre compte a été désactivée. "
            "Si vous n'êtes pas à l'origine de cette action, contactez immédiatement l'administrateur.",
            "mfa-desactive",
        )
    audit(u["login"], "mfa-desactive", "totp", "OK")
    return jsonify({"ok": True, "message": "MFA désactivée. Elle sera reproposée à la prochaine connexion."})


@bp.route("/api/auth/mfa/codes-secours", methods=["POST"])
@step_up_required
def api_codes_secours():
    d = request.get_json(force=True, silent=True) or {}
    u = db().execute("SELECT * FROM users WHERE login=?", (session["user"],)).fetchone()
    if not verifier_mot_de_passe(u, d.get("password") or ""):
        return jsonify({"message": "Mot de passe incorrect."}), 401
    if u["mfa_actif"]:
        ok, _ = mfa.verifier_totp(u, d.get("code") or "")
        if not ok:
            return jsonify({"message": "Code TOTP incorrect."}), 401
    codes = mfa.generer_codes_secours(u["login"])
    if u["email"]:
        notifications.envoyer_email(
            u["email"], "Nouveaux codes de secours MboaPilot",
            "Bonjour " + u["nom"] + ",\n\nDix nouveaux codes de secours ont été générés. "
            "Les anciens ne fonctionnent plus. Si vous n'êtes pas à l'origine de cette action, "
            "contactez immédiatement l'administrateur.",
            "mfa-codes",
        )
    audit(u["login"], "mfa-codes-secours", "totp", "OK")
    return jsonify({"recovery_codes": codes})


# ---------- Utilisateurs (Admin) ----------
@bp.route("/api/users")
@perm_required("users.manage")
def api_users_list():
    rows = db().execute("""SELECT id,login,nom,email,telephone,role,perimetre,actif,echecs,
                          bloque_def,bloque_jusqua,mfa_actif,derniere_connexion,cree_le
                          FROM users ORDER BY role, login""").fetchall()
    return jsonify({"users": [dict(r) for r in rows]})


@bp.route("/api/users/matrice")
@perm_required("users.manage")
def api_users_matrice():
    return jsonify({
        "permissions": PERMISSIONS,
        "roles": {r: sorted(p) for r, p in ROLE_PERMISSIONS.items()},
        "regions": REGIONS,
    })


@bp.route("/api/users", methods=["POST"])
@perm_required("users.manage")
def api_users_post():
    d = request.get_json(force=True, silent=True) or {}
    action = d.get("action")
    login = re.sub(r"[^a-z0-9_.-]", "", (d.get("login") or "").strip().lower())[:40]
    cx = db()
    moi = session["user"]

    if action == "creer":
        nom = (d.get("nom") or "").strip()[:80]
        email = (d.get("email") or "").strip().lower()[:120]
        role = d.get("role") or "Commercial"
        perim = d.get("perimetre") or "National"
        pwd = d.get("pwd") or ""
        if not login or len(login) < 3 or not nom:
            return jsonify({"message": "Login (≥ 3 car.) et nom requis."}), 400
        if role not in ROLES or perim not in REGIONS + ["National"]:
            return jsonify({"message": "Rôle ou périmètre invalide."}), 400
        if role in ("Manager", "Commercial") and perim == "National" and role == "Commercial":
            return jsonify({"message": "Un commercial doit être rattaché à une région."}), 400
        if not email_valide(email):
            return jsonify({"message": "Email professionnel valide requis."}), 400
        ok, msg = valider_mot_de_passe(pwd, login)
        if not ok:
            return jsonify({"message": msg}), 400
        try:
            cx.execute("""INSERT INTO users(login,nom,role,perimetre,hash,email,mfa_secret,
                          mfa_actif,mfa_confirme,cree_le) VALUES(?,?,?,?,?,?,?,0,0,datetime('now'))""",
                       (login, nom, role, perim, hash_password(pwd), email,
                        mfa.chiffrer(mfa.nouvelle_graine())))
            cx.commit()
        except Exception:
            return jsonify({"message": "Login ou email déjà existant."}), 400
        audit(moi, "user-creer", login, "OK", f"{role}/{perim}")
        return jsonify({"message": "Compte créé. L'utilisateur activera sa MFA à la première connexion."})

    u = cx.execute("SELECT * FROM users WHERE login=?", (login,)).fetchone()
    if not u:
        return jsonify({"message": "Utilisateur introuvable."}), 404

    if action == "modifier":
        role = d.get("role") or u["role"]
        perim = d.get("perimetre") or u["perimetre"]
        nom = (d.get("nom") or u["nom"]).strip()[:80]
        email = (d.get("email") or u["email"] or "").strip().lower()[:120]
        if role not in ROLES or perim not in REGIONS + ["National"]:
            return jsonify({"message": "Rôle ou périmètre invalide."}), 400
        if not email_valide(email):
            return jsonify({"message": "Email valide requis."}), 400
        if u["role"] == "Admin" and role != "Admin":
            n = cx.execute("SELECT COUNT(*) c FROM users WHERE role='Admin' AND actif=1").fetchone()["c"]
            if n <= 1:
                return jsonify({"message": "Impossible de retirer le dernier administrateur actif."}), 400
        cx.execute("""UPDATE users SET nom=?, email=?, role=?, perimetre=?,
                      session_version=session_version+1 WHERE id=?""",
                   (nom, email, role, perim, u["id"]))
        cx.commit()
        audit(moi, "user-modifier", login, "OK", f"{role}/{perim}")
        return jsonify({"message": "Compte mis à jour. Ses sessions ont été réinitialisées."})

    if action in ("desactiver", "activer"):
        if login == moi and action == "desactiver":
            return jsonify({"message": "Vous ne pouvez pas désactiver votre propre compte."}), 400
        actif = 0 if action == "desactiver" else 1
        cx.execute("UPDATE users SET actif=?, session_version=session_version+1 WHERE id=?",
                   (actif, u["id"]))
        cx.commit()
        audit(moi, "user-" + action, login, "OK")
        return jsonify({"message": "Compte désactivé." if actif == 0 else "Compte réactivé."})

    if action == "debloquer":
        cx.execute("""UPDATE users SET echecs=0, bloque_jusqua=NULL, bloque_def=0, actif=1
                      WHERE id=?""", (u["id"],))
        cx.commit()
        audit(moi, "user-debloquer", login, "OK")
        return jsonify({"message": "Compte débloqué."})

    if action == "reset-mdp":
        pwd = d.get("pwd") or ""
        ok, msg = valider_mot_de_passe(pwd, login)
        if not ok:
            return jsonify({"message": msg}), 400
        cx.execute("""UPDATE users SET hash=?, echecs=0, bloque_jusqua=NULL, bloque_def=0,
                      session_version=session_version+1, mot_de_passe_maj=datetime('now') WHERE id=?""",
                   (hash_password(pwd), u["id"]))
        cx.commit()
        audit(moi, "user-reset-mdp", login, "OK")
        return jsonify({"message": "Mot de passe réinitialisé. Toutes ses sessions sont invalidées."})

    if action == "reset-mfa":
        if login == moi:
            return jsonify({"message": "Utilisez votre page Mon compte pour changer votre MFA."}), 400
        cx.execute("""UPDATE users SET mfa_secret=?, mfa_actif=0, mfa_confirme=0,
                      mfa_last_step=-1, mfa_drift=0,
                      session_version=session_version+1 WHERE id=?""",
                   (mfa.chiffrer(mfa.nouvelle_graine()), u["id"]))
        cx.execute("DELETE FROM recovery_codes WHERE login=?", (login,))
        cx.commit()
        audit(moi, "user-reset-mfa", login, "OK")
        return jsonify({"message": "MFA réinitialisée. Un nouvel enrôlement sera requis à la connexion."})

    return jsonify({"message": "Action inconnue."}), 400


# ---------- Amorçage des comptes de démonstration ----------
def seed_demo_users():
    import sqlite3
    from pathlib import Path
    from .core import DB
    cx = sqlite3.connect(DB)
    cx.row_factory = sqlite3.Row
    defs = [
        ("admin", "Administrateur", "Admin", "National", DEMO_MDP["admin"]),
        ("manager", "Manager Centre", "Manager", "Centre", DEMO_MDP["manager"]),
        ("commercial", "Commercial Littoral", "Commercial", "Littoral", DEMO_MDP["commercial"]),
        ("auditeur", "Auditeur Interne", "Auditeur", "National", DEMO_MDP["auditeur"]),
        ("demo", "Démo Jury", "Manager", "National", DEMO_MDP["demo"]),
    ]
    for login, nom, role, perim, pwd in defs:
        row = cx.execute("SELECT * FROM users WHERE login=?", (login,)).fetchone()
        if row is None:
            cx.execute("""INSERT INTO users(login,nom,role,perimetre,hash,email,mfa_secret,
                          mfa_actif,mfa_confirme,cree_le) VALUES(?,?,?,?,?,?,?,1,1,datetime('now'))""",
                       (login, nom, role, perim, hash_password(pwd), DEMO_EMAILS[login],
                        mfa.chiffrer(mfa.nouvelle_graine())))
        else:
            if not row["mfa_secret"]:
                cx.execute("UPDATE users SET mfa_secret=?, mfa_actif=1, mfa_confirme=1 WHERE id=?",
                           (mfa.chiffrer(mfa.nouvelle_graine()), row["id"]))
            if row["email"] is None:
                cx.execute("UPDATE users SET email=? WHERE id=?", (DEMO_EMAILS.get(login), row["id"]))
    cx.commit()
    cx.close()


if DEMO:
    seed_demo_users()

