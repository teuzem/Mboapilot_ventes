# -*- coding: utf-8 -*-
"""Tableau de bord V2 : KPI, séries, répartitions, alertes, live (SSE), vitrine publique."""
import json
import time
from datetime import date, datetime, timedelta

from flask import Blueprint, Response, jsonify, request, stream_with_context

from .core import (DB, audit, db, filtre_perimetre, login_required, perms,
                   ref_date, session)

bp = Blueprint("dashboard", __name__)
MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août",
        "sept.", "oct.", "nov.", "déc."]


def _f(v):
    return f"{round(v or 0):,}".replace(",", " ")


def _shift(d, annees=1):
    try:
        return d.replace(year=d.year - annees)
    except ValueError:
        return d.replace(year=d.year - annees, day=28)


def _clause_base():
    f, p = [], []
    for champ, col in (("region", "region"), ("canal", "canal"), ("famille", "famille"),
                       ("vendeur", "vendeur"), ("produit", "produit")):
        v = request.args.get(champ, "")
        if v:
            f.append(f"{col} = ?")
            p.append(v)
    clause, pp = filtre_perimetre()
    if clause:
        f.append("region = ?")
        p += pp
    return (" AND " + " AND ".join(f) if f else ""), p


def _where_filtres(decalage_annee=0):
    """Filtres + fenêtre temporelle ancrée sur la dernière date de données (démo fiable)."""
    ref = ref_date()
    f, p = [], []
    a_periode = False
    debut = fin = None
    du, au = request.args.get("du", ""), request.args.get("au", "")
    if du or au:
        try:
            debut = date.fromisoformat(du) if du else date(ref.year, 1, 1)
            fin = date.fromisoformat(au) if au else ref
            if debut > fin:
                debut, fin = fin, debut
            if decalage_annee:
                debut, fin = _shift(debut, decalage_annee), _shift(fin, decalage_annee)
            f.append("jour >= ? AND jour <= ?")
            p += [debut.isoformat(), fin.isoformat()]
            a_periode = True
        except Exception:
            debut = fin = None
    else:
        per = request.args.get("periode", "")
        if per:
            try:
                n = max(1, min(3650, int(per)))
                fin = ref
                debut = ref - timedelta(days=n)
                if decalage_annee:
                    debut, fin = _shift(debut, decalage_annee), _shift(fin, decalage_annee)
                f.append("jour >= ? AND jour <= ?")
                p += [debut.isoformat(), fin.isoformat()]
                a_periode = True
            except ValueError:
                pass
    base, bp = _clause_base()
    clause = (" AND " + " AND ".join(f) if f else "") + base
    return clause, p + bp, a_periode, {"debut": debut.isoformat() if debut else None,
                                       "fin": fin.isoformat() if fin else None,
                                       "ref": ref.isoformat()}


def _kpi_base(w, p):
    return db().execute(
        f"""SELECT COALESCE(SUM(montant),0) ca, COUNT(*) nb, COALESCE(SUM(qte),0) q,
            COALESCE(SUM(montant - COALESCE(cout_unit, montant*0.75)),0) mg,
            COUNT(DISTINCT jour) jours FROM sales WHERE 1=1{w}""", p).fetchone()


def _kpis_payload():
    w, p, a_periode, meta = _where_filtres()
    r = _kpi_base(w, p)
    ca, nb, q, mg = r["ca"], r["nb"], r["q"], r["mg"]
    out = {"ca": ca, "nb": nb, "panier": round(ca / nb) if nb else 0,
           "qte": q, "marge": round(mg), "tauxMarge": round(mg / ca * 100, 1) if ca else None,
           "jours": r["jours"], "caJour": round(ca / r["jours"]) if r["jours"] else 0,
           "objectif": None, "var_obj": None, "ca_n1": None, "var_n1": None,
           "panier_n1": None, "marge_n1": None, "var_marge": None, "periode": meta}
    if a_periode:
        w1, p1, _, meta1 = _where_filtres(1)
        r1 = _kpi_base(w1, p1)
        ca1, nb1, mg1 = r1["ca"], r1["nb"], r1["mg"]
        obj = round(ca1 * 1.10)
        out.update({
            "objectif": obj, "ca_n1": ca1,
            "var_obj": round((ca - obj) / obj * 100, 1) if obj else None,
            "var_n1": round((ca - ca1) / ca1 * 100, 1) if ca1 else None,
            "panier_n1": round(ca1 / nb1) if nb1 else None,
            "marge_n1": round(mg1),
            "var_marge": round((mg - mg1) / mg1 * 100, 1) if mg1 else None,
            "periode_n1": meta1,
        })
    return out


def _serie_payload():
    w, p, a_periode, _ = _where_filtres()
    rows = db().execute(
        f"SELECT jour, SUM(montant) ca, COUNT(*) nb FROM sales WHERE 1=1{w} GROUP BY jour ORDER BY jour",
        p).fetchall()
    data = [{"jour": r["jour"], "ca": r["ca"], "nb": r["nb"]} for r in rows]
    cible, n1data = 0, []
    if a_periode and data:
        w1, p1, _, _ = _where_filtres(1)
        n1rows = db().execute(
            f"SELECT jour, SUM(montant) ca FROM sales WHERE 1=1{w1} GROUP BY jour ORDER BY jour",
            p1).fetchall()
        n1data = [{"jour": r["jour"], "ca": r["ca"]} for r in n1rows]
        if n1rows:
            cible = round(sum(r["ca"] for r in n1rows) * 1.10 / len(data))
    return {"points": data, "cible_jour": cible, "n1": n1data}


def _repartitions_payload():
    w, p, _, _ = _where_filtres()
    w1, p1, _, _ = _where_filtres(1)
    cx = db()
    reg = cx.execute(f"SELECT region, SUM(montant) ca, COUNT(*) nb FROM sales WHERE 1=1{w} GROUP BY region ORDER BY ca DESC", p).fetchall()
    can = cx.execute(f"SELECT canal, SUM(montant) ca FROM sales WHERE 1=1{w} GROUP BY canal", p).fetchall()
    fam = cx.execute(f"""SELECT famille, SUM(montant) ca,
                         SUM(montant - COALESCE(cout_unit, montant*0.75)) mg
                         FROM sales WHERE 1=1{w} GROUP BY famille ORDER BY ca DESC""", p).fetchall()
    top = cx.execute(f"SELECT produit, SUM(montant) ca, SUM(qte) q FROM sales WHERE 1=1{w} GROUP BY produit ORDER BY ca DESC LIMIT 8", p).fetchall()
    vend = cx.execute(f"SELECT vendeur, SUM(montant) ca, COUNT(*) nb FROM sales WHERE 1=1{w} GROUP BY vendeur ORDER BY ca DESC LIMIT 10", p).fetchall()

    reg_out = []
    for x in reg:
        n1 = cx.execute(f"SELECT COALESCE(SUM(montant),0) s FROM sales WHERE 1=1{w1} AND region=?",
                        p1 + [x["region"]]).fetchone()["s"] or 0
        obj = round(n1 * 1.10)
        reg_out.append({"region": x["region"], "ca": x["ca"], "nb": x["nb"], "n1": n1,
                        "obj": obj, "pct": round(x["ca"] / obj * 100) if obj else None,
                        "var": round((x["ca"] - n1) / n1 * 100, 1) if n1 else None})
    fam_out = []
    for x in fam:
        n1 = cx.execute(f"SELECT COALESCE(SUM(montant),0) s FROM sales WHERE 1=1{w1} AND famille=?",
                        p1 + [x["famille"]]).fetchone()["s"] or 0
        fam_out.append({"famille": x["famille"], "ca": x["ca"], "mg": x["mg"], "n1": n1,
                        "var": round((x["ca"] - n1) / n1 * 100, 1) if n1 else None,
                        "taux": round(x["mg"] / x["ca"] * 100, 1) if x["ca"] else None})
    vend_out = []
    for v in vend:
        n1 = cx.execute(f"SELECT COALESCE(SUM(montant),0) s FROM sales WHERE 1=1{w1} AND vendeur=?",
                        p1 + [v["vendeur"]]).fetchone()["s"] or 0
        obj = round(n1 * 1.10)
        vend_out.append({"vendeur": v["vendeur"], "ca": v["ca"], "nb": v["nb"], "obj": obj,
                         "pct": round(v["ca"] / obj * 100) if obj else None})
    J = lambda rows, *k: [{kk: r[kk] for kk in k} for r in rows]
    return {"regions": reg_out, "canaux": J(can, "canal", "ca"), "familles": fam_out,
            "top": J(top, "produit", "ca", "q"), "vendeurs": vend_out}


def _mensuel_payload():
    base, params = _clause_base()
    ref = ref_date()
    out = []
    for i in range(11, -1, -1):
        y, m = ref.year, ref.month - i
        while m <= 0:
            m += 12
            y -= 1
        deb = date(y, m, 1)
        fin = date(y + 1, 1, 1) - timedelta(days=1) if m == 12 else date(y, m + 1, 1) - timedelta(days=1)
        r = db().execute(f"""SELECT COALESCE(SUM(montant),0) ca,
                             COALESCE(SUM(montant - COALESCE(cout_unit, montant*0.75)),0) mg
                             FROM sales WHERE jour >= ? AND jour <= ?{base}""",
                         [deb.isoformat(), fin.isoformat()] + params).fetchone()
        deb1 = _shift(deb)
        fin1 = _shift(fin)
        r1 = db().execute(f"SELECT COALESCE(SUM(montant),0) ca FROM sales WHERE jour >= ? AND jour <= ?{base}",
                          [deb1.isoformat(), fin1.isoformat()] + params).fetchone()
        out.append({"mois": f"{MOIS[m - 1]} {str(y)[2:]}", "n": r["ca"], "marge": round(r["mg"]),
                    "n1": r1["ca"], "annee": y, "num_mois": m})
    return out


def _recit_payload(k=None, rep=None):
    k = k or _kpis_payload()
    rep = rep or _repartitions_payload()
    recit = []
    if rep.get("regions"):
        r0 = rep["regions"][0]
        part = round(r0["ca"] / k["ca"] * 100, 1) if k["ca"] else 0
        txt = f"{_f(r0['ca'])} FCFA ({part} % du total)"
        if r0.get("var") is not None:
            txt += f", {'+' if r0['var'] >= 0 else ''}{r0['var']} % vs N-1."
        recit.append({"niveau": "succes" if (r0.get("var") or 0) >= 0 else "alerte",
                      "titre": f"{r0['region']} porte la période", "texte": txt})
    fams = [x for x in rep.get("familles", []) if x.get("var") is not None]
    if fams:
        bas = min(fams, key=lambda x: x["var"])
        haut = max(fams, key=lambda x: x["var"])
        if bas["var"] < 0:
            recit.append({"niveau": "alerte", "titre": f"Vigilance : {bas['famille']}",
                          "texte": f"{_f(bas['ca'])} FCFA, {bas['var']} % vs N-1. À passer en revue cette semaine."})
        else:
            recit.append({"niveau": "succes", "titre": f"Toutes les familles progressent",
                          "texte": f"Même la plus modérée, {bas['famille']}, avance de {bas['var']} %."})
        if haut["var"] > 0:
            recit.append({"niveau": "info", "titre": f"Locomotive : {haut['famille']}",
                          "texte": f"{_f(haut['ca'])} FCFA, {'+' if haut['var'] >= 0 else ''}{haut['var']} % vs N-1. Sécuriser le réassort."})
    sous = [r for r in rep.get("regions", []) if r.get("pct") is not None and r["pct"] < 90]
    if sous:
        recit.append({"niveau": "alerte", "titre": "Sous le seuil d'alerte (90 %)",
                      "texte": "En risque : " + ", ".join(f"{r['region']} ({r['pct']} %)" for r in sous[:4]) + "."})
    if k.get("panier_n1"):
        var = round((k["panier"] - k["panier_n1"]) / k["panier_n1"] * 100, 1)
        recit.append({"niveau": "info", "titre": f"Panier moyen : {_f(k['panier'])} FCFA",
                      "texte": f"Il {'progresse' if var >= 0 else 'recule'} de {var} % vs N-1 ({_f(k['panier_n1'])} FCFA)."})
    return recit[:5]


def _alertes(payload_k, payload_rep):
    out = []
    sous = [r for r in payload_rep.get("regions", []) if r.get("pct") is not None and r["pct"] < 90]
    if sous:
        out.append({"niveau": "critique", "titre": f"{len(sous)} région(s) sous 90 % de l'objectif",
                    "texte": ", ".join(f"{r['region']} ({r['pct']} %)" for r in sous[:4]),
                    "lien": "/app?region=" + sous[0]["region"]})
    baisse = [f for f in payload_rep.get("familles", []) if f.get("var") is not None and f["var"] < -5]
    if baisse:
        out.append({"niveau": "alerte", "titre": "Familles en recul",
                    "texte": ", ".join(f"{f['famille']} ({f['var']} %)" for f in baisse[:3]),
                    "lien": "/app?famille=" + baisse[0]["famille"]})
    if payload_k.get("tauxMarge") is not None and payload_k["tauxMarge"] < 15:
        out.append({"niveau": "alerte", "titre": "Marge sous surveillance",
                    "texte": f"Taux de marge à {payload_k['tauxMarge']} % sur la période filtrée.",
                    "lien": "/app"})
    try:
        role = session.get("role")
        cx = db()
        if role in ("Admin", "Auditeur"):
            imp = cx.execute("SELECT * FROM imports WHERE rejets > 0 AND annule=0 ORDER BY id DESC LIMIT 1").fetchone()
        else:
            imp = cx.execute("SELECT * FROM imports WHERE rejets > 0 AND annule=0 AND user_login=? ORDER BY id DESC LIMIT 1",
                             (session.get("user"),)).fetchone()
        if imp:
            out.append({"niveau": "info", "titre": f"Import #{imp['id']} avec rejets",
                        "texte": f"{imp['rejets']} ligne(s) rejetée(s) sur {imp['lignes_recues']}. Consultez le détail.",
                        "lien": "/app/imports"})
    except Exception:
        pass
    try:
        base, params = _clause_base()
        ref = ref_date()
        seuil = (ref - timedelta(days=14)).isoformat()
        silencieux = db().execute(
            f"SELECT COUNT(*) c FROM (SELECT point_vente, MAX(jour) mj FROM sales WHERE 1=1{base} GROUP BY point_vente) WHERE mj < ?",
            params + [seuil]).fetchone()["c"]
        if silencieux:
            out.append({"niveau": "info", "titre": f"{silencieux} point(s) de vente silencieux",
                        "texte": f"Aucune écriture depuis 14 jours (référence {ref.strftime('%d/%m/%Y')}).",
                        "lien": "/app/imports"})
    except Exception:
        pass
    if not out:
        out.append({"niveau": "succes", "titre": "Aucune alerte critique",
                    "texte": "Les seuils d'objectif, de marge et de fraîcheur des données sont respectés.",
                    "lien": "/app"})
    return out[:5]


def _recentes_payload(limite=10):
    base, params = _clause_base()
    rows = db().execute(
        f"""SELECT ref,jour,canal,region,ville,produit,famille,qte,montant,vendeur,source,created_at
            FROM sales WHERE 1=1{base} ORDER BY jour DESC, id DESC LIMIT ?""",
        params + [limite]).fetchall()
    return [dict(r) for r in rows]


def _imports_recents(limite=5):
    cx = db()
    if session.get("role") in ("Admin", "Auditeur"):
        rows = cx.execute("SELECT * FROM imports ORDER BY id DESC LIMIT ?", (limite,)).fetchall()
    else:
        rows = cx.execute("SELECT * FROM imports WHERE user_login=? ORDER BY id DESC LIMIT ?",
                          (session.get("user"), limite)).fetchall()
    return [dict(r) for r in rows]


# ---------- Endpoints protégés ----------
@bp.route("/api/kpis")
@login_required
def api_kpis():
    return jsonify(_kpis_payload())


@bp.route("/api/serie")
@login_required
def api_serie():
    return jsonify(_serie_payload())


@bp.route("/api/repartitions")
@login_required
def api_rep():
    return jsonify(_repartitions_payload())


@bp.route("/api/mensuel")
@login_required
def api_mensuel():
    return jsonify(_mensuel_payload())


@bp.route("/api/filtres")
@login_required
def api_filtres():
    cx = db()
    clause, p = filtre_perimetre()
    q = lambda col: [r[0] for r in cx.execute(
        f"SELECT DISTINCT {col} FROM sales WHERE 1=1{clause} AND {col} IS NOT NULL ORDER BY {col}", p).fetchall()]
    prods = [{"produit": r["produit"], "famille": r["famille"], "prix": r["prix"]}
             for r in cx.execute("""SELECT produit, famille, AVG(prix_unit) prix
                                    FROM sales GROUP BY produit ORDER BY produit""").fetchall()]
    return jsonify({"regions": q("region"), "canaux": q("canal"), "familles": q("famille"),
                    "vendeurs": q("vendeur"), "produits": prods})


@bp.route("/api/recit")
@login_required
def api_recit():
    return jsonify(_recit_payload())


@bp.route("/api/dashboard")
@login_required
def api_dashboard():
    w, p, _, meta = _where_filtres()
    k = _kpis_payload()
    rep = _repartitions_payload()
    ref = ref_date()
    role, perim = session.get("role"), session.get("perimetre")
    where_live, params_live = "", []
    if role not in ("Admin", "Auditeur") and perim != "National":
        where_live, params_live = " AND region=?", [perim]
    ca_jour = db().execute(
        f"SELECT COALESCE(SUM(montant),0) s, COUNT(*) n FROM sales WHERE jour=?{where_live}",
        [ref.isoformat()] + params_live).fetchone()
    return jsonify({
        "kpis": k, "serie": _serie_payload(), "repartitions": rep,
        "mensuel": _mensuel_payload(), "recit": _recit_payload(k, rep),
        "alertes": _alertes(k, rep), "recentes": _recentes_payload(12),
        "imports": _imports_recents(5), "filtres": meta,
        "live": {"caJour": ca_jour["s"], "nbJour": ca_jour["n"],
                 "reference": ref.isoformat(),
                 "maj": datetime.now().strftime("%H:%M:%S")},
        "permissions": perms(session.get("role")),
        "maj": datetime.now().strftime("%H:%M:%S"),
    })


@bp.route("/api/ventes/recentes")
@login_required
def api_recentes():
    return jsonify({"ventes": _recentes_payload(min(100, int(request.args.get("limite", 20))))})


@bp.route("/api/live")
@login_required
def api_live():
    role, perim = session.get("role"), session.get("perimetre")
    where, params = "", []
    if role not in ("Admin", "Auditeur") and perim != "National":
        where, params = " AND region=?", [perim]
    cx = db()
    ref = ref_date(cx)
    r = cx.execute(f"SELECT COALESCE(SUM(montant),0) ca, COUNT(*) n FROM sales WHERE jour=?{where}",
                   [ref.isoformat()] + params).fetchone()
    recentes = cx.execute(
        f"""SELECT ref,jour,canal,region,produit,montant,vendeur,source,created_at FROM sales
            WHERE 1=1{where} ORDER BY jour DESC, id DESC LIMIT 8""", params).fetchall()
    total = cx.execute(f"SELECT COUNT(*) c FROM sales WHERE 1=1{where}", params).fetchone()["c"]
    return jsonify({"caJour": r["ca"], "nbJour": r["n"], "reference": ref.isoformat(),
                    "recentes": [dict(x) for x in recentes], "total": total,
                    "maj": datetime.now().strftime("%H:%M:%S")})


def _live_direct(role, perim):
    import sqlite3
    cx = sqlite3.connect(DB, timeout=10)
    cx.row_factory = sqlite3.Row
    try:
        where, params = "", []
        if role not in ("Admin", "Auditeur") and perim != "National":
            where, params = " AND region=?", [perim]
        ref = cx.execute("SELECT MAX(jour) m FROM sales").fetchone()["m"]
        ref = ref or date.today().isoformat()
        r = cx.execute(f"SELECT COALESCE(SUM(montant),0) ca, COUNT(*) n FROM sales WHERE jour=?{where}",
                       [ref] + params).fetchone()
        n1 = cx.execute(f"SELECT COALESCE(SUM(montant),0) ca FROM sales WHERE jour=date(?, '-1 year'){where}",
                        [ref] + params).fetchone()["ca"]
        recentes = cx.execute(
            f"""SELECT ref,jour,canal,region,produit,montant,vendeur,source,created_at FROM sales
                WHERE 1=1{where} ORDER BY jour DESC, id DESC LIMIT 8""", params).fetchall()
        total = cx.execute(f"SELECT COUNT(*) c FROM sales WHERE 1=1{where}", params).fetchone()["c"]
        return {"caJour": r["ca"], "nbJour": r["n"], "objectifJour": round(n1 * 1.10),
                "reference": ref, "recentes": [dict(x) for x in recentes], "total": total,
                "maj": datetime.now().strftime("%H:%M:%S")}
    finally:
        cx.close()


@bp.route("/api/live/stream")
@login_required
def api_live_stream():
    role, perim = session.get("role"), session.get("perimetre")

    def generateur():
        for _ in range(60):
            try:
                data = _live_direct(role, perim)
                yield "data: " + json.dumps(data, ensure_ascii=False) + "\n\n"
            except Exception:
                yield "event: error\ndata: {}\n\n"
            time.sleep(6)
        yield "event: end\ndata: {}\n\n"

    return Response(stream_with_context(generateur()), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                             "Connection": "keep-alive"})


# ---------- Vitrine publique ----------
@bp.route("/api/vitrine/stats")
def api_vitrine_stats():
    cx = db()
    ref = ref_date(cx)
    debut = (ref - timedelta(days=30)).isoformat()
    fin = ref.isoformat()
    debut1 = (_shift(ref - timedelta(days=30))).isoformat()
    fin1 = _shift(ref).isoformat()
    nb = cx.execute("SELECT COUNT(*) c FROM sales").fetchone()["c"]
    ca = cx.execute("SELECT COALESCE(SUM(montant),0) s FROM sales").fetchone()["s"] or 0
    m30 = cx.execute("""SELECT COALESCE(SUM(montant),0) s, COUNT(*) n,
                        COALESCE(SUM(montant - COALESCE(cout_unit, montant*0.75)),0) mg
                        FROM sales WHERE jour >= ? AND jour <= ?""", (debut, fin)).fetchone()
    old = cx.execute("SELECT COALESCE(SUM(montant),0) s, COUNT(*) n FROM sales WHERE jour >= ? AND jour <= ?",
                     (debut1, fin1)).fetchone()
    serie = [{"jour": r["jour"], "ca": r["ca"]} for r in cx.execute(
        "SELECT jour, SUM(montant) ca FROM sales WHERE jour >= ? AND jour <= ? GROUP BY jour ORDER BY jour",
        (debut, fin)).fetchall()]
    serie_n1 = [{"jour": r["jour"], "ca": r["ca"]} for r in cx.execute(
        "SELECT jour, SUM(montant) ca FROM sales WHERE jour >= ? AND jour <= ? GROUP BY jour ORDER BY jour",
        (debut1, fin1)).fetchall()]
    regs = [{"region": r["region"], "ca": r["ca"]} for r in cx.execute(
        "SELECT region, SUM(montant) ca FROM sales WHERE jour >= ? AND jour <= ? GROUP BY region ORDER BY ca DESC LIMIT 5",
        (debut, fin)).fetchall()]
    canaux = [{"canal": r["canal"], "ca": r["ca"]} for r in cx.execute(
        "SELECT canal, SUM(montant) ca FROM sales WHERE jour >= ? AND jour <= ? GROUP BY canal",
        (debut, fin)).fetchall()]
    sites = cx.execute("""SELECT COUNT(DISTINCT region) regions, COUNT(DISTINCT point_vente) pdv,
                          COUNT(DISTINCT canal) canaux, COUNT(DISTINCT produit) produits FROM sales""").fetchone()
    obj = (old["s"] or 0) * 1.10
    taux_mg = round(m30["mg"] / m30["s"] * 100, 1) if m30["s"] else None
    partenaires = cx.execute("SELECT COUNT(*) c FROM partners WHERE statut='valide'").fetchone()["c"]
    recentes = cx.execute("""SELECT region,canal,produit,montant,created_at,jour FROM sales
                             ORDER BY jour DESC, id DESC LIMIT 6""").fetchall()
    return jsonify({
        "nb": nb, "caM": round(ca / 1e6), "regions": sites["regions"],
        "sites": {"regions": sites["regions"], "pdv": sites["pdv"], "canaux": sites["canaux"],
                  "produits": sites["produits"]},
        "kpis": {"ca30": m30["s"], "nb30": m30["n"],
                 "panier": round(m30["s"] / m30["n"]) if m30["n"] else 0,
                 "marge30": round(m30["mg"]), "tauxMarge": taux_mg,
                 "var30": round((m30["s"] - old["s"]) / old["s"] * 100, 1) if old["s"] else None,
                 "varNb": round((m30["n"] - old["n"]) / old["n"] * 100, 1) if old["n"] else None,
                 "objPct": round(m30["s"] / obj * 100) if obj else None,
                 "obj30": round(obj)},
        "serie30": serie, "serieN1": serie_n1, "topRegions": regs, "canaux": canaux,
        "partenaires": partenaires, "ref_date": ref.isoformat(),
        "maj": datetime.now().strftime("%H:%M:%S"),
        "derniers": [{"region": r["region"], "canal": r["canal"], "produit": r["produit"],
                      "montant": r["montant"], "jour": r["jour"]} for r in recentes],
    })


@bp.route("/api/vitrine/live")
def api_vitrine_live():
    cx = db()
    ref = ref_date(cx)
    r = cx.execute("SELECT COALESCE(SUM(montant),0) ca, COUNT(*) n FROM sales WHERE jour=?",
                   (ref.isoformat(),)).fetchone()
    n1 = cx.execute("SELECT COALESCE(SUM(montant),0) ca FROM sales WHERE jour=date(?, '-1 year')",
                    (ref.isoformat(),)).fetchone()["ca"]
    recentes = cx.execute("""SELECT region,canal,produit,montant,jour,created_at FROM sales
                             ORDER BY jour DESC, id DESC LIMIT 8""").fetchall()
    serie = [{"jour": x["jour"], "ca": x["ca"]} for x in cx.execute(
        "SELECT jour, SUM(montant) ca FROM sales WHERE jour <= ? GROUP BY jour ORDER BY jour DESC LIMIT 14",
        (ref.isoformat(),)).fetchall()][::-1]
    total = cx.execute("SELECT COUNT(*) c FROM sales").fetchone()["c"]
    partenaires = cx.execute("SELECT COUNT(*) c FROM partners WHERE statut='valide'").fetchone()["c"]
    return jsonify({"caJour": r["ca"], "nbJour": r["n"], "objectifJour": round(n1 * 1.10),
                    "partenaires": partenaires, "total": total, "serie": serie,
                    "recentes": [{"region": x["region"], "canal": x["canal"], "produit": x["produit"],
                                  "montant": x["montant"], "jour": x["jour"],
                                  "created_at": x["created_at"]} for x in recentes],
                    "reference": ref.isoformat(), "maj": datetime.now().strftime("%H:%M:%S")})
