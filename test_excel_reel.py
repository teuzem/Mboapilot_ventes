# -*- coding: utf-8 -*-
"""Recette de bout en bout : connexion au classeur Excel réel de l'utilisateur."""
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

r = c.post("/api/auth/login", json={"login": "admin", "password": "MboaPilot-Admin-2026!"}, headers=h)
j = r.get_json()
r = c.post("/api/auth/mfa-confirmer", json={"code": j["code_demo"]}, headers=h)
check("session admin", r.status_code == 200)

check("racines autorisees", c.get("/api/fichiers/racines", headers=h).status_code == 200)
r = c.get("/api/fichiers/lister?chemin=C:/Users/Mr Tegou/OneDrive/Documents", headers=h)
check("listing OneDrive Documents", r.status_code == 200 and any(f["nom"] == "ventes_agences.csv.xlsx" for f in r.get_json().get("fichiers", [])), r.get_json())
r = c.get("/api/fichiers/feuilles", query_string={"chemin": FICHIER}, headers=h)
check("feuilles du classeur", r.status_code == 200 and "ventes_agences" in r.get_json().get("feuilles", []), r.get_json())
r = c.get("/api/fichiers/apercu", query_string={"chemin": FICHIER, "feuille": "ventes_agences"}, headers=h)
check("apercu reelles donnees", r.status_code == 200 and len(r.get_json().get("lignes", [])) > 5, r.get_json())
d = r.get_json()
check("colonnes reelles", "ref" in d["en_tetes"] and "prix_unit" in d["en_tetes"], d["en_tetes"])

# Import réel d'un extrait dans une plage de dates précise.
mapping = {
    "ref": "ref", "jour": "jour", "canal": "canal", "region": "region",
    "ville": "ville", "point_vente": "point_vente", "vendeur": "vendeur",
    "produit": "produit", "famille": "famille", "qte": "qte",
    "prix_unit": "prix_unit", "remise_pct": "remise_pct", "devise": "devise",
}
r = c.post("/api/fichiers/importer", json={
    "chemin": FICHIER, "feuille": "ventes_agences", "mapping": mapping,
    "periode": ["2024-10-01", "2024-10-01"], "mode": "mettre_a_jour",
}, headers=h)
check("import Excel reussi", r.status_code == 200 and r.get_json().get("mises_a_jour", 0) > 0, r.get_json())
check("dedupfonctionnelle", r.get_json().get("integrees", 0) == 0, r.get_json())

cx = sqlite3.connect(DB)
n = cx.execute("SELECT COUNT(*) FROM sales WHERE ref LIKE 'TX-20241001-%'").fetchone()[0]
cx.close()
check("lignes mises a jour presentes", n > 0, n)

print("\n%d TESTS PASS" % len(ok))
