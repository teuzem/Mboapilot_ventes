# -*- coding: utf-8 -*-
"""Connecteurs externes et ETL inspiré de Power Query.

Un connecteur décrit une source (API REST, CSV/Excel distant, SFTP, dossier local,
PDF), ses paramètres d'authentification et une liste d'étapes de transformation.
Les étapes reprennent la logique de Power Query : sélection et renommage de
colonnes, filtres, colonnes calculées, changement de type, puis mapping vers le
schéma de ventes MboaPilot. Aucune donnée n'est inventée : une source absente
produit une erreur explicite et un journal d'exécution.
"""
import csv
import io
import json
import sqlite3
import time
from datetime import datetime
from pathlib import Path

import requests
from flask import Blueprint, jsonify, request, session

from .config import BASE, CONNECTEURS
from .core import (CHAMPS_VENTE, REGIONS, audit, db, nettoyer_texte,
                   perm_required, valider_mot_de_passe)

bp = Blueprint("etl", __name__)
DB = BASE / "sales.db"
TYPES = ("rest", "csv_url", "sftp", "dossier", "excel", "pdf")
ETAPES = ("selectColumns", "renameColumns", "filterRows", "addColumn",
          "changeType", "removeRows", "mapToSales")


def _cx():
    c = sqlite3.connect(DB, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def _auth_headers(cfg):
    headers = dict(cfg.get("headers") or {})
    auth = cfg.get("auth") or {}
    mode = auth.get("mode", "aucun")
    if mode == "api_key":
        headers[auth.get("header") or "X-API-Key"] = auth.get("cle", "")
    elif mode == "bearer":
        headers["Authorization"] = "Bearer " + auth.get("jeton", "")
    elif mode == "basic":
        import base64
        token = base64.b64encode((auth.get("utilisateur", "") + ":" + auth.get("mot_de_passe", "")).encode()).decode()
        headers["Authorization"] = "Basic " + token
    elif mode == "oauth2":
        tok = requests.post(
            auth.get("token_url", ""),
            data={"grant_type": "client_credentials",
                  "client_id": auth.get("client_id", ""),
                  "client_secret": auth.get("client_secret", ""),
                  "scope": auth.get("scope", "")},
            timeout=CONNECTEURS["reseau"],
        )
        tok.raise_for_status()
        headers["Authorization"] = "Bearer " + tok.json()["access_token"]
    return headers


def _lire_source(cfg):
    typ = cfg.get("type")
    if typ == "rest":
        url = cfg.get("url", "")
        if not url.startswith(("https://", "http://")):
            raise ValueError("URL invalide. HTTPS requis sauf en développement.")
        rep = requests.request(
            cfg.get("methode", "GET"), url,
            headers=_auth_headers(cfg), params=cfg.get("params") or {},
            json=cfg.get("corps") if cfg.get("methode") != "GET" else None,
            timeout=CONNECTEURS["reseau"],
        )
        rep.raise_for_status()
        data = rep.json()
        if isinstance(data, dict):
            chemin = (cfg.get("chemin_donnees") or "").split(".")
            for part in chemin:
                if part:
                    data = data.get(part, [])
        if not isinstance(data, list):
            raise ValueError("La réponse doit contenir une liste d'enregistrements.")
        return data
    if typ == "csv_url":
        rep = requests.get(cfg.get("url", ""), headers=_auth_headers(cfg),
                           timeout=CONNECTEURS["reseau"])
        rep.raise_for_status()
        return list(csv.DictReader(io.StringIO(rep.text), delimiter=cfg.get("separateur", ";")))
    if typ in ("dossier", "excel", "pdf"):
        dossier = Path(cfg.get("chemin", ""))
        if not dossier.is_absolute():
            dossier = BASE / dossier
        motifs = cfg.get("motifs") or ["*.csv", "*.xlsx", "*.xls"]
        if typ == "excel":
            motifs = ["*.xlsx", "*.xls"]
        if typ == "pdf":
            motifs = ["*.pdf"]
        lignes = []
        for motif in motifs:
            for f in sorted(dossier.glob(motif)):
                if f.suffix.lower() in (".csv", ".txt"):
                    txt = f.read_text(encoding=cfg.get("encodage", "utf-8-sig"), errors="replace")
                    sep = cfg.get("separateur", ";")
                    lignes += [dict(r) for r in csv.DictReader(io.StringIO(txt), delimiter=sep)]
                elif f.suffix.lower() in (".xlsx", ".xls"):
                    import openpyxl
                    wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
                    ws = wb[cfg.get("feuille") or wb.sheetnames[0]]
                    it = ws.iter_rows(values_only=True)
                    entetes = [str(x or "") for x in next(it, ())]
                    for row in it:
                        lignes.append({entetes[i]: row[i] for i in range(min(len(entetes), len(row)))})
                    wb.close()
                elif f.suffix.lower() == ".pdf":
                    from .pdf_extract import extraire_pdf
                    for tbl in extraire_pdf(f):
                        for r in tbl.get("lignes", []):
                            lignes.append(r)
        return lignes
    if typ == "sftp":
        import paramiko
        h = paramiko.SSHClient()
        h.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        h.connect(cfg.get("hote"), port=int(cfg.get("port", 22)),
                  username=cfg.get("utilisateur"), password=cfg.get("mot_de_passe"))
        sftp = h.open_sftp()
        lignes = []
        for nom in sftp.listdir(cfg.get("chemin", ".")):
            if nom.lower().endswith((".csv", ".txt")):
                with sftp.open(cfg.get("chemin", ".") + "/" + nom) as fh:
                    txt = fh.read().decode(cfg.get("encodage", "utf-8-sig"), errors="replace")
                lignes += [dict(r) for r in csv.DictReader(io.StringIO(txt), delimiter=cfg.get("separateur", ";"))]
        sftp.close()
        h.close()
        return lignes
    raise ValueError("Type de connecteur inconnu : " + str(typ))


def _evaluer_expression(expr, contexte):
    """Évaluateur restreint : noms de colonnes, nombres, chaînes et arithmétique."""
    import ast
    import operator

    banned = (ast.Attribute, ast.Subscript, ast.Call, ast.Lambda,
              ast.ListComp, ast.DictComp, ast.SetComp, ast.GeneratorExp,
              ast.Import, ast.Exec, ast.Global, ast.Nonlocal)
    try:
        arbre = ast.parse(expr, mode="eval")
    except SyntaxError:
        return None
    for n in ast.walk(arbre):
        if isinstance(n, banned):
            return None
    ops = {
        ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
        ast.Div: operator.truediv, ast.Mod: operator.mod,
    }
    cmp = {ast.Lt: operator.lt, ast.Gt: operator.gt, ast.Eq: operator.eq,
           ast.NotEq: operator.ne, ast.LtE: operator.le, ast.GtE: operator.ge}

    def val(node):
        if isinstance(node, ast.Expression):
            return val(node.body)
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            v = contexte.get(node.id, "")
            try:
                return float(v)
            except (ValueError, TypeError):
                return v
        if isinstance(node, ast.BinOp) and type(node.op) in ops:
            return ops[type(node.op)](val(node.left), val(node.right))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -val(node.operand)
        if isinstance(node, ast.Compare):
            gauche = val(node.left)
            for op, comp in zip(node.ops, node.comparators):
                if type(op) not in cmp or not cmp[type(op)](gauche, val(comp)):
                    return False
                gauche = val(comp)
            return True
        if isinstance(node, ast.BoolOp):
            valeurs = [val(v) for v in node.values]
            return all(valeurs) if isinstance(node.op, ast.And) else any(valeurs)
        raise ValueError("Expression non autorisée")

    try:
        return val(arbre)
    except Exception:
        return None


def appliquer_etapes(lignes, etapes):
    """Applique une suite d'étapes de transformation, style Power Query."""
    for etape in etapes or []:
        action = etape.get("action")
        if action not in ETAPES:
            raise ValueError("Étape inconnue : " + str(action))
        if action == "selectColumns":
            cols = etape.get("colonnes") or []
            lignes = [{k: v for k, v in r.items() if k in cols} for r in lignes]
        elif action == "renameColumns":
            mapping = etape.get("renommages") or {}
            lignes = [{mapping.get(k, k): v for k, v in r.items()} for r in lignes]
        elif action == "filterRows":
            col = etape.get("colonne")
            val = etape.get("valeur")
            op = etape.get("operateur", "egale")
            def keep(r):
                v = str(r.get(col, ""))
                if op == "egale":
                    return v == str(val)
                if op == "contient":
                    return str(val) in v
                if op == "non_vide":
                    return bool(v.strip())
                try:
                    n, m = float(v), float(val)
                    return n > m if op == "superieur" else n < m
                except Exception:
                    return False
            lignes = [r for r in lignes if keep(r)]
        elif action == "addColumn":
            nom = etape.get("nom")
            expr = etape.get("expression") or ""
            for r in lignes:
                r[nom] = _evaluer_expression(expr, r)
        elif action == "changeType":
            col = etape.get("colonne")
            typ = etape.get("type", "texte")
            for r in lignes:
                try:
                    if typ == "nombre":
                        r[col] = float(str(r.get(col, "")).replace(",", "."))
                    elif typ == "date":
                        from .core import parse_date_fr
                        r[col] = parse_date_fr(r.get(col)).isoformat()
                    elif typ == "texte":
                        r[col] = str(r.get(col, ""))
                except Exception:
                    r[col] = None
        elif action == "removeRows":
            nb = int(etape.get("nombre", 0))
            if nb > 0:
                lignes = lignes[nb:]
        elif action == "mapToSales":
            mapping = etape.get("mapping") or {}
            mapped = []
            for r in lignes:
                out = {}
                for champ, source in mapping.items():
                    if champ in CHAMPS_VENTE:
                        out[champ] = r.get(source)
                mapped.append(out)
            lignes = mapped
    return lignes


def _valider_vente(r):
    from .core import parse_date_fr, parse_nombre
    jour = parse_date_fr(r.get("jour")).isoformat()
    region = str(r.get("region") or "").strip()
    if region not in REGIONS:
        raise ValueError("Région inconnue : " + region)
    qte = parse_nombre(r.get("qte"))
    prix = parse_nombre(r.get("prix_unit"))
    if not qte or not prix or qte <= 0 or prix <= 0:
        raise ValueError("Quantité ou prix invalide.")
    canal = str(r.get("canal") or "POS").strip()
    if canal not in ("POS", "Agence", "E-commerce"):
        canal = "POS"
    remise = parse_nombre(r.get("remise_pct"), 0) or 0
    return {
        "ref": str(r.get("ref") or "").strip()[:120],
        "jour": jour, "canal": canal, "region": region,
        "ville": nettoyer_texte(r.get("ville"), 60),
        "point_vente": nettoyer_texte(r.get("point_vente"), 80),
        "vendeur": nettoyer_texte(r.get("vendeur"), 80),
        "produit": nettoyer_texte(r.get("produit"), 120),
        "famille": nettoyer_texte(r.get("famille"), 40),
        "qte": qte, "prix_unit": prix, "remise_pct": remise,
        "montant": round(qte * prix * (1 - remise / 100)),
        "devise": str(r.get("devise") or "FCFA")[:8],
        "cout_unit": parse_nombre(r.get("cout_unit")),
    }


def _inserer(lignes, source, cfg):
    c = _cx()
    t0 = time.time()
    ok, rejets, erreurs = 0, 0, []
    refs = set(x[0] for x in c.execute("SELECT ref FROM sales WHERE ref IS NOT NULL"))
    for r in lignes:
        try:
            v = _valider_vente(r)
            ref = v["ref"] or "ETL-" + source + "-" + str(int(time.time() * 1000)) + "-" + secrets_token()
            if ref in refs:
                if not cfg.get("mettre_a_jour"):
                    rejets += 1
                    continue
                c.execute("""UPDATE sales SET qte=?,prix_unit=?,remise_pct=?,montant=? WHERE ref=?""",
                          (v["qte"], v["prix_unit"], v["remise_pct"], v["montant"], ref))
            else:
                c.execute("""INSERT INTO sales(ref,jour,canal,region,ville,point_vente,vendeur,
                             produit,famille,qte,prix_unit,remise_pct,montant,cout_unit,devise,source)
                             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                          (ref, v["jour"], v["canal"], v["region"], v["ville"], v["point_vente"],
                           v["vendeur"], v["produit"], v["famille"], v["qte"], v["prix_unit"],
                           v["remise_pct"], v["montant"], v["cout_unit"], v["devise"], source))
                refs.add(ref)
            ok += 1
        except Exception as exc:
            rejets += 1
            if len(erreurs) < 20:
                erreurs.append(str(exc)[:200])
    c.commit()
    c.close()
    return ok, rejets, erreurs, int((time.time() - t0) * 1000)


def secrets_token():
    import secrets
    return secrets.token_hex(4)


def journaliser(cid, statut, lignes, rejets, message, duree):
    c = _cx()
    c.execute("""INSERT INTO connector_runs(connector_id,statut,lignes,rejets,message,duree_ms)
                 VALUES(?,?,?,?,?,?)""", (cid, statut, lignes, rejets, message[:800], duree))
    c.execute("""UPDATE connectors SET derniere_sync=datetime('now'), dernier_statut=? WHERE id=?""",
              (statut, cid))
    c.commit()
    c.close()


def executer(cid, cfg, source):
    t0 = time.time()
    try:
        brut = _lire_source(cfg)
        transforme = appliquer_etapes(brut, cfg.get("etapes") or [])
        ok, rejets, erreurs, duree = _inserer(transforme, source, cfg)
        statut = "Reussi" if not rejets else ("Partiel" if ok else "Echec")
        journaliser(cid, statut, ok, rejets, "; ".join(erreurs), duree)
        from .schema import evenement
        evenement("etl", str(cid), str(ok) + " lignes / " + str(rejets) + " rejets")
        from . import notifications
        notifications.notifier_admin(
            "Synchronisation connecteur",
            cfg.get("nom", source) + " : " + str(ok) + " lignes intégrées, " +
            str(rejets) + " rejets.",
            "etl",
        )
        return {"ok": True, "lignes": ok, "rejets": rejets, "erreurs": erreurs,
                "statut": statut, "duree_ms": duree}
    except Exception as exc:
        duree = int((time.time() - t0) * 1000)
        journaliser(cid, "Echec", 0, 0, str(exc), duree)
        audit(session.get("user", "systeme") if session else "systeme", "etl-echec", str(cid), "KO", str(exc)[:300])
        return {"ok": False, "message": str(exc)[:500], "duree_ms": duree}


# ---------- API ----------
@bp.route("/api/connecteurs")
@perm_required("imports.write")
def connecteurs_liste():
    c = _cx()
    rows = c.execute("SELECT * FROM connectors ORDER BY id DESC").fetchall()
    c.close()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["configuration"] = json.loads(d["configuration"])
        except Exception:
            pass
        out.append(d)
    return jsonify({"connecteurs": out})


@bp.route("/api/connecteurs", methods=["POST"])
@perm_required("imports.write")
def connecteurs_save():
    d = request.get_json(force=True, silent=True) or {}
    nom = nettoyer_texte(d.get("nom"), 120)
    typ = d.get("type")
    if not nom or typ not in TYPES:
        return jsonify({"message": "Nom et type valides requis."}), 400
    cfg = d.get("configuration") or {}
    if not isinstance(cfg, dict):
        return jsonify({"message": "Configuration invalide."}), 400
    cid = d.get("id")
    c = _cx()
    if cid:
        c.execute("UPDATE connectors SET nom=?,type=?,configuration=?,actif=? WHERE id=?",
                  (nom, typ, json.dumps(cfg, ensure_ascii=False), 1 if d.get("actif", True) else 0, cid))
    else:
        c.execute("INSERT INTO connectors(nom,type,configuration) VALUES(?,?,?)",
                  (nom, typ, json.dumps(cfg, ensure_ascii=False)))
        cid = c.execute("SELECT last_insert_rowid() v").fetchone()["v"]
    c.commit()
    c.close()
    audit(session["user"], "connecteur-save", str(cid), "OK", nom)
    return jsonify({"ok": True, "id": cid, "message": "Connecteur enregistré."})


@bp.route("/api/connecteurs/tester", methods=["POST"])
@perm_required("imports.write")
def connecteurs_tester():
    d = request.get_json(force=True, silent=True) or {}
    cfg = d.get("configuration") or {}
    if cfg.get("type") not in TYPES:
        return jsonify({"message": "Type de connecteur invalide."}), 400
    try:
        brut = _lire_source(cfg)
        transforme = appliquer_etapes(brut, cfg.get("etapes") or [])
        return jsonify({"ok": True, "lignes": len(transforme),
                        "apercu": transforme[:12], "colonnes": list((transforme[0] or {}).keys())[:40]})
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)[:500]}), 400


@bp.route("/api/connecteurs/<int:cid>/sync", methods=["POST"])
@perm_required("imports.write")
def connecteurs_sync(cid):
    c = _cx()
    r = c.execute("SELECT * FROM connectors WHERE id=?", (cid,)).fetchone()
    c.close()
    if not r:
        return jsonify({"message": "Connecteur introuvable."}), 404
    try:
        cfg = json.loads(r["configuration"])
    except Exception:
        return jsonify({"message": "Configuration illisible."}), 400
    resultat = executer(cid, cfg, r["nom"])
    return jsonify(resultat), (200 if resultat["ok"] else 400)


@bp.route("/api/connecteurs/<int:cid>/runs")
@perm_required("imports.read")
def connecteurs_runs(cid):
    c = _cx()
    rows = c.execute("SELECT * FROM connector_runs WHERE connector_id=? ORDER BY id DESC LIMIT 50",
                     (cid,)).fetchall()
    c.close()
    return jsonify({"runs": [dict(r) for r in rows]})


@bp.route("/api/etl/etapes")
def etapes_catalogue():
    return jsonify({"etapes": ETAPES, "types": TYPES,
                    "champs": sorted(CHAMPS_VENTE.keys())})


@bp.route("/api/pdf/extraire", methods=["POST"])
@perm_required("imports.write")
def pdf_extraire():
    """Extrait les tableaux d'un PDF pour les injection dans le studio d'import."""
    from .pdf_extract import extraire_bytes
    f = request.files.get("fichier")
    if not f or not f.filename.lower().endswith(".pdf"):
        return jsonify({"message": "Fichier PDF requis."}), 400
    data = f.read(24 * 1024 * 1024 + 1)
    if len(data) > 24 * 1024 * 1024:
        return jsonify({"message": "Fichier trop volumineux."}), 413
    try:
        tables = extraire_bytes(data)
    except Exception as exc:
        return jsonify({"message": "Extraction impossible : " + str(exc)[:300]}), 400
    return jsonify({"ok": True, "tableaux": tables,
                    "message": str(len(tables)) + " tableau(x) extrait(s)."})
