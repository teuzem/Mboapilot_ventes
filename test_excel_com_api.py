# -*- coding: utf-8 -*-
"""Recette complète de la connexion Excel COM et du glisser-déposer."""
import base64
import io
import sqlite3

from mboa import create_app
from mboa.config import BASE

FICHIER = r"C:\Users\Mr Tegou\OneDrive\Documents\ventes_agences.csv.xlsx"
DB = str(BASE / "sales.db")
ok = []


def check(nom, cond, detail=""):
    assert cond, nom + " " + str(detail)
    ok.append(nom)
    print("PASS", nom)


app = create_app()
c = app.test_client()
t = c.get("/api/auth/csrf").get_json()["csrf"]
h = {"X-CSRF-Token": t}
j = c.post("/api/auth/login", json={"login": "admin", "password": "MboaPilot-Admin-2026!"}, headers=h).get_json()
r = c.post("/api/auth/mfa-confirmer", json={"code": j["code_demo"]}, headers=h)
check("connexion", r.status_code == 200)

r = c.get("/api/excel-live/statut", headers=h)
check("statut Excel installe", r.get_json().get("installe") and r.get_json().get("version") == "16.0", r.get_json())

r = c.post("/api/excel-live/ouvrir", json={"chemin": FICHIER}, headers=h)
check("ouverture via COM", r.status_code == 200 and r.get_json().get("ok"), r.get_json())
nom = r.get_json()["nom"]

r = c.get("/api/excel-live/classeurs", headers=h)
check("liste classeurs ouverts", any(w["nom"] == nom for w in r.get_json()["classeurs"]), r.get_json())
feuille = r.get_json()["classeurs"][0]["feuilles"][0]["nom"]

r = c.get("/api/excel-live/apercu?classeur=" + nom + "&feuille=" + feuille, headers=h)
d = r.get_json()
check("apercu feuille COM", d.get("ok") and len(d.get("lignes", [])) >= 5, {k: d.get(k) for k in ("ok", "total", "plage")})
check("entetes reels", d.get("en_tetes", [])[:3] == ["ref", "jour", "canal"], d.get("en_tetes"))

mapping = {k: k for k in ("ref", "jour", "canal", "region", "ville", "point_vente",
                          "vendeur", "produit", "famille", "qte", "prix_unit",
                          "remise_pct", "montant", "devise")}
r = c.post("/api/excel-live/charger", json={"classeur": nom, "feuille": feuille,
                                            "mapping": mapping}, headers=h)
d = r.get_json()
check("chargement feuille COM", r.status_code == 200 and d.get("rejets", 0) > 0, d)

cx = sqlite3.connect(DB)
cx.execute("DELETE FROM sales WHERE source='excel-com'")
cx.commit()
cx.close()

# Glisser-déposer d'un vrai classeur généré en mémoire.
import openpyxl
wb = openpyxl.Workbook()
ws = wb.active
ws.append(["ref", "jour", "produit", "qte", "prix_unit", "region", "canal", "famille"])
ws.append(["TX-DROP-1", "2026-11-01", "Riz 25kg", 2, 1000, "Centre", "Agence", "Alimentaire"])
buf = io.BytesIO()
wb.save(buf)
buf.seek(0)
r = c.post("/api/excel-live/upload", data={"fichier": (buf, "test-drop.xlsx")},
           headers={**h, "Content-Type": "multipart/form-data"})
d = r.get_json()
check("upload glisser-deposer", r.status_code == 200 and d.get("ok") and d.get("total") == 1, d)

r = c.post("/api/fichiers/importer", json={
    "chemin": d["chemin"], "feuille": d["feuille"], "mapping": {
        "ref": "ref", "jour": "jour", "produit": "produit", "qte": "qte",
        "prix_unit": "prix_unit", "region": "region", "canal": "canal", "famille": "famille",
    }, "mode": "ignorer",
}, headers=h)
check("import apres depot", r.status_code == 200 and r.get_json().get("integrees") == 1, r.get_json())

cx = sqlite3.connect(DB)
cx.execute("DELETE FROM sales WHERE ref='TX-DROP-1'")
cx.commit()
cx.close()

print("\n%d TESTS PASS" % len(ok))
