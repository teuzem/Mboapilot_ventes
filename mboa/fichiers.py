# -*- coding: utf-8 -*-
"""Navigateur de fichiers local et import Excel réel depuis le poste de l'utilisateur.

Les racines autorisées sont définies par MBOA_EXCEL_ROOTS. Aucun chemin hors de
ces racines n'est accessible. Les classeurs sont lus avec openpyxl, les feuilles
et les lignes sont renvoyées telles quelles, sans génération de données.
"""
import csv
import io
import os
import time
from pathlib import Path

from flask import Blueprint, jsonify, request, session

from .config import BASE
from .core import (CHAMPS_VENTE, REGIONS, audit, nettoyer_texte,
                   perm_required, parse_date_fr, parse_nombre)

bp = Blueprint("fichiers", __name__)
EXTENSIONS = (".xlsx", ".xlsm", ".xls", ".csv", ".txt")


def racines():
    brut = os.environ.get("MBOA_EXCEL_ROOTS", "")
    if brut:
        chemins = [x.strip() for x in brut.split(";") if x.strip()]
    else:
        home = Path.home()
        chemins = [str(home / "Documents"), str(home / "Downloads"),
                   str(home / "Desktop"), str(home / "OneDrive")]
    sortie = []
    for c in chemins:
        p = Path(c).expanduser()
        if not p.is_absolute():
            p = (BASE / p).resolve()
        if p.exists() and p.is_dir():
            sortie.append(str(p.resolve()))
    if not sortie:
        sortie = [str(BASE.resolve())]
    return sortie


def _securiser(chemin):
    """Retourne un Path résolu à condition qu'il soit dans une racine autorisée."""
    if not chemin:
        raise ValueError("Chemin absent.")
    p = Path(str(chemin)).expanduser()
    if not p.is_absolute():
        p = BASE / p
    p = p.resolve()
    autorises = racines() + [str(BASE.resolve())]
    for racine in autorises:
        r = Path(racine).resolve()
        try:
            p.relative_to(r)
            return p
        except ValueError:
            continue
    raise ValueError("Accès refusé : ce dossier n'est pas autorisé.")


@bp.route("/api/fichiers/racines")
@perm_required("imports.read")
def lister_racines():
    return jsonify({"racines": racines()})


@bp.route("/api/fichiers/lister")
@perm_required("imports.read")
def lister_dossier():
    try:
        dossier = _securiser(request.args.get("chemin") or racines()[0])
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 403
    if not dossier.is_dir():
        return jsonify({"message": "Dossier introuvable."}), 404
    dossiers, fichiers = [], []
    try:
        for entree in sorted(dossier.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            if entree.name.startswith(".") or entree.name.startswith("~$"):
                continue
            if entree.is_dir():
                dossiers.append({"nom": entree.name, "chemin": str(entree)})
            elif entree.suffix.lower() in EXTENSIONS:
                fichiers.append({
                    "nom": entree.name,
                    "chemin": str(entree),
                    "taille": entree.stat().st_size,
                    "modifie": time.strftime("%d/%m/%Y %H:%M", time.localtime(entree.stat().st_mtime)),
                })
    except PermissionError:
        return jsonify({"message": "Lecture interdite par le système."}), 403
    return jsonify({"chemin": str(dossier), "parent": str(dossier.parent) if str(dossier) not in racines() else None,
                    "dossiers": dossiers, "fichiers": fichiers})


def _chargeur(chemin, feuille=None, max_lignes=200):
    p = _securiser(chemin)
    if not p.is_file():
        raise ValueError("Fichier introuvable.")
    if p.suffix.lower() in (".xlsx", ".xlsm", ".xls"):
        import openpyxl
        wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
        nom = feuille or wb.sheetnames[0]
        if nom not in wb.sheetnames:
            wb.close()
            raise ValueError("Feuille introuvable.")
        ws = wb[nom]
        it = ws.iter_rows(values_only=True)
        entetes = [str(x or "").strip() for x in next(it, ())]
        lignes = []
        for row in it:
            if len(lignes) >= max_lignes:
                break
            if not any(v not in (None, "") for v in row):
                continue
            lignes.append({entetes[i]: row[i] for i in range(min(len(entetes), len(row)))})
        wb.close()
        return {"feuilles": wb.sheetnames, "feuille": nom, "en_tetes": entetes,
                "lignes": lignes, "total": len(lignes)}
    texte = p.read_text(encoding="utf-8-sig", errors="replace")
    separateur = request.args.get("separateur", ";") if request else ";"
    lecteur = csv.DictReader(io.StringIO(texte), delimiter=separateur)
    entetes = lecteur.fieldnames or []
    lignes = []
    for i, row in enumerate(lecteur):
        if i >= max_lignes:
            break
        lignes.append(dict(row))
    return {"feuilles": [], "feuille": "", "en_tetes": entetes,
            "lignes": lignes, "total": len(lignes)}


@bp.route("/api/fichiers/feuilles")
@perm_required("imports.read")
def lister_feuilles():
    try:
        p = _securiser(request.args.get("chemin"))
        if p.suffix.lower() not in (".xlsx", ".xlsm", ".xls"):
            return jsonify({"feuilles": [], "message": "Pas un classeur Excel."})
        import openpyxl
        wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
        feuilles = wb.sheetnames
        wb.close()
        return jsonify({"feuilles": feuilles})
    except Exception as exc:
        return jsonify({"message": str(exc)[:300]}), 400


@bp.route("/api/fichiers/apercu")
@perm_required("imports.read")
def apercu_fichier():
    try:
        data = _chargeur(request.args.get("chemin"), request.args.get("feuille"))
        return jsonify(data)
    except Exception as exc:
        return jsonify({"message": str(exc)[:300]}), 400


def inserer_lignes(lignes, mapping, source="excel", mode="ignorer", periode="", reference=None):
    """Contrôles métier et insertion réelle, partagés par tous les modes d'import."""
    cx = __import__("sqlite3").connect(BASE / "sales.db", timeout=30)
    cx.row_factory = __import__("sqlite3").Row
    cx.execute("PRAGMA journal_mode=WAL")
    connu = set(r[0] for r in cx.execute("SELECT ref FROM sales WHERE ref IS NOT NULL"))
    integ, mises_a_jour, rejets, erreurs = 0, 0, 0, []
    ref_base = reference or ("XL-" + time.strftime("%Y%m%d%H%M%S"))
    for i, ligne in enumerate(lignes, start=2):
        try:
            jour = parse_date_fr(ligne.get(mapping["jour"])).isoformat()
            if periode and not (periode[0] <= jour <= periode[1]):
                continue
            produit = nettoyer_texte(ligne.get(mapping["produit"]), 120)
            qte = parse_nombre(ligne.get(mapping["qte"]))
            prix = parse_nombre(ligne.get(mapping.get("prix_unit", ""))) if mapping.get("prix_unit") else None
            if not produit or not qte or qte <= 0 or prix is None or prix <= 0:
                raise ValueError("Produit, quantité ou prix manquant")
            remise = parse_nombre(ligne.get(mapping.get("remise_pct", "")), 0) if mapping.get("remise_pct") else 0
            region = nettoyer_texte(ligne.get(mapping.get("region", "")), 40) or "Centre"
            if region not in REGIONS:
                raise ValueError("Région inconnue : " + region)
            canal = nettoyer_texte(ligne.get(mapping.get("canal", "")), 20) or "Agence"
            ref = nettoyer_texte(ligne.get(mapping.get("ref", "")), 120) or (ref_base + "-" + str(i).zfill(5))
            if ref in connu:
                if mode == "mettre_a_jour":
                    cx.execute("""UPDATE sales SET jour=?,canal=?,region=?,ville=?,point_vente=?,
                                  vendeur=?,produit=?,famille=?,qte=?,prix_unit=?,remise_pct=?,montant=?,
                                  cout_unit=?,devise=? WHERE ref=?""",
                               (jour, canal, region,
                                nettoyer_texte(ligne.get(mapping.get("ville", "")), 60),
                                nettoyer_texte(ligne.get(mapping.get("point_vente", "")), 80),
                                nettoyer_texte(ligne.get(mapping.get("vendeur", "")), 80),
                                produit, nettoyer_texte(ligne.get(mapping.get("famille", "")), 40),
                                qte, prix, remise or 0,
                                round(qte * prix * (1 - (remise or 0) / 100)),
                                parse_nombre(ligne.get(mapping.get("cout_unit", ""))) if mapping.get("cout_unit") else None,
                                "FCFA", ref))
                    mises_a_jour += 1
                else:
                    rejets += 1
                continue
            montant = round(qte * prix * (1 - (remise or 0) / 100))
            cout = parse_nombre(ligne.get(mapping.get("cout_unit", ""))) if mapping.get("cout_unit") else None
            cx.execute("""INSERT INTO sales(ref,jour,canal,region,ville,point_vente,vendeur,
                          produit,famille,qte,prix_unit,remise_pct,montant,cout_unit,devise,source)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                       (ref, jour, canal, region,
                        nettoyer_texte(ligne.get(mapping.get("ville", "")), 60),
                        nettoyer_texte(ligne.get(mapping.get("point_vente", "")), 80),
                        nettoyer_texte(ligne.get(mapping.get("vendeur", "")), 80),
                        produit, nettoyer_texte(ligne.get(mapping.get("famille", "")), 40),
                        qte, prix, remise or 0, montant, cout, "FCFA", source))
            connu.add(ref)
            integ += 1
        except Exception as exc:
            rejets += 1
            if len(erreurs) < 15:
                erreurs.append("Ligne " + str(i) + " : " + str(exc)[:160])
    cx.commit()
    cx.close()
    audit(session.get("user", "?"), "import-excel-local", source[-120:], "OK",
          str(integ) + " lignes / " + str(mises_a_jour) + " mises à jour / " + str(rejets) + " rejets")
    from .schema import evenement
    evenement("import-excel", ref_base, str(integ) + " lignes")
    return {"ok": True, "integrees": integ, "mises_a_jour": mises_a_jour,
            "rejets": rejets, "erreurs": erreurs, "reference": ref_base}


@bp.route("/api/fichiers/importer", methods=["POST"])
@perm_required("imports.write")
def importer_fichier():
    """Import réel depuis un classeur ou un CSV du poste."""
    d = request.get_json(force=True, silent=True) or {}
    mapping = d.get("mapping") or {}
    if not mapping.get("jour") or not mapping.get("produit") or not mapping.get("qte"):
        return jsonify({"message": "Le mapping doit contenir jour, produit et quantité."}), 400
    try:
        data = _chargeur(d.get("chemin"), d.get("feuille"), max_lignes=20000)
    except Exception as exc:
        return jsonify({"message": str(exc)[:300]}), 400
    resultat = inserer_lignes(data["lignes"], mapping, source="excel",
                              mode=d.get("mode", "ignorer"), periode=d.get("periode", ""))
    return jsonify(resultat)
