# -*- coding: utf-8 -*-
"""Recette du profil complet et des préférences de sécurité."""
from mboa import create_app

ok = []
def check(nom, cond, detail=""):
    assert cond, nom + " " + str(detail)
    ok.append(nom); print("PASS", nom)

app = create_app()
c = app.test_client()
t = c.get("/api/auth/csrf").get_json()["csrf"]
h = {"X-CSRF-Token": t}
r = c.post("/api/auth/login", json={"login": "admin", "password": "MboaPilot-Admin-2026!"}, headers=h)
j = r.get_json()
import sqlite3
_cx = sqlite3.connect("sales.db")
_cx.execute("UPDATE users SET mfa_last_step=-1 WHERE login='admin'")
_cx.commit()
_cx.close()
r = c.post("/api/auth/mfa-confirmer", json={"code": j["code_demo"]}, headers=h)
check("connexion", r.status_code == 200)

r = c.get("/api/profil", headers=h)
check("lecture profil", r.status_code == 200 and r.get_json()["login"] == "admin", r.get_json())
p = r.get_json()
check("champs presents", all(k in p for k in ("prenom", "poste", "organisation", "langue", "fuseau")))

r = c.post("/api/profil", json={
    "nom": "Administrateur", "prenom": "Systeme", "email": "admin@mboapilot.cm",
    "telephone": "+237612345678", "poste": "Responsable SI", "organisation": "MboaPilot",
    "bio": "Pilotage des ventes", "langue": "fr", "fuseau": "Africa/Douala",
    "notif_email": True, "notif_push": True,
}, headers=h)
check("enregistrement profil", r.status_code == 200 and r.get_json()["ok"], r.get_json())

r = c.get("/api/profil", headers=h)
check("persistance profil", r.get_json()["poste"] == "Responsable SI")
check("telephone", r.get_json()["telephone"] == "+237612345678")

r = c.post("/api/profil/verifier-email", json={}, headers=h)
check("code verification email", r.status_code == 200 and r.get_json().get("code_demo"))
code = r.get_json()["code_demo"]
r = c.post("/api/profil/confirmer-email", json={"code": code}, headers=h)
check("confirmation email", r.status_code == 200, r.get_json())

check("activite", isinstance(c.get("/api/profil/activite", headers=h).get_json()["evenements"], list))
check("sessions", isinstance(c.get("/api/profil/sessions", headers=h).get_json()["sessions"], list))

# Avatar PNG minimal
import base64
png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==")
r = c.post("/api/profil/avatar", data={"avatar": (__import__("io").BytesIO(png), "test.png")},
           headers={**h, "Content-Type": "multipart/form-data"})
check("upload avatar", r.status_code == 200 and r.get_json().get("avatar_url"), r.get_json())

print("\n%d TESTS PASS" % len(ok))
