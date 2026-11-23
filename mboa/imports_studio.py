# -*- coding: utf-8 -*-
"""Studio d'import V2 : CSV/Excel avec mapping et prévisualisation, formulaires dynamiques."""
import csv
import hashlib
import io
import json
import re
import secrets
import time
from datetime import date, datetime, timedelta

from flask import Blueprint, Response, jsonify, request

from .core import (CANAUX, CHAMPS_VENTE, FAMILLES, MAX_LIGNES_IMPORT, REGIONS,
                   TAUX_MARGE, audit, db, has_perm, login_required, norm_cle,
                   parse_date_fr, parse_nombre, perm_required, peut_ecrire_region,
                   ref_date, session)

try:
    from openpyxl import Workbook, load_workbook
    from openpyxl.styles import Font, PatternFill
except Exception:  # pragma: no cover
    Workbook = load_workbook = None

try:
    import xlrd
except Exception:  # pragma: no cover
    xlrd = None

bp = Blueprint("imports_studio", __name__)

REGION_MAP = {norm_cle(r): r for r in REGIONS}
CANAL_MAP = {"pos": "POS", "agence": "Agence", "ecommerce": "E-commerce",
             "e_commerce": "E-commerce", "online": "E-commerce", "boutique": "Agence"}
FAMILLE_MAP = {norm_cle(f): f for f in FAMILLES}
DEVISE_MAP = {"fcfa": "FCFA", "xaf": "XAF", "xof": "XOF", "cfa": "FCFA"}


# ---------- Lecture des fichiers ----------
def _decode(raw):
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(enc), enc
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace"), "utf-8"


def _detect_delim(text):
    échantillon = "\n".join([l for l in text.splitlines()[:8] if l.strip()])
    scores = {";": échantillon.count(";"), ",": échantillon.count(","),
              "\t": échantillon.count("\t"), "|": échantillon.count("|")}
    meilleur = max(scores, key=scores.get)
    return meilleur if scores[meilleur] else ";"


def _texte_cellule(v):
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def _entetes_uniques(entetes):
    out, vus = [], set()
    for i, h in enumerate(entetes):
        base = _texte_cellule(h) or f"colonne_{i + 1}"
        nom, n = base, 2
        while nom in vus:
            nom = f"{base}_{n}"
            n += 1
        out.append(nom)
        vus.add(nom)
    return out


def lire_fichier(fs, feuille=None, delimiter=None):
    if not fs or not fs.filename:
        raise ValueError("Fichier requis.")
    raw = fs.read(24 * 1024 * 1024 + 1)
    if len(raw) > 24 * 1024 * 1024:
        raise ValueError("Fichier trop volumineux (24 Mo maximum).")
    nom = (fs.filename or "").lower()
    meta = {"nom": fs.filename, "hash": hashlib.sha256(raw).hexdigest()[:16]}
    if nom.endswith(".csv") or nom.endswith(".txt"):
        text, enc = _decode(raw)
        delim = delimiter or _detect_delim(text)
        try:
            lignes = list(csv.reader(io.StringIO(text), delimiter=delim))
        except csv.Error as e:
            raise ValueError(f"CSV illisible : {e}")
        meta.update({"type": "CSV", "delimiter": delim, "encoding": enc, "feuilles": []})
    elif nom.endswith(".xlsx"):
        if load_workbook is None:
            raise ValueError("Support Excel indisponible sur ce serveur.")
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        sheets = wb.sheetnames
        cible = feuille or sheets[0]
        if cible not in sheets:
            raise ValueError(f"Feuille inconnue : {cible}. Disponibles : {', '.join(sheets)}")
        ws = wb[cible]
        lignes = [list(r) for r in ws.iter_rows(values_only=True)]
        meta.update({"type": "Excel", "feuille": cible, "feuilles": sheets,
                     "delimiter": None, "encoding": None})
    elif nom.endswith(".xls"):
        if xlrd is None:
            raise ValueError("Support Excel 97-2003 indisponible. Enregistrez le fichier en .xlsx.")
        book = xlrd.open_workbook(file_contents=raw)
        sheets = book.sheet_names()
        cible = feuille or sheets[0]
        if cible not in sheets:
            raise ValueError(f"Feuille inconnue : {cible}. Disponibles : {', '.join(sheets)}")
        ws = book.sheet_by_name(cible)
        lignes = []
        for r in range(ws.nrows):
            ligne = []
            for c in range(ws.ncols):
                cell = ws.cell(r, c)
                if cell.ctype == 3:
                    ligne.append(xlrd.xldate_as_datetime(cell.value, book.datemode).date().isoformat())
                else:
                    ligne.append(cell.value)
            lignes.append(ligne)
        meta.update({"type": "Excel", "feuille": cible, "feuilles": sheets,
                     "delimiter": None, "encoding": None})
    else:
        raise ValueError("Format non accepté. Utilisez .csv, .xlsx ou .xls.")
    lignes = [l for l in lignes if any(_texte_cellule(v) != "" for v in l)]
    if not lignes:
        raise ValueError("Fichier vide.")
    entetes = _entetes_uniques(lignes[0])
    data = []
    for l in lignes[1:]:
        d = {}
        for i, h in enumerate(entetes):
            d[h] = l[i] if i < len(l) else ""
        data.append(d)
    if len(data) > MAX_LIGNES_IMPORT:
        raise ValueError(f"Trop de lignes ({len(data)}). Limite : {MAX_LIGNES_IMPORT:,} par import.".replace(",", " "))
    meta["lignes"] = len(data)
    return entetes, data, meta


# ---------- Mapping ----------
def suggerer_mapping(entetes):
    mapping, utilises = {}, set()
    normes = [(h, norm_cle(h)) for h in entetes]
    for canon, syns in {
        "ref": ["ref", "reference", "id", "transaction", "ticket", "numero"],
        "jour": ["jour", "date", "datevente", "datedevente", "day"],
        "canal": ["canal", "channel", "circuit", "source"],
        "region": ["region", "province", "zone", "territoire"],
        "ville": ["ville", "city", "localite", "commune"],
        "point_vente": ["pointvente", "pdv", "boutique", "magasin", "site", "agence"],
        "vendeur": ["vendeur", "commercial", "seller", "agent", "caissier"],
        "produit": ["produit", "product", "article", "designation", "libelle"],
        "famille": ["famille", "categorie", "category", "rayon", "gamme"],
        "qte": ["qte", "quantite", "quantity", "qty", "nombre", "volume"],
        "prix_unit": ["prixunit", "prixunitaire", "prix", "price", "pu", "prixvente"],
        "remise_pct": ["remisepct", "remise", "discount", "reduction"],
        "montant": ["montant", "amount", "total", "ca", "chiffre"],
        "cout_unit": ["coutunit", "coutunitaire", "cout", "cost", "prixachat"],
        "devise": ["devise", "currency", "monnaie"],
    }.items():
        for h, hn in normes:
            if h in utilises:
                continue
            if hn == canon or hn in syns or any(hn.startswith(s) or s in hn for s in syns):
                mapping[canon] = h
                utilises.add(h)
                break
    return {c: mapping.get(c, "") for c in CHAMPS_VENTE}


def _valeur(raw, mapping, canon):
    h = mapping.get(canon) or ""
    return raw.get(h, "") if h else ""


def _refs_existantes(cx):
    return {r[0] for r in cx.execute("SELECT ref FROM sales").fetchall() if r[0]}


# ---------- Préparation et validation métier ----------
def preparer_ligne(raw, mapping, index, source_hash, mode="ignorer"):
    def txt(c):
        return _texte_cellule(_valeur(raw, mapping, c)).strip()

    def obligatoire(c):
        v = txt(c)
        if not v:
            raise ValueError(f"champ obligatoire manquant : {CHAMPS_VENTE[c]['label']}")
        return v

    jour_txt = obligatoire("jour")
    try:
        jour = parse_date_fr(jour_txt)
    except Exception:
        raise ValueError(f"date invalide : {jour_txt}")
    if jour > date.today():
        raise ValueError("date future interdite")

    canal_brut = obligatoire("canal")
    canal = CANAL_MAP.get(norm_cle(canal_brut))
    if not canal:
        canal = next((c for c in CANAUX if norm_cle(c) == norm_cle(canal_brut)), None)
    if not canal:
        raise ValueError(f"canal invalide : {canal_brut} (POS, Agence, E-commerce)")

    region_brut = obligatoire("region")
    region = REGION_MAP.get(norm_cle(region_brut))
    if not region:
        raise ValueError(f"région inconnue : {region_brut}")
    if not peut_ecrire_region(region):
        raise ValueError(f"hors périmètre : {region} (votre périmètre est {session.get('perimetre')})")

    famille_brut = obligatoire("famille")
    famille = FAMILLE_MAP.get(norm_cle(famille_brut))
    if not famille:
        raise ValueError(f"famille inconnue : {famille_brut}")

    try:
        qte_n = parse_nombre(obligatoire("qte"))
        if qte_n is None or abs(qte_n - round(qte_n)) > 0.001:
            raise ValueError()
        qte = int(round(qte_n))
    except Exception:
        raise ValueError(f"quantité invalide : {txt('qte')}")
    if qte <= 0 or qte > 100000:
        raise ValueError("quantité doit être comprise entre 1 et 100 000")

    try:
        prix = parse_nombre(obligatoire("prix_unit"))
    except Exception:
        raise ValueError(f"prix unitaire invalide : {txt('prix_unit')}")
    if prix is None or prix <= 0 or prix > 1_000_000_000:
        raise ValueError("prix unitaire strictement positif requis")

    try:
        remise = parse_nombre(txt("remise_pct"), 0) or 0
    except Exception:
        raise ValueError(f"remise invalide : {txt('remise_pct')}")
    if not 0 <= remise <= 50:
        raise ValueError("remise entre 0 et 50 %")

    montant_calcule = round(qte * prix * (1 - remise / 100))
    montant = montant_calcule
    if txt("montant"):
        try:
            montant_f = parse_nombre(txt("montant"))
        except Exception:
            raise ValueError(f"montant invalide : {txt('montant')}")
        tolerance = max(5, montant_calcule * 0.02)
        if abs(montant_f - montant_calcule) > tolerance:
            raise ValueError(f"montant incohérent : {montant_f:.0f} au lieu de {montant_calcule} attendu")
        montant = round(montant_f)

    cout = None
    if txt("cout_unit"):
        try:
            cout = round(parse_nombre(txt("cout_unit")))
        except Exception:
            raise ValueError(f"coût unitaire invalide : {txt('cout_unit')}")
        if cout < 0:
            raise ValueError("coût unitaire négatif")
    if cout is None:
        cout = round(montant * (1 - TAUX_MARGE.get(famille, 0.25)))

    devise = DEVISE_MAP.get(norm_cle(txt("devise") or "FCFA"), "FCFA")
    ref = txt("ref")[:120] or f"IMP-{source_hash[:8]}-{index:05d}"
    return {
        "ref": ref, "jour": jour.isoformat(), "canal": canal, "region": region,
        "ville": txt("ville")[:60] or region, "point_vente": txt("point_vente")[:80] or "Import",
        "vendeur": txt("vendeur")[:80] or session.get("nom", session.get("user", "Import")),
        "produit": obligatoire("produit")[:120], "famille": famille, "qte": qte,
        "prix_unit": prix, "remise_pct": remise, "montant": montant, "cout_unit": cout,
        "devise": devise, "ligne": index,
    }


def analyser_lignes(rows, mapping, source_hash, mode="ignorer"):
    cx = db()
    existantes = _refs_existantes(cx)
    vus = set()
    valides, doublons, rejets, maj = [], 0, 0, 0
    preview, erreurs = [], []
    for i, raw in enumerate(rows, start=2):
        try:
            d = preparer_ligne(raw, mapping, i, source_hash, mode)
        except Exception as e:
            rejets += 1
            if len(erreurs) < 100:
                erreurs.append({"ligne": i, "motif": str(e)})
            if len(preview) < 12:
                preview.append({"ligne": i, "statut": "rejete", "motif": str(e)})
            continue
        if d["ref"] in vus:
            doublons += 1
            if len(preview) < 12:
                preview.append({"ligne": i, "statut": "doublon", "motif": "référence dupliquée dans le fichier",
                                "ref": d["ref"], "region": d["region"], "montant": d["montant"]})
            continue
        vus.add(d["ref"])
        if d["ref"] in existantes:
            if mode == "mettre_a_jour":
                maj += 1
                d["_statut"] = "mise_a_jour"
                valides.append(d)
                if len(preview) < 12:
                    preview.append({"ligne": i, "statut": "mise_a_jour", "ref": d["ref"],
                                    "region": d["region"], "montant": d["montant"],
                                    "produit": d["produit"], "jour": d["jour"]})
            else:
                doublons += 1
                if len(preview) < 12:
                    preview.append({"ligne": i, "statut": "doublon", "motif": "déjà présent en base",
                                    "ref": d["ref"], "region": d["region"], "montant": d["montant"]})
            continue
        d["_statut"] = "integre"
        valides.append(d)
        if len(preview) < 12:
            preview.append({"ligne": i, "statut": "integre", "ref": d["ref"], "region": d["region"],
                            "montant": d["montant"], "produit": d["produit"], "jour": d["jour"]})
    integrables = len([v for v in valides if v["_statut"] == "integre"])
    return {
        "valides": valides,
        "resume": {"recues": len(rows), "integrables": integrables, "doublons": doublons,
                   "rejets": rejets, "mises_a_jour": maj},
        "preview": preview, "erreurs": erreurs,
    }


def _mapping_depuis_request(headers):
    brut = request.form.get("mapping") or request.form.get("mapping_json") or ""
    if not brut:
        return suggerer_mapping(headers)
    try:
        m = json.loads(brut)
    except Exception:
        raise ValueError("Mapping JSON invalide.")
    out = {}
    for c in CHAMPS_VENTE:
        h = m.get(c, "")
        if h and h not in headers:
            raise ValueError(f"Colonne mappée introuvable : {h}")
        out[c] = h
    return out


# ---------- Routes import ----------
@bp.route("/api/imports/analyser", methods=["POST"])
@perm_required("imports.write")
def api_analyser():
    try:
        fs = request.files.get("fichier")
        feuille = request.form.get("feuille") or None
        delim = request.form.get("delimiter") or None
        headers, rows, meta = lire_fichier(fs, feuille, delim)
        mapping = _mapping_depuis_request(headers)
        mode = request.form.get("mode", "ignorer")
        t0 = time.time()
        res = analyser_lignes(rows, mapping, meta["hash"], mode)
        return jsonify({"headers": headers, "mapping": mapping,
                        "suggestions": suggerer_mapping(headers), "meta": meta,
                        "resume": res["resume"], "preview": res["preview"],
                        "erreurs": res["erreurs"], "duree_ms": int((time.time() - t0) * 1000)})
    except ValueError as e:
        return jsonify({"message": str(e)}), 400
    except Exception as e:
        return jsonify({"message": f"Analyse impossible : {e}"}), 400


@bp.route("/api/imports/executer", methods=["POST"])
@perm_required("imports.write")
def api_executer():
    try:
        fs = request.files.get("fichier")
        feuille = request.form.get("feuille") or None
        delim = request.form.get("delimiter") or None
        headers, rows, meta = lire_fichier(fs, feuille, delim)
        mapping = _mapping_depuis_request(headers)
        mode = request.form.get("mode", "ignorer")
        if mode not in ("ignorer", "mettre_a_jour"):
            mode = "ignorer"
        t0 = time.time()
        cx = db()
        cur = cx.execute("""INSERT INTO imports(source,nom_fichier,jour,lignes_recues,lignes_integrees,
                            doublons,rejets,statut,user_login,type,hash_fichier,mapping,feuille,mode,details)
                            VALUES(?,?,?,?,0,0,0,'En cours',?,?,?,?,?,?,?)""",
                         (meta["type"], meta["nom"], date.today().isoformat(), len(rows),
                          session["user"], "fichier", meta["hash"],
                          json.dumps(mapping, ensure_ascii=False), feuille or meta.get("feuille"),
                          mode, json.dumps({"delimiter": delim or meta.get("delimiter"),
                                            "encoding": meta.get("encoding")}, ensure_ascii=False)))
        import_id = cur.lastrowid
        cx.commit()
        res = analyser_lignes(rows, mapping, meta["hash"], mode)
        integ = maj = 0
        rows_log = []
        for d in res["valides"]:
            if d["_statut"] == "mise_a_jour":
                cx.execute("""UPDATE sales SET jour=?,canal=?,region=?,ville=?,point_vente=?,vendeur=?,
                              produit=?,famille=?,qte=?,prix_unit=?,remise_pct=?,montant=?,cout_unit=?,
                              devise=?,source=?,import_id=?,import_created=0 WHERE ref=?""",
                           (d["jour"], d["canal"], d["region"], d["ville"], d["point_vente"], d["vendeur"],
                            d["produit"], d["famille"], d["qte"], d["prix_unit"], d["remise_pct"],
                            d["montant"], d["cout_unit"], d["devise"],
                            "excel" if meta["type"] == "Excel" else "csv", import_id, d["ref"]))
                maj += 1
                rows_log.append((import_id, d["ligne"], d["ref"], "mise_a_jour", ""))
            else:
                cx.execute("""INSERT INTO sales(ref,jour,canal,region,ville,point_vente,vendeur,produit,
                              famille,qte,prix_unit,remise_pct,montant,cout_unit,devise,source,import_id,
                              import_created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)""",
                           (d["ref"], d["jour"], d["canal"], d["region"], d["ville"], d["point_vente"],
                            d["vendeur"], d["produit"], d["famille"], d["qte"], d["prix_unit"],
                            d["remise_pct"], d["montant"], d["cout_unit"], d["devise"],
                            "excel" if meta["type"] == "Excel" else "csv", import_id))
                integ += 1
                rows_log.append((import_id, d["ligne"], d["ref"], "integre", ""))
        for e in res["erreurs"]:
            rows_log.append((import_id, e["ligne"], "", "rejete", e["motif"]))
        cx.executemany("INSERT INTO import_rows(import_id,ligne,ref,statut,motif) VALUES(?,?,?,?,?)", rows_log)
        # Les doublons ne sont pas dans erreurs : on les journalise en synthèse.
        statut = "Reussi" if res["resume"]["rejets"] == 0 else ("Partiel" if (integ + maj) else "En erreur")
        duree = int((time.time() - t0) * 1000)
        cx.execute("""UPDATE imports SET lignes_recues=?,lignes_integrees=?,doublons=?,rejets=?,
                      statut=?,duree_ms=?,mises_a_jour=? WHERE id=?""",
                   (res["resume"]["recues"], integ, res["resume"]["doublons"],
                    res["resume"]["rejets"], statut, duree, maj, import_id))
        cx.commit()
        audit(session["user"], "import-execute", f"#{import_id} {meta['nom']}", statut,
              f"{integ} intégrées, {maj} mises à jour, {res['resume']['doublons']} doublons, {res['resume']['rejets']} rejets")
        return jsonify({"ok": True, "import_id": import_id, "statut": statut, "duree_ms": duree,
                        "resume": {**res["resume"], "integrees": integ, "mises_a_jour": maj},
                        "erreurs": res["erreurs"],
                        "message": f"Import {statut} : {integ} intégrées, {maj} mises à jour, "
                                   f"{res['resume']['doublons']} doublons, {res['resume']['rejets']} rejets."})
    except ValueError as e:
        return jsonify({"message": str(e)}), 400
    except Exception as e:
        return jsonify({"message": f"Import impossible : {e}"}), 400


@bp.route("/api/imports/modele")
@login_required
def api_modele():
    fmt = (request.args.get("format") or "csv").lower()
    entetes = list(CHAMPS_VENTE.keys())
    exemple1 = {"ref": "TX-DEMO-001", "jour": date.today().isoformat(), "canal": "POS",
                "region": "Littoral", "ville": "Douala", "point_vente": "Akwa Boutique 1",
                "vendeur": "TCHOUMI S.", "produit": "Riz parfume 25kg", "famille": "Alimentaire",
                "qte": 2, "prix_unit": 14500, "remise_pct": 0, "montant": 29000,
                "cout_unit": "", "devise": "FCFA"}
    exemple2 = dict(exemple1, ref="TX-DEMO-002", canal="Agence", region="Centre",
                    ville="Yaoundé", point_vente="Mvan Agence", produit="Savon artisanal lot",
                    famille="Cosmetique", qte=5, prix_unit=1500, montant=7500)
    if fmt == "xlsx" and Workbook:
        wb = Workbook()
        ws = wb.active
        ws.title = "Ventes"
        ws.append(entetes)
        for c in ws[1]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor="635BFF")
        ws.append([exemple1.get(e, "") for e in entetes])
        ws.append([exemple2.get(e, "") for e in entetes])
        ws.freeze_panes = "A2"
        for col, width in zip("ABCDEFGHIJKLMNO", [18, 12, 12, 12, 14, 20, 18, 24, 14, 8, 14, 10, 14, 14, 10]):
            ws.column_dimensions[col].width = width
        infos = wb.create_sheet("Mode d'emploi")
        for ligne in [
            ["MboaPilot — modèle d'import des ventes"],
            ["1) Ne modifiez pas les en-têtes de la feuille « Ventes »."],
            ["2) Une ligne = une transaction. La référence (ref) doit être unique."],
            ["3) Si montant est vide, il est calculé : qte × prix_unit × (1 - remise/100)."],
            ["4) Régions : " + ", ".join(REGIONS)],
            ["5) Canaux : " + ", ".join(CANAUX)],
            ["6) Familles : " + ", ".join(FAMILLES)],
            ["7) Les dates sont au format AAAA-MM-JJ."],
            ["8) Chaque ligne hors de votre périmètre sera rejetée avec un motif."],
        ]:
            infos.append(ligne)
        infos.column_dimensions["A"].width = 110
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return Response(buf.read(), mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": "attachment; filename=mboapilot_modele_import.xlsx"})
    out = io.StringIO()
    wr = csv.writer(out, delimiter=";")
    wr.writerow(entetes)
    wr.writerow([exemple1.get(e, "") for e in entetes])
    wr.writerow([exemple2.get(e, "") for e in entetes])
    data = "\ufeff" + out.getvalue()
    return Response(data, mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=mboapilot_modele_import.csv"})


@bp.route("/api/imports")
@login_required
def api_imports_list():
    cx = db()
    role = session.get("role")
    if role in ("Admin", "Auditeur"):
        rows = cx.execute("SELECT * FROM imports ORDER BY id DESC LIMIT 60").fetchall()
    else:
        rows = cx.execute("SELECT * FROM imports WHERE user_login=? ORDER BY id DESC LIMIT 60",
                          (session["user"],)).fetchall()
    total = len(rows)
    integ = sum(r["lignes_integrees"] or 0 for r in rows)
    rejets = sum(r["rejets"] or 0 for r in rows)
    return jsonify({"imports": [dict(r) for r in rows],
                    "stats": {"total": total, "lignes_integrees": integ, "rejets": rejets,
                              "taux_reussite": round((1 - rejets / max(1, integ + rejets)) * 100, 1)}})


@bp.route("/api/imports/<int:import_id>")
@login_required
def api_import_detail(import_id):
    cx = db()
    r = cx.execute("SELECT * FROM imports WHERE id=?", (import_id,)).fetchone()
    if not r:
        return jsonify({"message": "Import introuvable."}), 404
    if session.get("role") not in ("Admin", "Auditeur") and r["user_login"] != session.get("user"):
        return jsonify({"message": "Habilitation insuffisante."}), 403
    lignes = cx.execute("SELECT * FROM import_rows WHERE import_id=? ORDER BY ligne LIMIT 1000",
                        (import_id,)).fetchall()
    return jsonify({"import": dict(r), "lignes": [dict(x) for x in lignes]})


@bp.route("/api/imports/<int:import_id>/annuler", methods=["POST"])
@perm_required("imports.cancel")
def api_import_annuler(import_id):
    cx = db()
    r = cx.execute("SELECT * FROM imports WHERE id=?", (import_id,)).fetchone()
    if not r:
        return jsonify({"message": "Import introuvable."}), 404
    if r["annule"]:
        return jsonify({"message": "Import déjà annulé."}), 400
    n = cx.execute("SELECT COUNT(*) c FROM sales WHERE import_id=? AND import_created=1",
                   (import_id,)).fetchone()["c"]
    cx.execute("DELETE FROM sales WHERE import_id=? AND import_created=1", (import_id,))
    cx.execute("UPDATE imports SET annule=1, statut='Annule' WHERE id=?", (import_id,))
    cx.commit()
    audit(session["user"], "import-annule", f"#{import_id}", "OK", f"{n} lignes supprimées")
    return jsonify({"ok": True, "lignes_supprimees": n,
                    "message": f"Import annulé. {n} lignes créées par cet import ont été supprimées "
                               "(les mises à jour de lignes existantes sont conservées)."})


# ---------- Formulaires dynamiques ----------
def _template_json(r):
    d = dict(r)
    try:
        d["champs"] = json.loads(d["champs"])
    except Exception:
        d["champs"] = []
    return d


def _valider_champs(champs):
    if not isinstance(champs, list) or not 1 <= len(champs) <= 30:
        raise ValueError("Le formulaire doit contenir entre 1 et 30 champs.")
    vus = set()
    out = []
    for c in champs:
        cle = c.get("cle")
        if cle not in CHAMPS_VENTE:
            raise ValueError(f"Champ métier inconnu : {cle}")
        if cle in vus:
            raise ValueError(f"Champ présent deux fois : {cle}")
        vus.add(cle)
        meta = CHAMPS_VENTE[cle]
        typ = c.get("type") or meta["type"]
        if typ not in ("text", "number", "date", "select", "textarea"):
            typ = meta["type"]
        options = c.get("options")
        if typ == "select":
            options = options or meta.get("options") or []
            if not options:
                raise ValueError(f"Options requises pour {cle}")
        out.append({"cle": cle, "label": (c.get("label") or meta["label"])[:80],
                    "type": typ, "requis": bool(c.get("requis", meta.get("obligatoire", False))),
                    "options": options or [], "defaut": c.get("defaut", ""),
                    "aide": (c.get("aide") or "")[:160]})
    return out


@bp.route("/api/forms")
@perm_required("forms.read")
def api_forms():
    rows = db().execute("SELECT * FROM form_templates ORDER BY id").fetchall()
    return jsonify({"formulaires": [_template_json(r) for r in rows]})


@bp.route("/api/forms", methods=["POST"])
@perm_required("forms.manage")
def api_forms_save():
    d = request.get_json(force=True, silent=True) or {}
    nom = (d.get("nom") or "").strip()[:80]
    if not nom:
        return jsonify({"message": "Nom du formulaire requis."}), 400
    try:
        champs = _valider_champs(d.get("champs") or [])
    except ValueError as e:
        return jsonify({"message": str(e)}), 400
    cx = db()
    if d.get("id"):
        r = cx.execute("SELECT id FROM form_templates WHERE id=?", (d["id"],)).fetchone()
        if not r:
            return jsonify({"message": "Formulaire introuvable."}), 404
        cx.execute("UPDATE form_templates SET nom=?,description=?,champs=?,maj_le=datetime('now') WHERE id=?",
                   (nom, (d.get("description") or "")[:500], json.dumps(champs, ensure_ascii=False), d["id"]))
        fid = d["id"]
    else:
        cur = cx.execute("INSERT INTO form_templates(nom,description,champs,created_by) VALUES(?,?,?,?)",
                         (nom, (d.get("description") or "")[:500],
                          json.dumps(champs, ensure_ascii=False), session["user"]))
        fid = cur.lastrowid
    cx.commit()
    audit(session["user"], "formulaire-enregistre", str(fid), "OK", nom)
    return jsonify({"ok": True, "id": fid, "message": "Formulaire enregistré."})


@bp.route("/api/forms/<int:fid>", methods=["DELETE"])
@perm_required("forms.manage")
def api_forms_delete(fid):
    cx = db()
    n = cx.execute("SELECT COUNT(*) c FROM form_templates").fetchone()["c"]
    if n <= 1:
        return jsonify({"message": "Impossible de supprimer le dernier formulaire."}), 400
    cx.execute("DELETE FROM form_templates WHERE id=?", (fid,))
    cx.commit()
    audit(session["user"], "formulaire-supprime", str(fid), "OK")
    return jsonify({"ok": True, "message": "Formulaire supprimé."})


@bp.route("/api/forms/<int:fid>/soumettre", methods=["POST"])
@perm_required("forms.submit")
def api_form_soumettre(fid):
    cx = db()
    t = cx.execute("SELECT * FROM form_templates WHERE id=?", (fid,)).fetchone()
    if not t:
        return jsonify({"message": "Formulaire introuvable."}), 404
    champs = json.loads(t["champs"])
    d = request.get_json(force=True, silent=True) or {}
    lignes = d.get("lignes")
    if not isinstance(lignes, list):
        lignes = [d.get("valeurs") or {}]
    if not 1 <= len(lignes) <= 200:
        return jsonify({"message": "Soumettez entre 1 et 200 lignes."}), 400
    mapping = {c: c for c in CHAMPS_VENTE}
    valides, erreurs = [], []
    for i, brute in enumerate(lignes, start=1):
        raw = {}
        for ch in champs:
            raw[ch["cle"]] = brute.get(ch["cle"], ch.get("defaut", ""))
        raw["ref"] = raw.get("ref") or f"FRM-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(3).upper()}"
        try:
            valides.append(preparer_ligne(raw, mapping, i, "form" + str(fid)))
        except Exception as e:
            erreurs.append({"ligne": i, "motif": str(e)})
    if not valides:
        return jsonify({"message": "Aucune ligne valide.", "erreurs": erreurs}), 400
    cur = cx.execute("""INSERT INTO imports(source,nom_fichier,jour,lignes_recues,lignes_integrees,
                        doublons,rejets,statut,user_login,type,mapping,details)
                        VALUES('Formulaire',?,?,?,0,0,?,'En cours',?,'formulaire',?,'{}')""",
                     (t["nom"], date.today().isoformat(), len(lignes), len(erreurs),
                      session["user"], json.dumps({c: c for c in CHAMPS_VENTE})))
    import_id = cur.lastrowid
    for v in valides:
        cx.execute("""INSERT INTO sales(ref,jour,canal,region,ville,point_vente,vendeur,produit,famille,
                      qte,prix_unit,remise_pct,montant,cout_unit,devise,source,import_id,import_created)
                      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'formulaire',?,1)""",
                   (v["ref"], v["jour"], v["canal"], v["region"], v["ville"], v["point_vente"],
                    v["vendeur"], v["produit"], v["famille"], v["qte"], v["prix_unit"],
                    v["remise_pct"], v["montant"], v["cout_unit"], v["devise"], import_id))
    cx.executemany("INSERT INTO import_rows(import_id,ligne,ref,statut,motif) VALUES(?,?,?,?,?)",
                   [(import_id, v["ligne"], v["ref"], "integre", "") for v in valides]
                   + [(import_id, e["ligne"], "", "rejete", e["motif"]) for e in erreurs])
    statut = "Reussi" if not erreurs else "Partiel"
    cx.execute("UPDATE imports SET lignes_integrees=?,statut=? WHERE id=?",
               (len(valides), statut, import_id))
    cx.execute("INSERT INTO form_submissions(template_id,login,import_id,lignes) VALUES(?,?,?,?)",
               (fid, session["user"], import_id, len(valides)))
    cx.commit()
    audit(session["user"], "formulaire-soumis", f"#{import_id} {t['nom']}", statut,
          f"{len(valides)} lignes, {len(erreurs)} rejets")
    return jsonify({"ok": True, "import_id": import_id, "statut": statut,
                    "resume": {"recues": len(lignes), "integrees": len(valides), "rejets": len(erreurs)},
                    "erreurs": erreurs,
                    "message": f"Formulaire traité : {len(valides)} ligne(s) enregistrée(s), {len(erreurs)} rejet(s)."})
