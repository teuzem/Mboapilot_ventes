# -*- coding: utf-8 -*-
"""Recette des actions de connexion, deconnexion et ouverture de classeur Excel."""
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
_cx = sqlite3.connect(DB)
_cx.execute("UPDATE users SET mfa_last_step=-1 WHERE login='admin'")
_cx.commit()
_cx.close()
r = c.post("/api/auth/mfa-confirmer", json={"code": j["code_demo"]}, headers=h)
check("session", r.status_code == 200)

r = c.post("/api/excel-live/fermer", headers=h)
check("deconnexion initiale", r.status_code == 200)
r = c.get("/api/excel-live/statut", headers=h)
check("statut non connecte", r.get_json()["connecte"] is False, r.get_json())

r = c.post("/api/excel-live/connecter", headers=h)
check("ouverture visible d'Excel", r.status_code == 200 and r.get_json()["ok"], r.get_json())
r = c.get("/api/excel-live/statut", headers=h)
check("statut connecte", r.get_json()["connecte"] is True, r.get_json())

r = c.get("/api/excel-live/classeurs", headers=h)
check("listing des classeurs actifs", isinstance(r.get_json()["classeurs"], list))

r = c.post("/api/excel-live/ouvrir", json={"chemin": FICHIER}, headers=h)
check("ouverture d'un classeur", r.status_code == 200 and r.get_json()["ok"], r.get_json())
nom = r.get_json()["nom"]

r = c.get("/api/excel-live/classeurs", headers=h)
check("classeur present dans la liste", any(w["nom"] == nom for w in r.get_json()["classeurs"]))

r = c.get("/api/excel-live/apercu?classeur=" + nom + "&feuille=" + r.get_json()["classeurs"][0]["feuilles"][0]["nom"], headers=h)
check("apercu via la liste", r.get_json().get("ok") and len(r.get_json().get("en_tetes", [])) > 3)

r = c.post("/api/excel-live/fermer", headers=h)
check("deconnexion finale", r.status_code == 200)
r = c.get("/api/excel-live/statut", headers=h)
check("statut apres deconnexion", r.get_json()["connecte"] is False)

print("\n%d TESTS PASS" % len(ok))
