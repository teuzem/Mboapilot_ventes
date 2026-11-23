# -*- coding: utf-8 -*-
"""Notifications sortantes : email Resend ou SMTP, Web Push VAPID, outbox.

Aucun appel réseau n'est simulé. Quand une clé manque, l'envoi échoue, est
journalisé dans la table notifications et reprend selon un back-off exponentiel.
Le mode démo n'invente jamais de destinataire ni de contenu.
"""
import html
import json
import smtplib
import sqlite3
from datetime import datetime, timedelta
from email.message import EmailMessage
from pathlib import Path

import requests

from .config import (ADMIN_EMAILS, BASE, BREVO_HOST, BREVO_KEY, BREVO_LOGIN,
                     BREVO_PORT, DEMO, MAIL_FROM, MAIL_FROM_NAME,
                     MAIL_PROVIDER, RESEND_API_KEY, VAPID_PRIVATE_KEY,
                     VAPID_PUBLIC_KEY, VAPID_SUBJECT)
from .core import DB

RESEND_URL = "https://api.resend.com/emails"
RETRIS = (5, 15, 30)


def _cx():
    cx = sqlite3.connect(DB, timeout=30)
    cx.row_factory = sqlite3.Row
    cx.execute("PRAGMA journal_mode=WAL")
    return cx


def migrer():
    cx = _cx()
    cx.execute("""CREATE TABLE IF NOT EXISTS notifications(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        destinataire TEXT NOT NULL,
        canal TEXT NOT NULL,
        sujet TEXT,
        corps TEXT,
        reference TEXT,
        statut TEXT DEFAULT 'en_attente',
        tentatives INTEGER DEFAULT 0,
        prochaine_tentative TEXT,
        cree_le TEXT DEFAULT (datetime('now')),
        envoye_le TEXT,
        erreur TEXT
    )""")
    cx.execute("CREATE INDEX IF NOT EXISTS idx_notif_statut ON notifications(statut)")
    cx.execute("""CREATE TABLE IF NOT EXISTS push_subscriptions(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT,
        endpoint TEXT UNIQUE NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        cree_le TEXT DEFAULT (datetime('now'))
    )""")
    cx.commit()
    cx.close()


def _enregistrer(destinataire, canal, sujet, corps, reference=""):
    cx = _cx()
    cx.execute("""INSERT INTO notifications(destinataire,canal,sujet,corps,reference,statut,prochaine_tentative)
                  VALUES(?,?,?,?,?,'en_attente',datetime('now'))""",
               (destinataire, canal, sujet or "", corps or "", reference or ""))
    nid = cx.execute("SELECT last_insert_rowid() v").fetchone()["v"]
    cx.commit()
    cx.close()
    return nid


def _envoyer_email_resend(destinataire, sujet, corps):
    if not RESEND_API_KEY:
        raise RuntimeError("RESEND_API_KEY absent de la configuration.")
    rep = requests.post(
        RESEND_URL,
        headers={"Authorization": "Bearer " + RESEND_API_KEY,
                 "Content-Type": "application/json"},
        json={"from": MAIL_FROM_NAME + " <" + MAIL_FROM + ">",
              "to": [destinataire], "subject": sujet,
              "text": corps, "html": "<p>" + html.escape(corps).replace("\n", "<br>") + "</p>"},
        timeout=20,
    )
    if rep.status_code >= 300:
        raise RuntimeError("Resend " + str(rep.status_code) + " : " + rep.text[:300])
    return rep.json().get("id", "")


def _envoyer_email_smtp(destinataire, sujet, corps):
    if not (BREVO_LOGIN and BREVO_KEY):
        raise RuntimeError("Identifiants SMTP Brevo absents de la configuration.")
    msg = EmailMessage()
    msg["Subject"] = sujet
    msg["From"] = MAIL_FROM_NAME + " <" + MAIL_FROM + ">"
    msg["To"] = destinataire
    msg.set_content(corps)
    with smtplib.SMTP(BREVO_HOST, BREVO_PORT, timeout=20) as srv:
        srv.starttls()
        srv.login(BREVO_LOGIN, BREVO_KEY)
        srv.send_message(msg)
    return "smtp"


def _envoyer_push(destinataire, sujet, corps, reference=""):
    if not (VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY):
        raise RuntimeError("Clés VAPID absentes de la configuration.")
    from pywebpush import webpush, WebPushException

    cx = _cx()
    rows = cx.execute("SELECT * FROM push_subscriptions WHERE login=?", (destinataire,)).fetchall()
    cx.close()
    if not rows:
        raise RuntimeError("Aucun abonnement Web Push pour " + destinataire)
    charge = json.dumps({
        "title": sujet or "MboaPilot",
        "body": corps or "",
        "tag": reference or "mboapilot",
        "url": "/app",
    })
    echecs = []
    for r in rows:
        info = {"endpoint": r["endpoint"],
                "keys": {"p256dh": r["p256dh"], "auth": r["auth"]}}
        try:
            webpush(
                subscription_info=info,
                data=charge,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_SUBJECT},
            )
        except WebPushException as exc:
            echecs.append(str(exc))
            if exc.response is not None and exc.response.status_code in (404, 410):
                _desabonner(r["id"])
    if echecs and len(echecs) == len(rows):
        raise RuntimeError("; ".join(echecs)[:400])


def _desabonner(sid):
    cx = _cx()
    cx.execute("DELETE FROM push_subscriptions WHERE id=?", (sid,))
    cx.commit()
    cx.close()


def envoyer_email(destinataire, sujet, corps, reference=""):
    """Met un email en file puis tente immédiatement l'envoi."""
    nid = _enregistrer(destinataire, "email", sujet, corps, reference)
    traiter(nid)
    return nid


def envoyer_push(destinataire, sujet, corps, reference=""):
    nid = _enregistrer(destinataire, "push", sujet, corps, reference)
    traiter(nid)
    return nid


def notifier_admin(sujet, corps, reference=""):
    ids = []
    for email in ADMIN_EMAILS:
        ids.append(envoyer_email(email, sujet, corps, reference))
    return ids


def traiter(nid=None):
    """Traite la file. Sans identifiant, traite tout ce qui est échu."""
    cx = _cx()
    if nid is None:
        rows = cx.execute(
            "SELECT * FROM notifications WHERE statut='en_attente' "
            "AND prochaine_tentative<=datetime('now') ORDER BY id LIMIT 100"
        ).fetchall()
    else:
        rows = cx.execute("SELECT * FROM notifications WHERE id=?", (nid,)).fetchall()
    cx.close()
    traites = 0
    for row in rows:
        try:
            if row["canal"] == "email":
                if MAIL_PROVIDER == "smtp":
                    _envoyer_email_smtp(row["destinataire"], row["sujet"], row["corps"])
                else:
                    _envoyer_email_resend(row["destinataire"], row["sujet"], row["corps"])
            elif row["canal"] == "push":
                _envoyer_push(row["destinataire"], row["sujet"], row["corps"], row["reference"])
            else:
                raise RuntimeError("Canal inconnu : " + str(row["canal"]))
            _marquer(row["id"], "envoye")
            traites += 1
        except Exception as exc:
            _echouer(row["id"], str(exc))
    return traites


def _marquer(nid, statut):
    cx = _cx()
    cx.execute("UPDATE notifications SET statut=?, envoye_le=datetime('now'), erreur=NULL WHERE id=?",
               (statut, nid))
    cx.commit()
    cx.close()


def _echouer(nid, erreur):
    cx = _cx()
    row = cx.execute("SELECT tentatives FROM notifications WHERE id=?", (nid,)).fetchone()
    t = (row["tentatives"] or 0) + 1
    if t > len(RETRIS):
        cx.execute("UPDATE notifications SET statut='echec', tentatives=?, erreur=? WHERE id=?",
                   (t, erreur[:900], nid))
    else:
        # Back-off exponentiel : 5, 15 puis 30 minutes.
        minutes = RETRIS[t - 1]
        prochaine = (datetime.utcnow() + timedelta(minutes=minutes)).isoformat(" ")
        cx.execute("""UPDATE notifications SET tentatives=?, erreur=?, prochaine_tentative=?
                      WHERE id=?""", (t, erreur[:900], prochaine, nid))
    cx.commit()
    cx.close()


def abonner(login, endpoint, p256dh, auth, user_agent=""):
    if not all([login, endpoint, p256dh, auth]):
        raise ValueError("Abonnement Web Push incomplet.")
    cx = _cx()
    cx.execute("""INSERT INTO push_subscriptions(login,endpoint,p256dh,auth,user_agent)
                  VALUES(?,?,?,?,?)
                  ON CONFLICT(endpoint) DO UPDATE SET login=excluded.login,
                  p256dh=excluded.p256dh, auth=excluded.auth, user_agent=excluded.user_agent""",
               (login, endpoint, p256dh, auth, user_agent or ""))
    cx.commit()
    cx.close()


def desabonner(login, endpoint):
    cx = _cx()
    cx.execute("DELETE FROM push_subscriptions WHERE login=? AND endpoint=?", (login, endpoint))
    cx.commit()
    cx.close()


def etat():
    cx = _cx()
    r = cx.execute("""SELECT
        SUM(CASE WHEN statut='en_attente' THEN 1 ELSE 0 END) attente,
        SUM(CASE WHEN statut='envoye' THEN 1 ELSE 0 END) envoyes,
        SUM(CASE WHEN statut='echec' THEN 1 ELSE 0 END) echecs
        FROM notifications""").fetchone()
    cx.close()
    return {"attente": r["attente"] or 0, "envoyes": r["envoyes"] or 0,
            "echecs": r["echecs"] or 0,
            "email_configure": bool(RESEND_API_KEY or (BREVO_LOGIN and BREVO_KEY)),
            "push_configure": bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY),
            "demo": DEMO}


def cle_publique_vapid():
    return VAPID_PUBLIC_KEY
