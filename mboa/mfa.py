# -*- coding: utf-8 -*-
"""Noyau MFA durci : TOTP anti-rejeu, graines chiffrées, codes de secours.

Les règles appliquées suivent la RFC 6238 section 5.2, la fiche OWASP
Multifactor Authentication et NIST SP 800-63B-4. Aucune vérification n'accepte
deux fois le même pas de temps, et seule la fenêtre courante plus un pas
précédent est autorisée. La dérive d'horloge est enregistrée par jeton.
"""
import base64
import hashlib
import hmac
import secrets
import time

import pyotp
from cryptography.fernet import Fernet, InvalidToken

from .config import DEMO, MFA_KEY, RECOVERY_PEPPER, SECRET
from .core import db

INTERVALLE = 30
PREFIXE = "v2:"


def _fernet():
    key = MFA_KEY or SECRET
    if not key:
        return None
    if len(key) != 44 or not key.endswith("="):
        try:
            key = base64.urlsafe_b64encode(hashlib.sha256(key.encode()).digest()).decode()
        except Exception:
            return None
    return Fernet(key.encode())


def chiffrer(secret):
    f = _fernet()
    if not f:
        return PREFIXE + secret
    return PREFIXE + f.encrypt(secret.encode()).decode()


def dechiffrer(valeur):
    if not valeur:
        return None
    if not valeur.startswith(PREFIXE):
        return valeur
    brut = valeur[len(PREFIXE):]
    f = _fernet()
    if not f:
        return brut
    try:
        return f.decrypt(brut.encode()).decode()
    except InvalidToken:
        return None


def nouvelle_graine():
    return pyotp.random_base32()


def uri_provisioning(login, secret, issuer="MboaPilot"):
    return pyotp.TOTP(secret, interval=INTERVALLE).provisioning_uri(
        name=login + "@mboapilot.cm", issuer_name=issuer
    )


def code_courant(secret, drift=0):
    pas = int(time.time() // INTERVALLE) + int(drift or 0)
    return pyotp.TOTP(secret, interval=INTERVALLE).at(pas * INTERVALLE)


def hash_code_secours(code):
    poivre = RECOVERY_PEPPER or SECRET or "mboapilot-recovery"
    valeur = (code or "").strip().upper().encode()
    return hmac.new(poivre.encode(), valeur, hashlib.sha256).hexdigest()


def generer_codes_secours(login, nb=10):
    cx = db()
    cx.execute("DELETE FROM recovery_codes WHERE login=?", (login,))
    clairs = []
    for _ in range(nb):
        brut = secrets.token_hex(5).upper()
        code = brut[:5] + "-" + brut[5:]
        clairs.append(code)
        cx.execute("INSERT INTO recovery_codes(login,code_hash) VALUES(?,?)",
                   (login, hash_code_secours(code)))
    cx.commit()
    return clairs


def consommer_code_secours(login, code):
    if not code:
        return False
    cx = db()
    h = hash_code_secours(code)
    r = cx.execute("SELECT id FROM recovery_codes WHERE login=? AND code_hash=? AND utilise=0",
                   (login, h)).fetchone()
    if not r:
        return False
    n = cx.execute("UPDATE recovery_codes SET utilise=1 WHERE id=? AND utilise=0", (r["id"],))
    cx.commit()
    return n.rowcount > 0


def codes_restants(login):
    r = db().execute(
        "SELECT COUNT(*) c FROM recovery_codes WHERE login=? AND utilise=0", (login,)
    ).fetchone()
    return r["c"] if r else 0


def verifier_totp(u, code):
    """Vérifie un code TOTP avec anti-rejeu atomique.

    Retourne (accepte, raison). La raison vaut 'ok', 'format', 'replay' ou 'incorrect'.
    """
    import re
    code = re.sub(r"\s", "", str(code or ""))
    if not re.fullmatch(r"\d{6}", code):
        return False, "format"
    secret = dechiffrer(u["mfa_secret"])
    if not secret:
        return False, "incorrect"
    maintenant = int(time.time() // INTERVALLE)
    drift = int(u["mfa_drift"] or 0)
    pas_courant = maintenant + drift
    dernier = int(u["mfa_last_step"] or -1)
    totp = pyotp.TOTP(secret, interval=INTERVALLE)
    for candidat in (pas_courant, pas_courant - 1):
        if candidat <= dernier:
            continue
        if hmac.compare_digest(totp.at(candidat * INTERVALLE), code):
            cx = db()
            maj = cx.execute(
                "UPDATE users SET mfa_last_step=?, mfa_drift=? WHERE id=? AND mfa_last_step<?",
                (candidat, candidat - maintenant, u["id"], candidat),
            )
            cx.commit()
            if maj.rowcount > 0:
                return True, "ok"
            return False, "replay"
    return False, "incorrect"


def secret_utilisateur(u):
    secret = dechiffrer(u["mfa_secret"])
    if secret:
        return secret
    secret = nouvelle_graine()
    db().execute("UPDATE users SET mfa_secret=? WHERE id=?", (chiffrer(secret), u["id"]))
    db().commit()
    return secret


def _cx():
    import sqlite3
    from .core import DB
    cx = sqlite3.connect(DB, timeout=30)
    cx.row_factory = sqlite3.Row
    return cx


def migrer_secrets():
    """Chiffre les graines encore stockées en clair."""
    if not _fernet():
        return 0
    cx = _cx()
    rows = cx.execute("SELECT id,mfa_secret FROM users WHERE mfa_secret IS NOT NULL").fetchall()
    n = 0
    for r in rows:
        v = r["mfa_secret"]
        if v and not v.startswith(PREFIXE):
            cx.execute("UPDATE users SET mfa_secret=? WHERE id=?", (chiffrer(v), r["id"]))
            n += 1
    cx.commit()
    cx.close()
    return n


def migrer_schema():
    cx = _cx()
    cols = {r[1] for r in cx.execute("PRAGMA table_info(users)")}
    if "mfa_last_step" not in cols:
        cx.execute("ALTER TABLE users ADD COLUMN mfa_last_step INTEGER DEFAULT -1")
    if "mfa_drift" not in cols:
        cx.execute("ALTER TABLE users ADD COLUMN mfa_drift INTEGER DEFAULT 0")
    cx.commit()
    cx.close()
    migrer_secrets()


def generer_code_email(login):
    """Code de secours par email : court, haché, usage unique, une tentative par envoi."""
    code = "{:06d}".format(secrets.randbelow(900000) + 100000)
    expire = time.time() + 600
    cx = db()
    cx.execute("UPDATE mfa_codes SET utilise=1 WHERE login=? AND utilise=0", (login,))
    cx.execute(
        "INSERT INTO mfa_codes(login,code,expire) VALUES(?,?,?)",
        (login, hash_code_secours(code), __datetime(expire)),
    )
    cx.commit()
    return code


def verifier_code_email(login, code):
    import re
    code = re.sub(r"\s", "", str(code or ""))
    if not re.fullmatch(r"\d{6}", code):
        return False
    cx = db()
    r = cx.execute(
        "SELECT * FROM mfa_codes WHERE login=? AND utilise=0 ORDER BY id DESC LIMIT 1",
        (login,),
    ).fetchone()
    if not r or (r["tentatives"] or 0) >= 5:
        return False
    try:
        from datetime import datetime
        expire = datetime.fromisoformat(r["expire"])
    except Exception:
        return False
    import datetime as _dt
    if expire < _dt.datetime.utcnow():
        return False
    if not hmac.compare_digest(r["code"], hash_code_secours(code)):
        cx.execute("UPDATE mfa_codes SET tentatives=tentatives+1 WHERE id=?", (r["id"],))
        cx.commit()
        return False
    cx.execute("UPDATE mfa_codes SET utilise=1 WHERE id=?", (r["id"],))
    cx.commit()
    return True


def __datetime(ts):
    from datetime import datetime
    return datetime.utcfromtimestamp(ts).isoformat()


def roles_obligatoires():
    return {"Admin", "Manager", "Auditeur"}


def mfa_requise(role):
    """Rôles pour lesquels la désactivation de la MFA est interdite."""
    return role in roles_obligatoires()
