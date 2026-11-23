# -*- coding: utf-8 -*-
"""SMS transactionnel via Twilio, réservé aux alertes de criticité haute.

Le SMS n'est jamais utilisé comme facteur d'authentification ni comme seul
moyen de récupération. Le numéro doit être vérifié et le consentement enregistré.
"""
import requests

from .config import TWILIO_MESSAGING_SID, TWILIO_SID, TWILIO_TOKEN


def configure():
    return bool(TWILIO_SID and TWILIO_TOKEN and TWILIO_MESSAGING_SID)


def envoyer_sms(numero, message):
    if not configure():
        raise RuntimeError("Configuration Twilio incomplète.")
    import re
    numero = re.sub(r"[^+0-9]", "", str(numero or ""))
    if not re.fullmatch(r"\+[1-9]\d{8,14}", numero):
        raise ValueError("Numéro de téléphone invalide. Format attendu : +237612345678")
    url = "https://api.twilio.com/2010-04-01/Accounts/" + TWILIO_SID + "/Messages.json"
    rep = requests.post(
        url,
        auth=(TWILIO_SID, TWILIO_TOKEN),
        data={"To": numero, "MessagingServiceSid": TWILIO_MESSAGING_SID,
              "Body": message[:1500]},
        timeout=20,
    )
    if rep.status_code >= 300:
        raise RuntimeError("Twilio " + str(rep.status_code) + " : " + rep.text[:300])
    return rep.json().get("sid", "")


def envoyer_sms_admin(titre, message):
    """Les numéros sont lus dans la configuration, jamais devinés."""
    import os
    numeros = [n.strip() for n in os.environ.get("MBOA_SMS_ADMIN", "").split(",") if n.strip()]
    resultats = []
    for n in numeros:
        resultats.append(envoyer_sms(n, titre + " : " + message))
    return resultats
