# -*- coding: utf-8 -*-
"""Configuration centralisée de MboaPilot.

Toutes les variables d'environnement sont lues ici. Le fichier .env est chargé
au démarrage quand il existe. En production, les clés obligatoires doivent être
présentes, sinon le démarrage échoue immédiatement avec un message explicite.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE = Path(__file__).resolve().parent.parent
load_dotenv(BASE / ".env", override=False)


def brut(cle, defaut=""):
    return os.environ.get(cle, defaut)


def entier(cle, defaut=0):
    try:
        return int(os.environ.get(cle, defaut))
    except (TypeError, ValueError):
        return defaut


def booleen(cle, defaut=False):
    v = os.environ.get(cle)
    if v is None:
        return defaut
    return v.strip().lower() in ("1", "true", "yes", "on", "oui")


def obligatoire(cle):
    v = os.environ.get(cle, "").strip()
    if not v:
        raise RuntimeError(
            "Variable d'environnement obligatoire absente : " + cle
        )
    return v


PUBLIC_URL = brut("MBOA_PUBLIC_URL", "https://mboapilot.cm").rstrip("/")
SHA256_CERTIFICAT = brut("SHA256_CERTIFICAT", "A_REMPLACER_PAR_L_EMPREINTE_SHA256_DU_CERTIFICAT")

ENV = brut("MBOA_ENV", "development").strip().lower()
PRODUCTION = ENV == "production"
DEMO = booleen("MBOA_DEMO", not PRODUCTION)

PORT = entier("MBOA_PORT", 5000)
DEBUG = booleen("MBOA_DEBUG", False)
SECRET = brut("MBOA_SECRET", "")

SESSION_MINUTES = entier("MBOA_SESSION_MINUTES", 30)
SESSION_MAX_HEURES = entier("MBOA_SESSION_MAX_HOURS", 8)
COOKIE_SECURE = booleen("MBOA_COOKIE_SECURE", PRODUCTION)

MFA_OBLIGATOIRE = booleen("MBOA_MFA", True)
MFA_KEY = brut("MBOA_MFA_KEY", "")
RECOVERY_PEPPER = brut("MBOA_RECOVERY_PEPPER", "")

RP_ID = brut("MBOA_RP_ID", "localhost")
ORIGIN = brut("MBOA_ORIGIN", "http://localhost:" + str(PORT))

MAIL_PROVIDER = brut("MBOA_MAIL_PROVIDER", "resend").strip().lower()
MAIL_FROM = brut("MBOA_MAIL_FROM", "onboarding@resend.dev")
MAIL_FROM_NAME = brut("MBOA_MAIL_FROM_NAME", "MboaPilot")
ADMIN_EMAILS = [e.strip() for e in brut("MBOA_ADMIN_EMAILS", "").split(",") if e.strip()]

RESEND_API_KEY = brut("RESEND_API_KEY", "")
BREVO_HOST = brut("BREVO_SMTP_HOST", "smtp-relay.brevo.com")
BREVO_PORT = entier("BREVO_SMTP_PORT", 587)
BREVO_LOGIN = brut("BREVO_SMTP_LOGIN", "")
BREVO_KEY = brut("BREVO_SMTP_KEY", "")

TWILIO_SID = brut("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = brut("TWILIO_AUTH_TOKEN", "")
TWILIO_MESSAGING_SID = brut("TWILIO_MESSAGING_SID", "")

VAPID_PUBLIC_KEY = brut("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = brut("VAPID_PRIVATE_KEY", "").replace("\\n", "\n")
VAPID_SUBJECT = brut("VAPID_SUBJECT", "mailto:admin@mboapilot.cm")

CONNECTEURS = {
    "reseau": entier("MBOA_RESEAU_TIMEOUT", 15),
    "user_agent": brut("MBOA_USER_AGENT", "MboaPilot-ETL/1.0"),
    "retry": entier("MBOA_RETRY", 3),
}

OBJECTIF_DEFAUT_PCT = 10.0
STEP_UP_MINUTES = entier("MBOA_STEP_UP_MINUTES", 5)
ALERTE_ANTI_REBOND_MINUTES = entier("MBOA_ALERTE_ANTI_REBOND", 60)
RAPPORT_HEURE = entier("MBOA_RAPPORT_HEURE", 7)


def valider_configuration():
    """Vérifie la configuration au démarrage. Appelée par create_app()."""
    if not SECRET and not DEMO:
        raise RuntimeError(
            "MBOA_SECRET absent. Générez-le avec : "
            "python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    if PRODUCTION:
        if DEMO:
            raise RuntimeError(
                "MBOA_DEMO=1 est interdit en production. Positionnez MBOA_DEMO=0."
            )
        if not COOKIE_SECURE:
            raise RuntimeError("MBOA_COOKIE_SECURE doit valoir 1 en production.")
        if MFA_OBLIGATOIRE and not MFA_KEY:
            raise RuntimeError("MBOA_MFA_KEY est obligatoire en production.")
        if not RECOVERY_PEPPER:
            raise RuntimeError("MBOA_RECOVERY_PEPPER est obligatoire en production.")
        if MAIL_PROVIDER == "resend" and not RESEND_API_KEY:
            raise RuntimeError("RESEND_API_KEY est obligatoire en production.")
        if MAIL_PROVIDER == "smtp" and not (BREVO_LOGIN and BREVO_KEY):
            raise RuntimeError(
                "BREVO_SMTP_LOGIN et BREVO_SMTP_KEY sont obligatoires avec le provider smtp."
            )
        if RP_ID in ("localhost", "127.0.0.1"):
            raise RuntimeError("MBOA_RP_ID doit être le domaine de production.")
