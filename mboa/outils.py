# -*- coding: utf-8 -*-
"""Utilitaires de maintenance MboaPilot.

Exemples :
    python -m mboa.outils vapid
    python -m mboa.outils secret
    python -m mboa.outils seed-demo
    python -m mboa.outils worker
    python -m mboa.outils rapport-hebdo
"""
import argparse
import secrets
import sys

from . import notifications


def generer_vapid():
    from py_vapid import Vapid
    from cryptography.hazmat.primitives import serialization

    v = Vapid()
    v.generate_keys()
    pem = v.private_pem()
    prive = pem.decode() if isinstance(pem, bytes) else pem
    public_bytes = v.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    import base64
    public = base64.urlsafe_b64encode(public_bytes).decode().rstrip("=")
    print("VAPID_PUBLIC_KEY=" + public)
    print("VAPID_PRIVATE_KEY=" + prive.replace("\n", "\\n"))
    print("VAPID_SUBJECT=mailto:admin@mboapilot.cm")


def generer_secret():
    print("MBOA_SECRET=" + secrets.token_hex(32))
    print("MBOA_MFA_KEY=" + __fernet())
    print("MBOA_RECOVERY_PEPPER=" + secrets.token_hex(32))


def __fernet():
    from cryptography.fernet import Fernet
    return Fernet.generate_key().decode()


def seed_demo():
    from .core import migrate
    migrate()
    print("Données de démonstration présentes dans sales.db.")


def worker():
    n = notifications.traiter()
    print("Notifications traitées :", n)
    print(notifications.etat())


def rapport_hebdo():
    from .rapports import rapport_hebdomadaire
    n = rapport_hebdomadaire()
    print("Rapports hebdomadaires envoyés :", n)


def nettoyer_notifications():
    cx = notifications._cx()
    cx.execute("DELETE FROM notifications WHERE statut='envoye' AND envoye_le<datetime('now','-30 days')")
    cx.execute("DELETE FROM notifications WHERE statut='echec' AND cree_le<datetime('now','-30 days')")
    cx.commit()
    cx.close()
    print("File de notifications nettoyée.")


def main():
    p = argparse.ArgumentParser(description="Maintenance MboaPilot")
    p.add_argument("commande", choices=["vapid", "secret", "seed-demo", "worker",
                                        "rapport-hebdo", "nettoyer-notifications"])
    args = p.parse_args()
    {"vapid": generer_vapid, "secret": generer_secret, "seed-demo": seed_demo,
     "worker": worker, "rapport-hebdo": rapport_hebdo,
     "nettoyer-notifications": nettoyer_notifications}[args.commande]()


if __name__ == "__main__":
    main()
