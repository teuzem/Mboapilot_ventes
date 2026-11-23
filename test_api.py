# -*- coding: utf-8 -*-
"""Recette API MboaPilot V2 (auth MFA TOTP, dashboard, imports, formulaires,
partenaires, exports, audit chaîné, habilitations)."""
import io
import json
import sqlite3
import time
from datetime import date, timedelta

import app

app.app.config["TESTING"] = True
ok = []
DB = "sales.db"


def check(nom, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + nom + (f" · {detail}" if detail and not cond else ""))
    assert cond, nom
    ok.append(nom)


class Client:
    """Client de test qui gère automatiquement le jeton CSRF."""

    def __init__(self, base=None):
        self.c = base or app.app.test_client()
        self.token = self.c.get("/api/auth/csrf").get_json()["csrf"]

    def _h(self, headers):
        return {"X-CSRF-Token": self.token, **(headers or {})}

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def post(self, url, **kw):
        return self.c.post(url, headers=self._h(kw.pop("headers", None)), **kw)

    def delete(self, url, **kw):
        return self.c.delete(url, headers=self._h(kw.pop("headers", None)), **kw)


def connecte(login, pwd):
    c = Client()
    r = c.post("/api/auth/login", json={"login": login, "password": pwd})
    assert r.status_code == 200, (login, r.status_code, r.get_json())
    j = r.get_json()
    assert j.get("mfa_required") is True and j.get("code_demo"), ("défi MFA", j)
    r = c.post("/api/auth/mfa-confirmer", json={"code": j["code_demo"]})
    assert r.status_code == 200, (login, "MFA", r.status_code, r.get_json())
    return c


def nettoyer(refs, imports=(), formulaire=None):
    cx = sqlite3.connect(DB)
    for ref in refs:
        cx.execute("DELETE FROM sales WHERE ref=?", (ref,))
    for i in imports:
        cx.execute("DELETE FROM import_rows WHERE import_id=?", (i,))
        cx.execute("DELETE FROM sales WHERE import_id=?", (i,))
        cx.execute("DELETE FROM form_submissions WHERE import_id=?", (i,))
        cx.execute("DELETE FROM imports WHERE id=?", (i,))
    if formulaire:
        cx.execute("DELETE FROM form_templates WHERE id=?", (formulaire,))
    cx.execute("UPDATE users SET echecs=0, bloque_jusqua=NULL, bloque_def=0 WHERE login='commercial'")
    cx.execute("UPDATE users SET echecs=0, bloque_jusqua=NULL, bloque_def=0 WHERE login='demo'")
    cx.execute("DELETE FROM users WHERE login='testeur_v2'")
    cx.commit()
    cx.close()


a = Client()

# ---------- Vitrine publique & SPA ----------
h = a.get("/api/health").get_json()
check("health V2", h["ok"] is True and h["version"] == "2.0" and h["lignes"] > 1000)
v = a.get("/api/vitrine/stats").get_json()
check("vitrine stats", v["kpis"]["ca30"] > 0 and v["regions"] == 10 and len(v["serie30"]) >= 20)
part = a.get("/api/partenaires/publics").get_json()
check("partenaires publics", part["total"] >= 1 and all(x["logo"] for x in part["partenaires"]))
for url in ["/", "/tarifs", "/login", "/app", "/partenaires", "/securite"]:
    r = a.get(url)
    check(f"SPA {url}", r.status_code == 200 and b'<div id="root">' in r.data)
check("logo statique", a.get("/logo.svg").status_code == 200)

# ---------- Contact & CSRF ----------
r = a.post("/api/contact", json={"nom": "Jury Test", "entreprise": "J SARL",
                                 "email": "jury@test.cm", "message": "Démo V2 svp"})
check("contact ok", r.status_code == 200)
check("contact invalide", a.post("/api/contact", json={"nom": "x", "email": "bad", "message": "y"}).status_code == 400)
sans = app.app.test_client()
r = sans.post("/api/contact", json={"nom": "X", "email": "x@y.cm", "message": "z"})
check("CSRF exigé", r.status_code == 400 and r.get_json()["code"] == "csrf")

# ---------- Auth ----------
check("me anonyme 401", a.get("/api/auth/me").status_code == 401)
check("dashboard anonyme 401", a.get("/api/dashboard").status_code == 401)
mauvais = Client()
r = mauvais.post("/api/auth/login", json={"login": "commercial", "password": "Totalement-Faux-2026!"})
check("login mauvais mdp 401", r.status_code == 401)
r = mauvais.post("/api/auth/login", json={"login": "commercial", "password": "MboaPilot-Com-2026!"})
j = r.get_json()
check("défi TOTP", r.status_code == 200 and j["mode"] == "totp" and len(j["code_demo"]) == 6)
r = mauvais.post("/api/auth/mfa-confirmer", json={"code": "000000"})
check("MFA faux code 401", r.status_code == 401)
check("état MFA accessible", mauvais.get("/api/auth/mfa/etat").get_json().get("mfa_required") is True)

com = connecte("commercial", "MboaPilot-Com-2026!")
me = com.get("/api/auth/me").get_json()
check("session commercial", me["role"] == "Commercial" and me["perimetre"] == "Littoral" and me["mfa"] is True)
check("droits commerciaux", "sales.write" in me["permissions"] and "users.manage" not in me["permissions"])
check("commercial users 403", com.get("/api/users").status_code == 403)
check("commercial audit 403", com.get("/api/audit").status_code == 403)

# ---------- Dashboard & filtres ----------
d = com.get("/api/dashboard?periode=365").get_json()
check("dashboard kpis", d["kpis"]["ca"] > 0 and d["kpis"]["nb"] > 0 and "tauxMarge" in d["kpis"])
check("dashboard série", len(d["serie"]["points"]) >= 10 and d["serie"]["cible_jour"] > 0)
check("dashboard répartitions", len(d["repartitions"]["regions"]) == 1
      and d["repartitions"]["regions"][0]["region"] == "Littoral")
check("dashboard mensuel", len(d["mensuel"]) == 12)
check("dashboard récit/alertes", len(d["recit"]) >= 2 and len(d["alertes"]) >= 1)
check("dashboard récentes", isinstance(d["recentes"], list))
check("dashboard permissions", "sales.write" in d["permissions"])
check("dashboard filtre canal", com.get("/api/dashboard?periode=90&canal=POS").status_code == 200)
f = com.get("/api/filtres").get_json()
check("filtres produits", len(f["produits"]) >= 10 and all({"produit", "famille", "prix"} <= set(x) for x in f["produits"]))
check("live lecture", com.get("/api/live").get_json()["caJour"] is not None)

# ---------- Saisie manuelle & POS ----------
p0 = f["produits"][0]
jour = (date.today() - timedelta(days=3)).isoformat()
r = com.post("/api/ventes-manuelle", json={
    "produit": p0["produit"], "qte": 2, "prix_unit": p0["prix"],
    "canal": "POS", "region": "Nord", "ville": "Douala",
    "point_vente": "Test V2", "jour": jour,
})
j = r.get_json()
check("saisie manuelle ok", r.status_code == 200 and j["ok"] is True)
check("saisie périmètre forcé", j["region"] == "Littoral")
ref_manuelle = j["ref"]
cx = sqlite3.connect(DB)
lg = cx.execute("SELECT region, montant FROM sales WHERE ref=?", (ref_manuelle,)).fetchone()
cx.close()
check("saisie montant", lg[0] == "Littoral" and lg[1] == round(2 * p0["prix"]))
r = com.post("/api/ventes-manuelle", json={"produit": "Produit Inexistant", "qte": 1, "prix_unit": 100})
check("produit inconnu 400", r.status_code == 400)
r = com.post("/api/ventes-manuelle", json={"produit": p0["produit"], "qte": 1, "prix_unit": 100, "jour": "2099-01-01"})
check("date future 400", r.status_code == 400)
r = com.post("/api/ventes-manuelle", json={"produit": p0["produit"], "qte": 1, "prix_unit": 100, "remise_pct": 80})
check("remise excessive 400", r.status_code == 400)
r = com.post("/api/pos-push")
j = r.get_json()
check("pos push live", r.status_code == 200 and j.get("ok") is True and j.get("montant", 0) > 0)
ref_pos = j.get("ref")

# ---------- Exports & rapport ----------
check("export csv", com.get("/api/export/csv?periode=90").status_code == 200)
r = com.get("/api/export/xlsx?periode=90")
check("export xlsx", r.status_code == 200 and r.data[:2] == b"PK")
rap = com.get("/api/rapport").get_json()
check("rapport signé", rap["ca"] > 0 and len(rap["emp"]) == 16 and len(rap["top"]) <= 10)
check("rapport régions", len(rap["regions"]) == 1 and rap["regions"][0]["region"] == "Littoral")

# ---------- Auditeur : lecture seule ----------
aud = connecte("auditeur", "MboaPilot-Audit-2026!")
check("auditeur audit autorisé", aud.get("/api/audit").status_code == 200)
check("auditeur ventes 403", aud.post("/api/ventes-manuelle", json={}).status_code == 403)
check("auditeur pos 403", aud.post("/api/pos-push").status_code == 403)
check("auditeur imports write 403", aud.post("/api/imports/analyser").status_code == 403)

# ---------- Manager : imports, formulaires, audit ----------
mgr = connecte("manager", "MboaPilot-Mgr-2026!")
check("manager périmètre Centre", mgr.get("/api/auth/me").get_json()["perimetre"] == "Centre")
check("manager audit", mgr.get("/api/audit").status_code == 200)
check("chaîne audit intègre", mgr.get("/api/audit/verifier").get_json()["valide"] is True)
check("imports liste", mgr.get("/api/imports").status_code == 200)
check("modèle CSV", mgr.get("/api/imports/modele?format=csv").status_code == 200)
check("modèle XLSX", mgr.get("/api/imports/modele?format=xlsx").status_code == 200)

stamp = str(int(time.time()))
ref_csv = f"TX-API-CSV-{stamp}"
csv = ("ref;jour;canal;region;ville;point_vente;vendeur;produit;famille;qte;prix_unit;remise_pct;montant;devise\n"
       f"{ref_csv};{jour};Agence;Centre;Yaoundé;Test API;Jury;{p0['produit']};{p0['famille']};1;{p0['prix']};0;{p0['prix']};FCFA\n")
r = mgr.post("/api/imports/analyser", data={
    "fichier": (io.BytesIO(csv.encode("utf-8")), "recette_v2.csv"), "mode": "ignorer",
}, content_type="multipart/form-data")
res = r.get_json()
check("analyse CSV", r.status_code == 200 and res["resume"]["recues"] == 1 and res["resume"]["integrables"] == 1)
r = mgr.post("/api/imports/executer", data={
    "fichier": (io.BytesIO(csv.encode("utf-8")), "recette_v2.csv"),
    "mapping": json.dumps(res["mapping"]), "mode": "ignorer",
}, content_type="multipart/form-data")
ex = r.get_json()
check("exécution CSV", r.status_code == 200 and ex["ok"] is True and ex["statut"] == "Reussi")
import_csv = ex.get("import_id")
check("détail import", mgr.get(f"/api/imports/{import_csv}").status_code == 200)

r = mgr.post("/api/forms", json={
    "nom": f"Recette {stamp}", "description": "Formulaire de recette automatisée.",
    "champs": [
        {"cle": "jour", "label": "Date", "type": "date", "requis": True},
        {"cle": "canal", "label": "Canal", "type": "select", "requis": True, "options": ["POS", "Agence", "E-commerce"]},
        {"cle": "region", "label": "Région", "type": "select", "requis": True},
        {"cle": "produit", "label": "Produit", "type": "text", "requis": True},
        {"cle": "famille", "label": "Famille", "type": "select", "requis": True},
        {"cle": "qte", "label": "Quantité", "type": "number", "requis": True},
        {"cle": "prix_unit", "label": "Prix unitaire", "type": "number", "requis": True},
    ],
})
fj = r.get_json()
check("création formulaire", r.status_code == 200 and fj.get("ok") is True)
fid = fj.get("id")
r = mgr.post(f"/api/forms/{fid}/soumettre", json={"lignes": [{
    "jour": jour, "canal": "Agence", "region": "Centre", "produit": p0["produit"],
    "famille": p0["famille"], "qte": 1, "prix_unit": p0["prix"],
}]})
sub = r.get_json()
check("soumission formulaire", r.status_code == 200 and sub["ok"] is True and sub["resume"]["rejets"] == 0)
import_form = sub.get("import_id")
check("suppression formulaire", mgr.delete(f"/api/forms/{fid}").status_code == 200)

# ---------- Admin : utilisateurs, matrice, annulation ----------
ad = connecte("admin", "MboaPilot-Admin-2026!")
us = ad.get("/api/users").get_json()
check("liste utilisateurs", len(us["users"]) >= 5)
mat = ad.get("/api/users/matrice").get_json()
check("matrice permissions", len(mat["permissions"]) >= 10 and set(mat["roles"]) == {"Admin", "Manager", "Commercial", "Auditeur"})
r = ad.post("/api/users", json={
    "action": "creer", "login": "testeur_v2", "nom": "Testeur Recette",
    "email": "testeur.v2@mboapilot.cm", "role": "Commercial",
    "perimetre": "Littoral", "pwd": "Recette-V2-2026!",
})
check("création utilisateur", r.status_code == 200)
r = ad.post("/api/users", json={
    "action": "creer", "login": "testeur_v2", "nom": "Doublon",
    "email": "testeur.v2@mboapilot.cm", "role": "Commercial",
    "perimetre": "Littoral", "pwd": "Recette-V2-2026!",
})
check("doublon utilisateur 400", r.status_code == 400)
check("annulation import", ad.post(f"/api/imports/{import_csv}/annuler").status_code == 200)
check("annulation formulaire-import", ad.post(f"/api/imports/{import_form}/annuler").status_code == 200)
check("comptes démo", len(ad.get("/api/auth/demo-secrets").get_json()["comptes"]) == 5)
r = ad.post("/api/users", json={"action": "reset-mfa", "login": "testeur_v2"})
check("reset MFA", r.status_code == 200)
check("logout", ad.post("/api/auth/logout").status_code == 200)
check("me après logout 401", ad.get("/api/auth/me").status_code == 401)

# ---------- Verrouillage ----------
cx = sqlite3.connect(DB)
cx.execute("UPDATE users SET echecs=0, bloque_jusqua=NULL, bloque_def=0 WHERE login='demo'")
cx.commit()
cx.close()
brut = Client()
for _ in range(5):
    brut.post("/api/auth/login", json={"login": "demo", "password": "Mauvais-Mot-2026!"})
r = brut.post("/api/auth/login", json={"login": "demo", "password": "Mboa-Demo-2026!"})
check("verrouillage 5 échecs", r.status_code == 403 and r.get_json()["code"] == "locked")

# ---------- Nettoyage ----------
nettoyer([ref_manuelle, ref_pos, ref_csv], [import_csv, import_form], fid)
check("nettoyage recette", True)

print(f"\n{len(ok)} TESTS PASS")
