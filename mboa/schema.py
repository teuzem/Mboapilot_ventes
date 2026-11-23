# -*- coding: utf-8 -*-
"""Migrations complémentaires du sprint : objectifs, événements, alertes, passkeys.

Toutes les créations sont idempotentes et ne détruisent aucune donnée existante.
"""
import sqlite3

from .config import BASE

DB = BASE / "sales.db"


def cx():
    c = sqlite3.connect(DB, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def migrer():
    c = cx()
    c.execute("""CREATE TABLE IF NOT EXISTS objectifs(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        periode TEXT NOT NULL,
        region TEXT NOT NULL DEFAULT 'National',
        famille TEXT NOT NULL DEFAULT 'Toutes',
        montant REAL NOT NULL,
        cree_par TEXT,
        cree_le TEXT DEFAULT (datetime('now')),
        UNIQUE(periode,region,famille)
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS evenements(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        reference TEXT,
        details TEXT,
        horo TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_evenements_id ON evenements(id)")
    c.execute("""CREATE TABLE IF NOT EXISTS notifications_inapp(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT NOT NULL,
        titre TEXT NOT NULL,
        message TEXT,
        lien TEXT,
        categorie TEXT DEFAULT 'alerte',
        lue INTEGER DEFAULT 0,
        cree_le TEXT DEFAULT (datetime('now'))
    )""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_inapp_login ON notifications_inapp(login,lue)")
    c.execute("""CREATE TABLE IF NOT EXISTS alert_rules(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT NOT NULL,
        indicateur TEXT NOT NULL,
        operateur TEXT NOT NULL,
        seuil REAL NOT NULL,
        region TEXT DEFAULT 'National',
        destinataires TEXT,
        criticite TEXT DEFAULT 'Moyenne',
        active INTEGER DEFAULT 0,
        validee_par TEXT,
        cree_par TEXT,
        cree_le TEXT DEFAULT (datetime('now')),
        derniere_alerte TEXT
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS alert_events(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id INTEGER,
        valeur REAL,
        seuil REAL,
        message TEXT,
        horo TEXT DEFAULT (datetime('now')),
        notifie INTEGER DEFAULT 0
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS webauthn_credentials(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT NOT NULL,
        credential_id TEXT UNIQUE NOT NULL,
        public_key TEXT NOT NULL,
        sign_count INTEGER DEFAULT 0,
        transports TEXT,
        device_type TEXT,
        backed_up INTEGER DEFAULT 0,
        cree_le TEXT DEFAULT (datetime('now')),
        derniere_utilisation TEXT
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS connectors(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT NOT NULL,
        type TEXT NOT NULL,
        configuration TEXT NOT NULL,
        actif INTEGER DEFAULT 1,
        cree_le TEXT DEFAULT (datetime('now')),
        derniere_sync TEXT,
        dernier_statut TEXT
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS connector_runs(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        connector_id INTEGER,
        statut TEXT,
        lignes INTEGER DEFAULT 0,
        rejets INTEGER DEFAULT 0,
        message TEXT,
        duree_ms INTEGER,
        horo TEXT DEFAULT (datetime('now'))
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS rate_limits(
        cle TEXT PRIMARY KEY,
        fenetre_debut REAL,
        compteur INTEGER DEFAULT 0
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS sessions_connectees(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT NOT NULL,
        jti TEXT UNIQUE NOT NULL,
        ip TEXT,
        user_agent TEXT,
        cree_le TEXT DEFAULT (datetime('now')),
        derniere_activite TEXT DEFAULT (datetime('now')),
        active INTEGER DEFAULT 1
    )""")
    c.commit()
    c.close()


def evenement(type_, reference="", details=""):
    c = cx()
    c.execute("INSERT INTO evenements(type,reference,details) VALUES(?,?,?)",
              (type_, str(reference or ""), str(details or "")[:1000]))
    c.commit()
    c.close()


def objectif(periode="mensuel", region="National", famille="Toutes", defaut=None):
    c = cx()
    r = c.execute("""SELECT montant FROM objectifs
                     WHERE periode=? AND region IN (?, 'National')
                     AND famille IN (?, 'Toutes')
                     ORDER BY CASE WHEN region='National' THEN 1 ELSE 0 END,
                              CASE WHEN famille='Toutes' THEN 1 ELSE 0 END LIMIT 1""",
                  (periode, region, famille)).fetchone()
    c.close()
    if r:
        return r["montant"], False
    return defaut, True
