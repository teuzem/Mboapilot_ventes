# -*- coding: utf-8 -*-
"""Extensions du sprint : Web Push, notifications in-app, passkeys, alertes, objectifs."""
import base64
import json
import secrets
import sqlite3
import time
from datetime import date, datetime, timedelta

import pyotp
from flask import Blueprint, jsonify, request, session
from webauthn import (base64url_to_bytes, generate_authentication_options,
                      generate_registration_options, options_to_json,
                      verify_authentication_response, verify_registration_response)
from webauthn.helpers.structs import (AuthenticationCredential, AuthenticatorSelectionCriteria,
                                      PublicKeyCredentialDescriptor, RegistrationCredential,
                                      UserVerificationRequirement)

from . import mfa, notifications
from .config import (ADMIN_EMAILS, DEMO, ORIGIN, RP_ID, VAPID_PUBLIC_KEY)
from .core import (FAMILLES, PERMISSIONS, REGIONS, audit, db, filtre_perimetre,
                   has_perm, login_required, perm_required, rate_limit,
                   ref_date, session_user)

bp = Blueprint("extensions", __name__)


def _cx():
    c = sqlite3.connect(str(__import__("pathlib").Path(__file__).resolve().parent.parent / "sales.db"), timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


# ---------- Web Push VAPID ----------
@bp.route("/api/notifications/vapid-key")
def vapid_key():
    return jsonify({"key": VAPID_PUBLIC_KEY, "configure": bool(VAPID_PUBLIC_KEY)})


@bp.route("/api/notifications/subscribe", methods=["POST"])
def push_subscribe():
    d = request.get_json(force=True, silent=True) or {}
    login = session.get("user") or session.get("partner_email") or d.get("login")
    if not login:
        return jsonify({"message": "Authentification requise.", "code": "session"}), 401
    sub = d.get("subscription") or {}
    keys = sub.get("keys") or {}
    try:
        notifications.abonner(
            login, sub.get("endpoint"), keys.get("p256dh"), keys.get("auth"),
            request.headers.get("User-Agent", "")[:200],
        )
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 400
    return jsonify({"ok": True, "message": "Abonnement Web Push enregistré."})


@bp.route("/api/notifications/unsubscribe", methods=["POST"])
def push_unsubscribe():
    d = request.get_json(force=True, silent=True) or {}
    login = session.get("user") or session.get("partner_email")
    if not login or not d.get("endpoint"):
        return jsonify({"message": "Abonnement introuvable."}), 400
    notifications.desabonner(login, d["endpoint"])
    return jsonify({"ok": True})


@bp.route("/api/notifications/inapp")
@login_required
def inapp_liste():
    c = _cx()
    rows = c.execute("""SELECT * FROM notifications_inapp WHERE login=?
                        ORDER BY lue, id DESC LIMIT 100""", (session["user"],)).fetchall()
    nonlues = c.execute("SELECT COUNT(*) n FROM notifications_inapp WHERE login=? AND lue=0",
                        (session["user"],)).fetchone()["n"]
    c.close()
    return jsonify({"notifications": [dict(r) for r in rows], "nonlues": nonlues})


@bp.route("/api/notifications/inapp/<int:nid>/lu", methods=["POST"])
@login_required
def inapp_lu(nid):
    c = _cx()
    c.execute("UPDATE notifications_inapp SET lue=1 WHERE id=? AND login=?", (nid, session["user"]))
    c.commit()
    c.close()
    return jsonify({"ok": True})


@bp.route("/api/notifications/inapp/tout-lu", methods=["POST"])
@login_required
def inapp_tout_lu():
    c = _cx()
    c.execute("UPDATE notifications_inapp SET lue=1 WHERE login=?", (session["user"],))
    c.commit()
    c.close()
    return jsonify({"ok": True})


@bp.route("/api/notifications/etat")
@perm_required("users.manage")
def notifications_etat():
    return jsonify(notifications.etat())


@bp.route("/api/notifications/traiter", methods=["POST"])
@perm_required("users.manage")
def notifications_traiter():
    return jsonify({"traites": notifications.traiter(), "etat": notifications.etat()})


def note_inapp(login, titre, message, lien="/app", categorie="alerte"):
    c = _cx()
    c.execute("""INSERT INTO notifications_inapp(login,titre,message,lien,categorie)
                 VALUES(?,?,?,?,?)""", (login, titre, message, lien, categorie))
    c.commit()
    c.close()
    notifications.envoyer_push(login, titre, message, categorie)


# ---------- Passkeys WebAuthn ----------
def _wa_options(login):
    c = _cx()
    rows = c.execute("SELECT credential_id,transports FROM webauthn_credentials WHERE login=?",
                     (login,)).fetchall()
    excluded = []
    for r in rows:
        transports = None
        try:
            transports = json.loads(r["transports"]) if r["transports"] else None
        except Exception:
            transports = None
        excluded.append(PublicKeyCredentialDescriptor(
            id=base64url_to_bytes(r["credential_id"]), type="public-key", transports=transports))
    return excluded


@bp.route("/api/webauthn/register-options", methods=["POST"])
@login_required
def wa_register_options():
    from .auth import step_up_valide
    if not step_up_valide():
        return jsonify({"message": "Vérification récente requise.", "code": "step_up"}), 403
    login = session["user"]
    options = generate_registration_options(
        rp_id=RP_ID, rp_name="MboaPilot",
        user_id=login.encode("utf-8"), user_name=login,
        user_display_name=session.get("nom") or login,
        exclude_credentials=_wa_options(login),
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key="required", user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )
    session["wa_reg_challenge"] = base64.b64encode(options.challenge).decode()
    session["wa_reg_login"] = login
    session.modified = True
    return jsonify(json.loads(options_to_json(options)))


@bp.route("/api/webauthn/register-verify", methods=["POST"])
@login_required
def wa_register_verify():
    chall = session.get("wa_reg_challenge")
    if not chall:
        return jsonify({"message": "Aucun enrôlement en cours."}), 400
    d = request.get_json(force=True, silent=True) or {}
    try:
        v = verify_registration_response(
            credential=RegistrationCredential.parse_raw(json.dumps(d)),
            expected_challenge=base64.b64decode(chall),
            expected_rp_id=RP_ID, expected_origin=ORIGIN,
            require_user_verification=True,
        )
    except Exception as exc:
        return jsonify({"message": "Vérification refusée : " + str(exc)[:200]}), 400
    if not v.user_verified:
        return jsonify({"message": "La vérification utilisateur est obligatoire."}), 400
    cid = base64.b64encode(v.credential_id).decode()
    pub = base64.b64encode(v.credential_public_key).decode()
    transports = (d.get("response") or {}).get("transports")
    c = _cx()
    c.execute("""INSERT INTO webauthn_credentials(login,credential_id,public_key,sign_count,
                 transports,device_type,backed_up) VALUES(?,?,?,?,?,?,?)
                 ON CONFLICT(credential_id) DO UPDATE SET public_key=excluded.public_key,
                 sign_count=excluded.sign_count, login=excluded.login""",
              (session["user"], cid, pub, v.sign_count,
               json.dumps(transports) if transports else None,
               v.credential_device_type, 1 if v.credential_backed_up else 0))
    c.commit()
    c.close()
    session.pop("wa_reg_challenge", None)
    audit(session["user"], "passkey-ajoutee", cid[:24], "OK")
    notes = notifications.envoyer_email(
        session.get("email") or "", "Nouvelle passkey MboaPilot",
        "Une nouvelle passkey a été enregistrée sur votre compte. "
        "Si vous n'êtes pas à l'origine de cette action, contactez l'administrateur.",
        "passkey-add",
    )
    return jsonify({"ok": True, "credential_id": cid, "notification": notes})


@bp.route("/api/webauthn/auth-options", methods=["POST"])
def wa_auth_options():
    d = request.get_json(force=True, silent=True) or {}
    login = session.get("pre_mfa") or (d.get("login") or "").strip().lower()
    if not login:
        return jsonify({"message": "Identifiant requis."}), 400
    if not rate_limit("wa-options:" + (request.remote_addr or "-"), 20, 60):
        return jsonify({"message": "Trop de demandes.", "code": "rate"}), 429
    c = _cx()
    rows = c.execute("SELECT credential_id,transports FROM webauthn_credentials WHERE login=?",
                     (login,)).fetchall()
    c.close()
    if not rows:
        return jsonify({"message": "Aucune passkey enregistrée.", "code": "no_credential"}), 404
    allow = []
    for r in rows:
        allow.append(PublicKeyCredentialDescriptor(
            id=base64url_to_bytes(r["credential_id"]), type="public-key"))
    options = generate_authentication_options(
        rp_id=RP_ID, allow_credentials=allow,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    session["wa_auth_challenge"] = base64.b64encode(options.challenge).decode()
    session["wa_auth_login"] = login
    session.modified = True
    return jsonify(json.loads(options_to_json(options)))


@bp.route("/api/webauthn/auth-verify", methods=["POST"])
def wa_auth_verify():
    chall = session.get("wa_auth_challenge")
    login = session.get("wa_auth_login")
    if not chall or not login:
        return jsonify({"message": "Aucune authentification en cours."}), 400
    d = request.get_json(force=True, silent=True) or {}
    try:
        cred = AuthenticationCredential.parse_raw(json.dumps(d))
    except Exception as exc:
        return jsonify({"message": "Réponse invalide : " + str(exc)[:200]}), 400
    cid = base64.b64encode(cred.raw_id).decode()
    c = _cx()
    row = c.execute("SELECT * FROM webauthn_credentials WHERE login=? AND credential_id=?",
                    (login, cid)).fetchone()
    if not row:
        c.close()
        return jsonify({"message": "Passkey inconnue."}), 401
    try:
        v = verify_authentication_response(
            credential=cred, expected_challenge=base64.b64decode(chall),
            expected_rp_id=RP_ID, expected_origin=ORIGIN,
            credential_public_key=base64.b64decode(row["public_key"]),
            credential_current_sign_count=int(row["sign_count"] or 0),
            require_user_verification=True,
        )
    except Exception as exc:
        c.close()
        audit(login, "passkey-refusee", cid[:24], "KO", str(exc)[:200])
        return jsonify({"message": "Vérification refusée : " + str(exc)[:200]}), 401
    if not v.user_verified:
        c.close()
        return jsonify({"message": "Vérification utilisateur obligatoire."}), 401
    c.execute("UPDATE webauthn_credentials SET sign_count=?, derniere_utilisation=datetime('now') WHERE id=?",
              (v.new_sign_count, row["id"]))
    c.commit()
    c.close()
    session.pop("wa_auth_challenge", None)
    u = db().execute("SELECT * FROM users WHERE login=? AND actif=1", (login,)).fetchone()
    if not u:
        return jsonify({"message": "Compte introuvable."}), 401
    from .auth import _ouvrir_session
    _ouvrir_session(u)
    audit(login, "passkey-login", cid[:24], "OK")
    return jsonify({"user": session_user(), "moyen": "passkey"})


@bp.route("/api/webauthn/credentials")
@login_required
def wa_credentials():
    c = _cx()
    rows = c.execute("""SELECT id,credential_id,device_type,backed_up,cree_le,derniere_utilisation
                        FROM webauthn_credentials WHERE login=? ORDER BY id DESC""",
                     (session["user"],)).fetchall()
    c.close()
    return jsonify({"credentials": [dict(r) for r in rows]})


@bp.route("/api/webauthn/credentials/<int:cid>", methods=["DELETE"])
@login_required
def wa_credentials_delete(cid):
    c = _cx()
    c.execute("DELETE FROM webauthn_credentials WHERE id=? AND login=?", (cid, session["user"]))
    c.commit()
    c.close()
    audit(session["user"], "passkey-supprimee", str(cid), "OK")
    return jsonify({"ok": True})


# ---------- Objectifs ----------
@bp.route("/api/objectifs")
@login_required
def objectifs_liste():
    c = _cx()
    rows = c.execute("SELECT * FROM objectifs ORDER BY periode,region,famille").fetchall()
    c.close()
    return jsonify({"objectifs": [dict(r) for r in rows]})


@bp.route("/api/objectifs", methods=["POST"])
@perm_required("users.manage")
def objectifs_save():
    d = request.get_json(force=True, silent=True) or {}
    periode = (d.get("periode") or "mensuel").strip()[:30]
    region = (d.get("region") or "National").strip()[:40]
    famille = (d.get("famille") or "Toutes").strip()[:40]
    if region != "National" and region not in REGIONS:
        return jsonify({"message": "Région invalide."}), 400
    if famille != "Toutes" and famille not in FAMILLES:
        return jsonify({"message": "Famille invalide."}), 400
    try:
        montant = float(d.get("montant") or 0)
    except (ValueError, TypeError):
        return jsonify({"message": "Montant invalide."}), 400
    if montant <= 0:
        return jsonify({"message": "Montant strictement positif."}), 400
    c = _cx()
    c.execute("""INSERT INTO objectifs(periode,region,famille,montant,cree_par)
                 VALUES(?,?,?,?,?) ON CONFLICT(periode,region,famille)
                 DO UPDATE SET montant=excluded.montant, cree_par=excluded.cree_par,
                 cree_le=datetime('now')""",
              (periode, region, famille, montant, session["user"]))
    c.commit()
    c.close()
    audit(session["user"], "objectif-save", region + "/" + famille, "OK", str(montant))
    return jsonify({"ok": True, "message": "Objectif enregistré."})


# ---------- Alertes ----------
@bp.route("/api/alert-rules")
@login_required
def alert_rules_liste():
    c = _cx()
    rows = c.execute("SELECT * FROM alert_rules ORDER BY id DESC").fetchall()
    c.close()
    return jsonify({"regles": [dict(r) for r in rows]})


@bp.route("/api/alert-rules", methods=["POST"])
@perm_required("users.manage")
def alert_rules_save():
    d = request.get_json(force=True, silent=True) or {}
    nom = (d.get("nom") or "").strip()[:120]
    indicateur = (d.get("indicateur") or "ca").strip()[:40]
    operateur = (d.get("operateur") or "<").strip()[:4]
    if not nom or indicateur not in ("ca", "marge", "transactions", "panier") or operateur not in ("<", ">", "<=", ">="):
        return jsonify({"message": "Règle invalide."}), 400
    try:
        seuil = float(d.get("seuil") or 0)
    except (ValueError, TypeError):
        return jsonify({"message": "Seuil invalide."}), 400
    region = (d.get("region") or "National").strip()[:40]
    if region != "National" and region not in REGIONS:
        return jsonify({"message": "Région invalide."}), 400
    criticite = (d.get("criticite") or "Moyenne").strip()[:20]
    if criticite not in ("Basse", "Moyenne", "Haute"):
        return jsonify({"message": "Criticité invalide."}), 400
    dest = d.get("destinataires") or []
    if isinstance(dest, str):
        dest = [x.strip() for x in dest.split(",") if x.strip()]
    c = _cx()
    rid = d.get("id")
    if rid:
        c.execute("""UPDATE alert_rules SET nom=?,indicateur=?,operateur=?,seuil=?,region=?,
                     destinataires=?,criticite=?,validee_par=? WHERE id=?""",
                  (nom, indicateur, operateur, seuil, region, json.dumps(dest), criticite,
                   session["user"], rid))
    else:
        c.execute("""INSERT INTO alert_rules(nom,indicateur,operateur,seuil,region,destinataires,
                     criticite,active,cree_par) VALUES(?,?,?,?,?,?,?,0,?)""",
                  (nom, indicateur, operateur, seuil, region, json.dumps(dest), criticite,
                   session["user"]))
        rid = c.execute("SELECT last_insert_rowid() v").fetchone()["v"]
    c.commit()
    c.close()
    audit(session["user"], "alerte-regle-save", str(rid), "OK", nom)
    return jsonify({"ok": True, "id": rid, "message": "Règle enregistrée. Validation requise avant activation."})


@bp.route("/api/alert-rules/<int:rid>/activer", methods=["POST"])
@perm_required("users.manage")
def alert_rules_activer(rid):
    c = _cx()
    r = c.execute("SELECT * FROM alert_rules WHERE id=?", (rid,)).fetchone()
    if not r:
        c.close()
        return jsonify({"message": "Règle introuvable."}), 404
    nouvelle = 0 if r["active"] else 1
    c.execute("UPDATE alert_rules SET active=?, validee_par=? WHERE id=?",
              (nouvelle, session["user"] if nouvelle else None, rid))
    c.commit()
    c.close()
    audit(session["user"], "alerte-regle-active", str(rid), "OK", str(nouvelle))
    return jsonify({"ok": True, "active": bool(nouvelle)})


@bp.route("/api/alert-rules/<int:rid>", methods=["DELETE"])
@perm_required("users.manage")
def alert_rules_delete(rid):
    c = _cx()
    c.execute("DELETE FROM alert_rules WHERE id=?", (rid,))
    c.commit()
    c.close()
    return jsonify({"ok": True})


@bp.route("/api/alert-events")
@login_required
def alert_events():
    c = _cx()
    rows = c.execute("""SELECT e.*, r.nom FROM alert_events e LEFT JOIN alert_rules r ON r.id=e.rule_id
                        ORDER BY e.id DESC LIMIT 200""").fetchall()
    c.close()
    return jsonify({"evenements": [dict(r) for r in rows]})


def evaluer_alertes():
    """Évalue les règles actives sur la journée de référence."""
    c = _cx()
    regles = c.execute("SELECT * FROM alert_rules WHERE active=1").fetchall()
    ref = ref_date()
    déclenchées = []
    for r in regles:
        where, params = "", []
        if r["region"] != "National":
            where, params = " AND region=?", [r["region"]]
        row = c.execute(
            "SELECT COALESCE(SUM(montant),0) ca, COUNT(*) n, "
            "COALESCE(SUM(montant-COALESCE(cout_unit,montant*0.75)),0) mg FROM sales "
            "WHERE jour=?" + where, [ref.isoformat()] + params).fetchone()
        valeurs = {"ca": row["ca"], "marge": row["mg"], "transactions": row["n"],
                   "panier": (row["ca"] / row["n"]) if row["n"] else 0}
        valeur = valeurs.get(r["indicateur"], 0)
        seuil = r["seuil"]
        op = r["operateur"]
        ok = (valeur < seuil) if op == "<" else ((valeur > seuil) if op == ">" else
              ((valeur <= seuil) if op == "<=" else (valeur >= seuil)))
        if not ok:
            continue
        from .config import ALERTE_ANTI_REBOND_MINUTES
        if r["derniere_alerte"]:
            try:
                last = datetime.fromisoformat(r["derniere_alerte"])
                if datetime.utcnow() - last < timedelta(minutes=ALERTE_ANTI_REBOND_MINUTES):
                    continue
            except Exception:
                pass
        message = (r["nom"] + " : " + r["indicateur"] + " = " + str(round(valeur)) +
                   " (" + op + " " + str(seuil) + ")")
        c.execute("""INSERT INTO alert_events(rule_id,valeur,seuil,message) VALUES(?,?,?,?)""",
                  (r["id"], valeur, seuil, message))
        c.execute("UPDATE alert_rules SET derniere_alerte=? WHERE id=?",
                  (datetime.utcnow().isoformat(), r["id"]))
        dest = []
        try:
            dest = json.loads(r["destinataires"] or "[]")
        except Exception:
            pass
        if not dest:
            dest = list(ADMIN_EMAILS)
        for d in dest:
            if "@" in d:
                notifications.envoyer_email(d, "Alerte MboaPilot : " + r["nom"], message, "alerte")
        if r["criticite"] == "Haute":
            try:
                from .sms import envoyer_sms_admin
                envoyer_sms_admin("Alerte haute MboaPilot : " + r["nom"], message)
            except Exception:
                pass
        for u in c.execute("SELECT login FROM users WHERE role IN ('Admin','Manager') AND actif=1").fetchall():
            note_inapp(u["login"], r["nom"], message, "/app", "alerte")
        c.commit()
        déclenchées.append(message)
    c.close()
    return déclenchées


@bp.route("/api/alert-evaluer", methods=["POST"])
@perm_required("users.manage")
def alert_evaluer():
    return jsonify({"declenchees": evaluer_alertes()})
