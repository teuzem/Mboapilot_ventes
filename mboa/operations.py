# -*- coding: utf-8 -*-
"""Opérations : saisie, POS live, exports, rapport, audit, contact."""
import csv
import hashlib
import io
import random
import re
from datetime import date, datetime, timedelta

from flask import Blueprint, Response, jsonify, request

from .core import (REGIONS, TAUX_MARGE, audit, db, email_valide, filtre_perimetre,
                   login_required, nettoyer_texte, perm_required, rate_limit,
                   ref_date, session, verifier_audit)
from .dashboard import _clause_base, _shift, _where_filtres

try:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
except Exception:  # pragma: no cover
    Workbook = None

bp = Blueprint("operations", __name__)


def _filtre_role_region(region):
    role, perim = session.get("role"), session.get("perimetre")
    if role in ("Commercial", "Manager") and perim != "National":
        return perim
    return region


@bp.route("/api/ventes-manuelle", methods=["POST"])
@perm_required("sales.write")
def vente_manuelle():
    d = request.get_json(force=True, silent=True) or {}
    cx = db()
    produit = nettoyer_texte(d.get("produit"), 120)
    prod = cx.execute("SELECT produit, famille FROM sales WHERE produit=? LIMIT 1", (produit,)).fetchone()
    if not prod:
        return jsonify({"message": "Produit inconnu. Choisissez un produit du catalogue."}), 400
    try:
        qte = int(d.get("qte") or 0)
        prix = float(d.get("prix_unit") or 0)
        remise = float(d.get("remise_pct") or 0)
    except (ValueError, TypeError):
        return jsonify({"message": "Quantité, prix et remise doivent être numériques."}), 400
    if qte <= 0 or qte > 100000:
        return jsonify({"message": "Quantité entre 1 et 100 000."}), 400
    if prix <= 0:
        return jsonify({"message": "Prix unitaire strictement positif."}), 400
    if not 0 <= remise <= 50:
        return jsonify({"message": "Remise entre 0 et 50 %."}), 400
    canal = (d.get("canal") or "POS").strip()
    if canal not in ("POS", "Agence", "E-commerce"):
        return jsonify({"message": "Canal invalide."}), 400
    try:
        jour = date.fromisoformat((d.get("jour") or date.today().isoformat())[:10])
        if jour > date.today():
            return jsonify({"message": "Date future interdite."}), 400
    except ValueError:
        return jsonify({"message": "Date invalide (AAAA-MM-JJ)."}), 400
    region = _filtre_role_region(nettoyer_texte(d.get("region"), 40))
    if region not in REGIONS:
        return jsonify({"message": "Région requise ou invalide."}), 400
    montant = round(qte * prix * (1 - remise / 100))
    ref = f"TX-MAN-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{random.randint(100, 999)}"
    try:
        cx.execute("""INSERT INTO sales(ref,jour,canal,region,ville,point_vente,vendeur,produit,famille,
                      qte,prix_unit,remise_pct,montant,cout_unit,source,import_created)
                      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'manuel',0)""",
                   (ref, jour.isoformat(), canal, region,
                    nettoyer_texte(d.get("ville"), 60) or region,
                    nettoyer_texte(d.get("point_vente"), 80) or "Saisie manuelle",
                    nettoyer_texte(d.get("vendeur"), 80) or session.get("nom", session["user"]),
                    prod["produit"], prod["famille"], qte, prix, remise, montant,
                    round(montant * (1 - TAUX_MARGE.get(prod["famille"], 0.25)))))
        cx.commit()
    except Exception:
        return jsonify({"message": "Référence dupliquée, réessayez."}), 409
    audit(session["user"], "saisie-manuelle", ref, "OK", f"{montant} FCFA / {region}")
    return jsonify({"ok": True, "ref": ref, "montant": montant, "region": region})


@bp.route("/api/pos-push", methods=["POST"])
@perm_required("sales.write")
def pos_push():
    cx = db()
    role, perim = session.get("role"), session.get("perimetre")
    where, params = "", []
    if role not in ("Admin", "Auditeur") and perim != "National":
        where, params = " AND region=?", [perim]
    prods = cx.execute(
        f"SELECT produit, famille, prix_unit, region, ville, point_vente FROM sales WHERE 1=1{where} ORDER BY RANDOM() LIMIT 1",
        params).fetchone()
    if not prods:
        return jsonify({"message": "Aucune donnée source pour simuler une caisse."}), 400
    ref = f"TX-POS-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{random.randint(1000, 9999)}"
    qte = random.choice([1, 1, 2, 3])
    montant = round(qte * prods["prix_unit"])
    cout = round(montant * (1 - TAUX_MARGE.get(prods["famille"], 0.25)))
    try:
        # On écrit sur la journée de référence du jeu de données pour que la
        # caisse live soit immédiatement visible dans le tableau de bord.
        jour_live = ref_date(cx).isoformat()
        cx.execute("""INSERT INTO sales(ref,jour,canal,region,ville,point_vente,vendeur,produit,famille,
                      qte,prix_unit,remise_pct,montant,cout_unit,source,import_created)
                      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pos-live',0)""",
                   (ref, jour_live, "POS", prods["region"], prods["ville"],
                    prods["point_vente"] or "POS Live", session.get("nom", session["user"]),
                    prods["produit"], prods["famille"], qte, prods["prix_unit"], 0, montant, cout))
        cx.commit()
        audit(session["user"], "pos-push", ref, "OK", f"{montant} FCFA")
        return jsonify({"ok": True, "ref": ref, "montant": montant})
    except Exception:
        return jsonify({"ok": False, "doublon": True})


# ---------- Exports ----------
def _csv_safe(v):
    s = "" if v is None else str(v)
    if s[:1] in ("=", "+", "@") or (s[:1] == "-" and not re.fullmatch(r"-\d+(\.\d+)?", s)):
        return "'" + s
    return s


@bp.route("/api/export/csv")
@perm_required("exports.csv")
def exp_csv():
    w, p, _, meta = _where_filtres()
    rows = db().execute(
        f"""SELECT ref,jour,canal,region,ville,point_vente,vendeur,produit,famille,qte,prix_unit,
            remise_pct,montant,COALESCE(cout_unit,0) cout_unit,montant-COALESCE(cout_unit,0) marge,devise
            FROM sales WHERE 1=1{w} ORDER BY jour DESC, id DESC LIMIT 100000""", p).fetchall()
    audit(session["user"], "export-csv", f"{len(rows)} lignes", "OK",
          f"{meta.get('debut')} → {meta.get('fin')}")
    out = io.StringIO()
    wr = csv.writer(out, delimiter=";")
    wr.writerow(["ref", "jour", "canal", "region", "ville", "point_vente", "vendeur", "produit",
                 "famille", "qte", "prix_unit", "remise_pct", "montant", "cout_unit", "marge", "devise"])
    for r in rows:
        wr.writerow([_csv_safe(r["ref"]), r["jour"], _csv_safe(r["canal"]), _csv_safe(r["region"]),
                     _csv_safe(r["ville"]), _csv_safe(r["point_vente"]), _csv_safe(r["vendeur"]),
                     _csv_safe(r["produit"]), _csv_safe(r["famille"]), r["qte"], r["prix_unit"],
                     r["remise_pct"], r["montant"], r["cout_unit"], r["marge"], _csv_safe(r["devise"])])
    return Response("\ufeff" + out.getvalue(), mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=mboapilot_export.csv"})


@bp.route("/api/export/xlsx")
@perm_required("exports.csv")
def exp_xlsx():
    if not Workbook:
        return jsonify({"message": "Export Excel indisponible."}), 501
    w, p, _, meta = _where_filtres()
    rows = db().execute(
        f"""SELECT ref,jour,canal,region,ville,point_vente,vendeur,produit,famille,qte,prix_unit,
            remise_pct,montant,COALESCE(cout_unit,0) cout_unit,montant-COALESCE(cout_unit,0) marge,devise
            FROM sales WHERE 1=1{w} ORDER BY jour DESC, id DESC LIMIT 100000""", p).fetchall()
    wb = Workbook()
    ws = wb.active
    ws.title = "Ventes"
    entetes = ["ref", "jour", "canal", "region", "ville", "point_vente", "vendeur", "produit",
               "famille", "qte", "prix_unit", "remise_pct", "montant", "cout_unit", "marge", "devise"]
    ws.append(entetes)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="0A2540")
    for r in rows:
        ws.append([r[k] for k in entetes])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:P{max(1, len(rows) + 1)}"
    for col, width in zip("ABCDEFGHIJKLMNOP", [18, 12, 12, 12, 14, 20, 18, 24, 14, 8, 14, 10, 14, 14, 14, 10]):
        ws.column_dimensions[col].width = width
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    audit(session["user"], "export-xlsx", f"{len(rows)} lignes", "OK")
    return Response(buf.read(), mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": "attachment; filename=mboapilot_export.xlsx"})


@bp.route("/api/rapport")
@perm_required("reports.view")
def api_rapport():
    cx = db()
    clause, params = filtre_perimetre()
    ref = ref_date(cx)
    debut = (ref - timedelta(days=365)).isoformat()
    base = f" WHERE jour >= ? AND jour <= ?{clause}"
    pp = [debut, ref.isoformat()] + params
    k = cx.execute(f"SELECT COALESCE(SUM(montant),0) ca, COUNT(*) nb FROM sales{base}", pp).fetchone()
    top = cx.execute(f"""SELECT produit, SUM(montant) ca, SUM(qte) q FROM sales{base}
                        GROUP BY produit ORDER BY ca DESC LIMIT 10""", pp).fetchall()
    regs = cx.execute(f"""SELECT region, SUM(montant) ca FROM sales{base}
                         GROUP BY region ORDER BY ca DESC""", pp).fetchall()
    fam = cx.execute(f"""SELECT famille, SUM(montant) ca,
                         SUM(montant-COALESCE(cout_unit,0)) mg FROM sales{base}
                         GROUP BY famille ORDER BY ca DESC""", pp).fetchall()
    contenu = f"{k['ca']}|{k['nb']}|{debut}|{ref.isoformat()}|{len(top)}"
    emp = hashlib.sha256((contenu + datetime.utcnow().isoformat()).encode()).hexdigest()[:16]
    audit(session["user"], "rapport-genere", f"rapport {emp}", "OK")
    return jsonify({"ca": k["ca"], "nb": k["nb"],
                    "top": [dict(r) for r in top],
                    "regions": [dict(r) for r in regs],
                    "familles": [dict(r) for r in fam],
                    "emp": emp, "debut": debut, "fin": ref.isoformat(),
                    "horo": datetime.utcnow().strftime("%d/%m/%Y %H:%M UTC")})


# ---------- Audit ----------
@bp.route("/api/audit")
@perm_required("audit.view")
def api_audit():
    q = (request.args.get("q") or "").strip()
    cx = db()
    rows = cx.execute(
        """SELECT * FROM audit_logs WHERE acteur LIKE ? OR action LIKE ? OR ressource LIKE ?
           OR details LIKE ? ORDER BY id DESC LIMIT 200""",
        (f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%")).fetchall()
    n = cx.execute("SELECT COUNT(*) c FROM audit_logs").fetchone()["c"]
    return jsonify({"logs": [dict(r) for r in rows], "total": n})


@bp.route("/api/audit/verifier")
@perm_required("audit.view")
def api_audit_verifier():
    return jsonify(verifier_audit())


# ---------- Contact ----------
@bp.route("/api/contact", methods=["POST"])
def api_contact():
    if not rate_limit("contact:" + (request.remote_addr or "-"), 6, 3600):
        return jsonify({"message": "Trop de messages envoyés. Réessayez plus tard.", "code": "rate"}), 429
    d = request.get_json(force=True, silent=True) or {}
    nom = nettoyer_texte(d.get("nom"), 80)
    email = nettoyer_texte(d.get("email"), 120).lower()
    message = nettoyer_texte(d.get("message"), 2000)
    if not nom or not email_valide(email) or not message:
        return jsonify({"message": "Nom, email valide et message sont requis."}), 400
    db().execute("INSERT INTO messages(nom,entreprise,email,tel,profil,message) VALUES(?,?,?,?,?,?)",
                 (nom, nettoyer_texte(d.get("entreprise"), 120), email,
                  nettoyer_texte(d.get("tel"), 40), nettoyer_texte(d.get("profil"), 80), message))
    db().commit()
    audit("visiteur", "contact", email, "OK")
    return jsonify({"ok": True, "message": "Message reçu. Réponse sous 24h ouvrées."})
