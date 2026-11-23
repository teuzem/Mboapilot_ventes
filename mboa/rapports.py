# -*- coding: utf-8 -*-
"""Rapports automatisés : envoi hebdomadaire et export d'audit signé."""
import hashlib
import hmac
import io
import json
import sqlite3
from datetime import date, datetime, timedelta

from flask import Blueprint, Response, jsonify, request, session

from . import notifications
from .config import ADMIN_EMAILS, BASE, SECRET
from .core import audit, db, perm_required

bp = Blueprint("rapports", __name__)
DB = BASE / "sales.db"


def _cx():
    c = sqlite3.connect(DB, timeout=30)
    c.row_factory = sqlite3.Row
    return c


def rapport_hebdomadaire():
    """Envoie le rapport de la semaine écoulée aux destinataires configurés."""
    c = _cx()
    fin = date.today() - timedelta(days=1)
    debut = fin - timedelta(days=6)
    r = c.execute("""SELECT COALESCE(SUM(montant),0) ca, COUNT(*) n,
                     COALESCE(SUM(montant-COALESCE(cout_unit,montant*0.75)),0) mg
                     FROM sales WHERE jour>=? AND jour<=?""",
                  (debut.isoformat(), fin.isoformat())).fetchone()
    regions = c.execute("""SELECT region, SUM(montant) ca FROM sales
                           WHERE jour>=? AND jour<=? GROUP BY region ORDER BY ca DESC LIMIT 10""",
                        (debut.isoformat(), fin.isoformat())).fetchall()
    c.close()
    corps = (
        "Rapport hebdomadaire MboaPilot\n\n"
        "Période : " + debut.isoformat() + " au " + fin.isoformat() + "\n"
        "Chiffre d'affaires : " + str(round(r["ca"])) + " FCFA\n"
        "Transactions : " + str(r["n"]) + "\n"
        "Marge brute : " + str(round(r["mg"])) + " FCFA\n\n"
        "Régions :\n" + "\n".join(x["region"] + " : " + str(round(x["ca"])) + " FCFA"
                                  for x in regions)
    )
    dest = list(ADMIN_EMAILS)
    if not dest:
        return 0
    for email in dest:
        notifications.envoyer_email(email, "Rapport hebdomadaire MboaPilot", corps, "rapport-hebdo")
    return len(dest)


@bp.route("/api/rapport/hebdo-envoyer", methods=["POST"])
@perm_required("users.manage")
def rapport_hebdo_endpoint():
    n = rapport_hebdomadaire()
    return jsonify({"ok": True, "destinataires": n})


@bp.route("/api/audit/export-pdf")
@perm_required("audit.view")
def audit_export_pdf():
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    c = _cx()
    q = (request.args.get("q") or "").strip()
    params = []
    where = ""
    if q:
        where = " WHERE acteur LIKE ? OR action LIKE ? OR ressource LIKE ?"
        params = ["%" + q + "%"] * 3
    rows = c.execute("SELECT * FROM audit_logs" + where + " ORDER BY id DESC LIMIT 500",
                     params).fetchall()
    c.close()
    buf = io.BytesIO()
    pdf = canvas.Canvas(buf, pagesize=A4)
    largeur, hauteur = A4
    y = hauteur - 20 * mm
    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawString(20 * mm, y, "MboaPilot : journal d'audit")
    y -= 10 * mm
    pdf.setFont("Helvetica", 8)
    for r in rows:
        if y < 20 * mm:
            pdf.showPage()
            y = hauteur - 20 * mm
        ligne = (str(r["horo"]) + " | " + str(r["acteur"])[:24] + " | " +
                 str(r["action"])[:30] + " | " + str(r["resultat"])[:10])
        pdf.drawString(20 * mm, y, ligne)
        y -= 4 * mm
    contenu = buf.getvalue()
    empreinte = hmac.new(SECRET.encode(), contenu, hashlib.sha256).hexdigest()
    pdf.save()
    rep = Response(buf.getvalue(), mimetype="application/pdf")
    rep.headers["Content-Disposition"] = 'attachment; filename="audit-mboapilot.pdf"'
    rep.headers["X-Signature"] = empreinte
    audit(session.get("user", "?"), "audit-export-pdf", str(len(rows)), "OK", empreinte[:24])
    return rep
