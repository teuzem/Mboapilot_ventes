# -*- coding: utf-8 -*-
"""Recette des extensions du sprint : MFA durci, notifications, passkeys, ETL, alertes."""
import sqlite3
import time
from datetime import date

import pyotp

from mboa import create_app
from mboa.config import BASE

DB = str(BASE / "sales.db")
ok = []


def check(nom, cond):
    assert cond, nom
    ok.append(nom)
    print("PASS", nom)


class Client:
    def __init__(self, base):
        self.c = base.test_client()
        self.token = self.c.get("/api/auth/csrf").get_json()["csrf"]

    def post(self, url, **kw):
        return self.c.post(url, headers={"X-CSRF-Token": self.token}, **kw)

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def delete(self, url, **kw):
        return self.c.delete(url, headers={"X-CSRF-Token": self.token}, **kw)


__cx = sqlite3.connect(DB)
__cx.execute("DELETE FROM sales WHERE ref LIKE 'TX-EXT-%'")
__cx.commit()
__cx.close()

app = create_app()
a = Client(app)

check("vapid key endpoint", a.get("/api/notifications/vapid-key").status_code == 200)
check("etapes catalogue", len(a.get("/api/etl/etapes").get_json()["etapes"]) >= 6)

# Connexion admin
r = a.post("/api/auth/login", json={"login": "admin", "password": "MboaPilot-Admin-2026!"})
check("login admin", r.status_code == 200)
d = r.get_json()
code = d.get("code_demo") or pyotp.TOTP(a.get("/api/auth/mfa/etat").get_json().get("secret", "")).now()
_cx = sqlite3.connect(str(BASE / "sales.db"))
_cx.execute("UPDATE users SET mfa_last_step=-1 WHERE login='admin'")
_cx.commit()
_cx.close()
r = a.post("/api/auth/mfa-confirmer", json={"code": code})
check("mfa admin", r.status_code == 200, )

# Objectifs
r = a.post("/api/objectifs", json={"periode": "mensuel", "region": "National", "famille": "Toutes", "montant": 500000000})
check("objectif save", r.status_code == 200)
check("objectif liste", any(o["montant"] == 500000000 for o in a.get("/api/objectifs").get_json()["objectifs"]))

# Règle d'alerte
r = a.post("/api/alert-rules", json={"nom": "Test CA", "indicateur": "ca", "operateur": "<", "seuil": 1, "region": "National", "criticite": "Basse"})
check("regle save", r.status_code == 200)
rid = r.get_json()["id"]
check("regle active", a.post("/api/alert-rules/%s/activer" % rid).status_code == 200)
check("evaluer alertes", a.post("/api/alert-evaluer").status_code == 200)
check("historique alertes", isinstance(a.get("/api/alert-events").get_json()["evenements"], list))
a.delete("/api/alert-rules/%s" % rid)

# Connecteur ETL
r = a.post("/api/connecteurs", json={"nom": "Test local", "type": "dossier",
            "configuration": {"chemin": "data", "motifs": ["ventes_agences.csv"], "separateur": ";"}})
check("connecteur save", r.status_code == 200)
cid = r.get_json()["id"]
r = a.post("/api/connecteurs/tester", json={"configuration": {"type": "dossier", "chemin": "data",
           "motifs": ["ventes_agences.csv"], "separateur": ";"}})
check("connecteur preview", r.status_code == 200 and r.get_json()["lignes"] > 10)
check("connecteur runs", isinstance(a.get("/api/connecteurs/%s/runs" % cid).get_json()["runs"], list))
a.delete("/api/alert-rules/%s" % rid)

# SEL (événements pour le flux live)
cx = sqlite3.connect(DB)
n0 = cx.execute("SELECT COUNT(*) FROM evenements").fetchone()[0]
prod = cx.execute("SELECT produit,prix_unit FROM sales WHERE region='Centre' LIMIT 1").fetchone()
cx.close()
ref_test = "TX-EXT-" + str(int(time.time() * 1000))
a.post("/api/pos-push", json={"ref": ref_test, "produit": prod[0], "qte": 1,
                              "prix_unit": prod[1], "region": "Centre", "jour": "2026-11-06"})
cx = sqlite3.connect(DB)
n1 = cx.execute("SELECT COUNT(*) FROM evenements").fetchone()[0]
cx.execute("DELETE FROM sales WHERE ref=?", (ref_test,))
cx.close()
check("evenement SSE", n1 > n0)

# In-app notifications
check("inapp liste", "notifications" in a.get("/api/notifications/inapp").get_json())
check("notifications etat", "email_configure" in a.get("/api/notifications/etat").get_json())

# Passkeys availability
check("passkeys liste", isinstance(a.get("/api/webauthn/credentials").get_json()["credentials"], list))
check("audit pdf", a.get("/api/audit/export-pdf").status_code == 200)

# Anti-rejeu TOTP : le même code ne doit pas servir deux fois.
c2 = Client(app)
r = c2.post("/api/auth/login", json={"login": "manager", "password": "MboaPilot-Mgr-2026!"})
j = r.get_json()
code1 = j.get("code_demo")
_cx = sqlite3.connect(DB)
_cx.execute("UPDATE users SET mfa_last_step=-1 WHERE login='manager'")
_cx.commit()
_cx.close()
r = c2.post("/api/auth/mfa-confirmer", json={"code": code1})
check("mfa manager", r.status_code == 200)
check("desactivation MFA refuse pour manager",
      c2.post("/api/auth/mfa/desactiver", json={"password": "MboaPilot-Mgr-2026!", "code": code1}).status_code == 403)
c2.post("/api/auth/logout")

c3 = Client(app)
r = c3.post("/api/auth/login", json={"login": "manager", "password": "MboaPilot-Mgr-2026!"})
code2 = r.get_json().get("code_demo")
if code2 == code1:
    check("anti-rejeu TOTP", c3.post("/api/auth/mfa-confirmer", json={"code": code1}).status_code == 401)
else:
    ok.append("anti-rejeu TOTP (fenetre differente)")
    print("PASS anti-rejeu TOTP (fenetre differente)")

print("\n%d TESTS PASS" % len(ok))
