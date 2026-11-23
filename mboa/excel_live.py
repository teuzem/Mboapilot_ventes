# -*- coding: utf-8 -*-
"""Excel installé sur le poste : connexion COM, feuilles ouvertes, glisser-déposer."""
import io
import os
import secrets
import time
from pathlib import Path

from flask import Blueprint, jsonify, request

from . import excel_com
from .config import BASE
from .core import audit, perm_required
from .fichiers import inserer_lignes

bp = Blueprint("excel_live", __name__)
DEPOT = BASE / "uploads" / "imports"
DEPOT.mkdir(parents=True, exist_ok=True)


@bp.route("/api/excel-live/statut")
@perm_required("imports.read")
def statut():
    return jsonify(excel_com.statut())


@bp.route("/api/excel-live/classeurs")
@perm_required("imports.read")
def classeurs():
    return jsonify(excel_com.classeurs_ouverts())


@bp.route("/api/excel-live/connecter", methods=["POST"])
@perm_required("imports.write")
def connecter():
    resultat = excel_com.connecter()
    audit(_login(), "excel-com-connecter", "", "OK" if resultat["ok"] else "KO")
    return jsonify(resultat), (200 if resultat["ok"] else 400)


@bp.route("/api/excel-live/ouvrir", methods=["POST"])
@perm_required("imports.write")
def ouvrir():
    d = request.get_json(force=True, silent=True) or {}
    chemin = d.get("chemin") or ""
    resultat = excel_com.ouvrir_classeur(chemin)
    audit(_login(), "excel-com-ouvrir", chemin[-120:], "OK" if resultat["ok"] else "KO")
    return jsonify(resultat), (200 if resultat["ok"] else 400)


@bp.route("/api/excel-live/apercu")
@perm_required("imports.read")
def apercu():
    classeur = request.args.get("classeur", "")
    feuille = request.args.get("feuille", "")
    if not classeur or not feuille:
        return jsonify({"ok": False, "message": "Classeur et feuille requis."}), 400
    return jsonify(excel_com.lire_feuille(classeur, feuille))


@bp.route("/api/excel-live/charger", methods=["POST"])
@perm_required("imports.write")
def charger():
    d = request.get_json(force=True, silent=True) or {}
    mapping = d.get("mapping") or {}
    if not mapping.get("jour") or not mapping.get("produit") or not mapping.get("qte"):
        return jsonify({"ok": False, "message": "Mapping incomplet."}), 400
    lecture = excel_com.lire_feuille(d.get("classeur", ""), d.get("feuille", ""))
    if not lecture.get("ok"):
        return jsonify(lecture), 400
    resultat = inserer_lignes(lecture["lignes"], mapping,
                              source="excel-com", mode=d.get("mode", "ignorer"),
                              periode=d.get("periode", ""))
    audit(_login(), "excel-com-charger", d.get("feuille", "")[:80], "OK",
          str(resultat["integrees"]) + " lignes")
    return jsonify(resultat)


@bp.route("/api/excel-live/upload", methods=["POST"])
@perm_required("imports.write")
def upload():
    """Réception d'un classeur déposé par glisser-déposer."""
    f = request.files.get("fichier")
    if not f or not f.filename:
        return jsonify({"ok": False, "message": "Fichier absent."}), 400
    ext = Path(f.filename).suffix.lower()
    if ext not in (".xlsx", ".xlsm", ".xls", ".csv"):
        return jsonify({"ok": False, "message": "Format non accepté."}), 400
    donnees = f.read(24 * 1024 * 1024 + 1)
    if len(donnees) > 24 * 1024 * 1024:
        return jsonify({"ok": False, "message": "Fichier trop volumineux."}), 413
    nom = str(int(time.time())) + "-" + secrets.token_hex(6) + ext
    chemin = DEPOT / nom
    chemin.write_bytes(donnees)
    from .fichiers import _chargeur
    try:
        lecture = _chargeur(str(chemin), None)
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)[:400]}), 400
    audit(_login(), "excel-drop-upload", f.filename[:120], "OK")
    return jsonify({"ok": True, "chemin": str(chemin), "nom": f.filename,
                    "feuilles": lecture.get("feuilles", []),
                    "feuille": lecture.get("feuille", ""),
                    "en_tetes": lecture.get("en_tetes", []),
                    "lignes": lecture.get("lignes", [])[:30],
                    "total": lecture.get("total", 0)})


@bp.route("/api/excel-live/fermer", methods=["POST"])
@perm_required("imports.write")
def fermer():
    return jsonify(excel_com.fermer())


def _login():
    from flask import session
    return session.get("user", "?")
