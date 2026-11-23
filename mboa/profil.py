# -*- coding: utf-8 -*-
"""Profil utilisateur : informations personnelles, avatar, préférences, sécurité."""
import hashlib
import io
import secrets
import sqlite3
import time
from pathlib import Path

from flask import Blueprint, jsonify, request, session

from . import notifications
from .config import BASE
from .core import (LOGOS_DIR, audit, db, email_valide, nettoyer_texte,
                   login_required, session_user, verifier_mot_de_passe)

bp = Blueprint("profil", __name__)
AVATARS = BASE / "uploads" / "avatars"
AVATARS.mkdir(parents=True, exist_ok=True)


def _cx():
    c = sqlite3.connect(BASE / "sales.db", timeout=30)
    c.row_factory = sqlite3.Row
    return c


@bp.route("/api/profil")
@login_required
def lire_profil():
    u = db().execute("SELECT * FROM users WHERE login=?", (session["user"],)).fetchone()
    champs = ("login", "nom", "prenom", "email", "telephone", "poste", "organisation",
              "bio", "avatar_url", "langue", "fuseau", "notif_email", "notif_push",
              "email_verifie", "role", "perimetre", "cree_le", "derniere_connexion",
              "mot_de_passe_maj")
    d = {c: u[c] for c in champs}
    d["initiales"] = "".join(x[0].upper() for x in (u["prenom"] or u["nom"] or u["login"]).split()[:2])
    d["permissions"] = session_user().get("permissions", [])
    return jsonify(d)


@bp.route("/api/profil", methods=["POST"])
@login_required
def enregistrer_profil():
    d = request.get_json(force=True, silent=True) or {}
    u = db().execute("SELECT * FROM users WHERE login=?", (session["user"],)).fetchone()
    nom = nettoyer_texte(d.get("nom"), 80) or u["nom"]
    prenom = nettoyer_texte(d.get("prenom"), 80)
    email = nettoyer_texte(d.get("email"), 120).lower() or u["email"]
    if not email_valide(email):
        return jsonify({"message": "Adresse email invalide."}), 400
    autre = db().execute("SELECT id FROM users WHERE email=? AND id<>?", (email, u["id"])).fetchone()
    if autre:
        return jsonify({"message": "Cette adresse est déjà utilisée."}), 409
    telephone = nettoyer_texte(d.get("telephone"), 40)
    if telephone and not __import__("re").fullmatch(r"[+0-9 ().\-]{8,30}", telephone):
        return jsonify({"message": "Numéro de téléphone invalide."}), 400
    langues = ("fr", "en")
    langue = d.get("langue", u["langue"] or "fr")
    if langue not in langues:
        langue = "fr"
    db().execute("""UPDATE users SET nom=?,prenom=?,email=?,telephone=?,poste=?,organisation=?,
                    bio=?,langue=?,fuseau=?,notif_email=?,notif_push=? WHERE id=?""",
                 (nom, prenom, email, telephone,
                  nettoyer_texte(d.get("poste"), 80),
                  nettoyer_texte(d.get("organisation"), 120),
                  nettoyer_texte(d.get("bio"), 500),
                  langue, nettoyer_texte(d.get("fuseau"), 60) or "Africa/Douala",
                  1 if d.get("notif_email", u["notif_email"]) else 0,
                  1 if d.get("notif_push", u["notif_push"]) else 0,
                  u["id"]))
    db().commit()
    session["nom"] = nom
    session["email"] = email
    audit(session["user"], "profil-modifie", "compte", "OK", email)
    if email != u["email"]:
        notifications.envoyer_email(
            email, "Adresse email MboaPilot mise à jour",
            "Bonjour " + nom + ",\n\nL'adresse email de votre compte a été modifiée. "
            "Si vous n'êtes pas à l'origine de cette action, contactez l'administrateur.",
            "profil-email",
        )
    return jsonify({"ok": True, "message": "Profil enregistré.", "profil": lire_profil().get_json()})


@bp.route("/api/profil/avatar", methods=["POST"])
@login_required
def changer_avatar():
    f = request.files.get("avatar")
    if not f:
        return jsonify({"message": "Image requise."}), 400
    donnees = f.read(3 * 1024 * 1024 + 1)
    if len(donnees) > 3 * 1024 * 1024:
        return jsonify({"message": "Image trop volumineuse (3 Mo)."}), 413
    ext = None
    if donnees.startswith(b"\x89PNG\r\n\x1a\n"):
        ext = ".png"
    elif donnees.startswith(b"\xff\xd8\xff"):
        ext = ".jpg"
    elif donnees[:4] == b"RIFF" and donnees[8:12] == b"WEBP":
        ext = ".webp"
    if not ext:
        return jsonify({"message": "Format non reconnu. Utilisez PNG, JPG ou WebP."}), 400
    ancien = db().execute("SELECT avatar_url FROM users WHERE login=?", (session["user"],)).fetchone()
    nom = "avatar-" + secrets.token_hex(8) + ext
    (AVATARS / nom).write_bytes(donnees)
    db().execute("UPDATE users SET avatar_url=? WHERE login=?", ("/media/avatars/" + nom, session["user"]))
    db().commit()
    if ancien and ancien["avatar_url"]:
        try:
            (AVATARS / ancien["avatar_url"].split("/")[-1]).unlink(missing_ok=True)
        except Exception:
            pass
    audit(session["user"], "avatar-modifie", "compte", "OK")
    return jsonify({"ok": True, "avatar_url": "/media/avatars/" + nom})


@bp.route("/api/profil/verifier-email", methods=["POST"])
@login_required
def verifier_email():
    u = db().execute("SELECT email FROM users WHERE login=?", (session["user"],)).fetchone()
    code = "{:06d}".format(secrets.randbelow(900000) + 100000)
    cx = db()
    cx.execute("UPDATE mfa_codes SET utilise=1 WHERE login=? AND utilise=0",
               ("email-verif:" + session["user"],))
    from datetime import datetime, timedelta
    cx.execute("INSERT INTO mfa_codes(login,code,expire) VALUES(?,?,?)",
               ("email-verif:" + session["user"], code,
                (datetime.utcnow() + timedelta(minutes=15)).isoformat()))
    cx.commit()
    notifications.envoyer_email(
        u["email"], "Vérification de votre email MboaPilot",
        "Votre code de vérification est " + code + ". Il expire dans 15 minutes.",
        "email-verif",
    )
    rep = {"ok": True, "message": "Code envoyé à votre adresse email."}
    from .config import DEMO
    if DEMO:
        rep["code_demo"] = code
    return jsonify(rep)


@bp.route("/api/profil/confirmer-email", methods=["POST"])
@login_required
def confirmer_email():
    code = (request.get_json(force=True, silent=True) or {}).get("code", "")
    cx = db()
    r = cx.execute("SELECT * FROM mfa_codes WHERE login=? AND utilise=0 ORDER BY id DESC LIMIT 1",
                   ("email-verif:" + session["user"],)).fetchone()
    if not r or r["code"] != str(code).strip() or r["expire"] < __import__("datetime").datetime.utcnow().isoformat():
        return jsonify({"message": "Code incorrect ou expiré."}), 400
    cx.execute("UPDATE mfa_codes SET utilise=1 WHERE id=?", (r["id"],))
    cx.execute("UPDATE users SET email_verifie=1 WHERE login=?", (session["user"],))
    cx.commit()
    audit(session["user"], "email-verifie", "compte", "OK")
    return jsonify({"ok": True, "message": "Adresse email vérifiée."})


@bp.route("/api/profil/activite")
@login_required
def activite():
    c = _cx()
    rows = c.execute("""SELECT horo,action,ressource,resultat,ip FROM audit_logs
                        WHERE acteur=? ORDER BY id DESC LIMIT 50""", (session["user"],)).fetchall()
    c.close()
    return jsonify({"evenements": [dict(r) for r in rows]})


@bp.route("/api/profil/sessions")
@login_required
def sessions():
    c = _cx()
    rows = c.execute("""SELECT id,jti,ip,user_agent,cree_le,derniere_activite,active
                        FROM sessions_connectees WHERE login=? ORDER BY id DESC LIMIT 30""",
                     (session["user"],)).fetchall()
    c.close()
    return jsonify({"sessions": [dict(r) for r in rows]})


@bp.route("/api/profil/sessions/<int:sid>/fermer", methods=["POST"])
@login_required
def fermer_session(sid):
    c = _cx()
    c.execute("UPDATE sessions_connectees SET active=0 WHERE id=? AND login=?", (sid, session["user"]))
    c.commit()
    c.close()
    return jsonify({"ok": True})
