# MboaPilot V2 — dossier technique & guide de démonstration

**Produit :** MboaPilot — *Vos ventes méritent mieux qu'un tableur. Pilotez-les.*
**Stack :** React 19 + Vite + Recharts + Material Icons ↔ API Flask + SQLite — 100 % hors-ligne après build.
**Devise :** FCFA · **Langue :** français · **Périmètre :** 10 régions du Cameroun.

---

## 1. Lancer l'application

```bat
LANCER.bat
```

ou manuellement :

```bat
pip install -r requirements.txt
python app.py
```

→ http://127.0.0.1:5000

Le frontend est pré-construit dans `frontend/dist`. Pour le reconstruire après une modification :

```bat
BUILD_FRONT.bat
```

Variables d'environnement utiles :

| Variable | Défaut | Rôle |
|---|---|---|
| `MBOA_PORT` | `5000` | Port HTTP |
| `MBOA_DEBUG` | `0` | Mode debug Flask |
| `MBOA_SECRET` | fichier `.mboa_secret` | Clé de signature des sessions |
| `MBOA_DEMO` | `1` | Fournit le code TOTP courant pour la démonstration jury |
| `MBOA_COOKIE_SECURE` | `0` | Cookies `Secure` (à passer à `1` derrière HTTPS) |
| `MBOA_SESSION_MINUTES` | `30` | Inactivité maximale |
| `MBOA_SESSION_MAX_HOURS` | `8` | Durée absolue d'une session |

> En production : `MBOA_DEMO=0`, `MBOA_COOKIE_SECURE=1`, HTTPS obligatoire, secret fourni par l'environnement.

---

## 2. Comptes de démonstration

| Identifiant | Mot de passe | Rôle | Périmètre |
|---|---|---|---|
| `admin` | `MboaPilot-Admin-2026!` | Admin | National |
| `manager` | `MboaPilot-Mgr-2026!` | Manager | Centre |
| `commercial` | `MboaPilot-Com-2026!` | Commercial | Littoral |
| `auditeur` | `MboaPilot-Audit-2026!` | Auditeur | National |
| `demo` | `Mboa-Demo-2026!` | Manager | National |

**MFA réelle :** chaque connexion exige un code TOTP à 6 chiffres (RFC 6238, `pyotp`). En mode démo, l'API renvoie `code_demo` avec le défi pour permettre la démonstration sans téléphone. En production (`MBOA_DEMO=0`), ce champ disparaît : il faut scanner le QR code avec Google Authenticator, Microsoft Authenticator ou 1Password.

Les codes de secours sont générés par lot de 10, hachés en base et à usage unique. L'écran **Compte & sécurité** permet de changer le mot de passe, remplacer l'authenticator, régénérer les codes et consulter l'historique de sécurité.

---

## 3. Architecture

```text
app.py                  # point d'entrée : from mboa import create_app
mboa/
  __init__.py           # fabrique Flask, CSRF, expiration de session, en-têtes, serving SPA
  core.py               # constantes, base SQLite, migrations, audit chaîné, permissions, rate limiting
  auth.py               # connexion, MFA TOTP, codes de secours, reset, inscription, utilisateurs
  dashboard.py          # KPI, série, répartitions, récit, alertes, live SSE, vitrine publique
  imports_studio.py     # analyse CSV/Excel, mapping, exécution, historique, formulaires dynamiques
  partners.py           # inscription partenaire, connexion MFA, espace, validation admin, logos
  operations.py         # saisie manuelle, POS live, exports CSV/XLSX, rapport, audit, contact
frontend/
  src/pages/            # vitrine, auth, portail partenaires, application, administration
  src/components.jsx    # header, footer, Reveal, Modal, Toast, Badge, Empty, Spinner…
  src/api.js            # client fetch CSRF-aware, upload, download, formatters
  src/auth.jsx          # contexte utilisateur, permissions, logout, refresh
  src/styles/           # CSS V2 modulaire importé par v2.css
  dist/                 # build de production servi par Flask
sales.db                # ventes, users, imports, formulaires, partenaires, audit_logs…
test_api.py             # recette API V2 (72 tests)
```

Le backend est découpé en blueprints. Flask sert l'API sous `/api/*` et la SPA React pour toutes les autres routes, y compris en rafraîchissement direct.

---

## 4. Sécurité

- **Mots de passe :** pbkdf2-SHA256 600 000 itérations, politique 12 caractères minimum, contrôle des mots interdits et du login.
- **MFA TOTP :** secret aléatoire, QR de provisioning, vérification à fenêtre ±1, anti-rejeu, 10 codes de secours hachés.
- **Sessions :** cookie `HttpOnly`, `SameSite=Lax`, expiration après 30 min d'inactivité et 8 h absolues, version de session incrémentée à chaque changement de rôle, mot de passe, MFA ou désactivation.
- **CSRF :** jeton obligatoire sur toute écriture API (`POST`, `PUT`, `PATCH`, `DELETE`), généré par `/api/auth/csrf` et injecté par le client React.
- **Rate limiting :** connexions par IP et par compte, défis MFA, inscriptions, suivi partenaire, contact.
- **Verrouillage :** 5 échecs → 15 minutes ; 10 échecs → blocage définitif nécessitant un administrateur.
- **Cloisonnement :** les régions sont filtrées côté serveur selon le rôle et le périmètre, y compris pour la saisie manuelle et les exports.
- **Audit append-only :** chaque entrée contient l'empreinte SHA-256 de la précédente, l'acteur, l'IP, l'action, la ressource, le résultat et les détails. `/api/audit/verifier` recalcule toute la chaîne depuis `GENESIS`.
- **En-têtes :** `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, CSP stricte, HSTS derrière HTTPS.
- **Uploads :** 24 Mo maximum, extensions contrôlées, logos PNG/JPG/WebP limités à 2 Mo et vérifiés par signature.

---

## 5. Tableau de bord

`GET /api/dashboard` accepte `periode` (30, 90, 365, vide), `region`, `canal`, `famille`, `vendeur`, `produit` et renvoie :

- KPI : CA, marge, transactions, panier, objectif N-1 × 1,10, variations ;
- série journalière N / N-1 / objectif et saisonnalité sur 12 mois ;
- répartitions régions, canaux, familles, top produits, classement vendeurs ;
- alertes, récit automatique, ventes récentes, imports récents ;
- permissions de l'utilisateur et horodatage de mise à jour.

Le flux **SSE** `/api/live/stream` pousse la caisse du jour toutes les 6 secondes. Les écritures POS live sont datées sur la journée de référence du jeu de données pour rester visibles immédiatement.

Fonctions : filtres combinables, export CSV/XLSX, bouton « Vente POS live », drill-down vendeur, liens vers la saisie, les imports, le rapport, les utilisateurs et les partenaires.

---

## 6. Studio d'import & formulaires

Dépôt → analyse → mapping → contrôle → exécution.

- **Formats :** CSV (`;`, `,`, tabulation), `.xlsx`, `.xls` ; encodages UTF-8, UTF-8 BOM, CP1252, Latin-1.
- **Détection :** délimiteur, encodage, feuille Excel, en-têtes, mapping automatique par synonymes.
- **Contrôles :** date, région, canal, famille, devise, quantité, prix, remise, cohérence du montant à 2 %.
- **Déduplication :** référence unique ; mode « ignorer » ou « mettre à jour ».
- **Traçabilité :** empreinte SHA-256 du fichier, mapping, aperçu, rejets ligne par ligne, import annulable.
- **Exports :** modèles CSV et XLSX téléchargeables.
- **Formulaires dynamiques :** création de 1 à 30 champs métier, libellés, types, options, valeurs par défaut, aide ; soumission multi-lignes transformée en lot d'import.

Endpoints principaux : `/api/imports/analyser`, `/api/imports/executer`, `/api/imports`, `/api/imports/<id>`, `/api/imports/<id>/annuler`, `/api/imports/modele`, `/api/forms`, `/api/forms/<id>/soumettre`.

---

## 7. Portail partenaires

1. **Inscription** sur `/partenaires` : entreprise, secteur, contact, email professionnel, mot de passe fort, logo PNG/JPG/WebP (2 Mo), date et créneau de démo, consentement.
2. **Validation MFA** : mot de passe + code TOTP ou code de secours.
3. **Suivi** : lien privé `/partenaires/suivi/<token>` accessible sans session.
4. **Espace partenaire** : statut, créneau, notes, remplacement du logo, changement de mot de passe.
5. **Administration** : `/app/partenaires` — onglets statut, recherche, validation/refus, mise en avant, gestion des créneaux, notes, remplacement de logo.
6. **Synchronisation accueil** : seuls les partenaires `validé` avec logo sont exposés par `/api/partenaires/publics`. L'accueil écoute l'événement `mboa:partners`, `localStorage` et un polling de 60 s ; le logo apparaît sans redéploiement.

---

## 8. Saisie & POS

- Catalogue issu de `/api/filtres`, prix pré-rempli, quantité, remise plafonnée à 50 %, canal, région, ville, point de vente, vendeur.
- Calcul en direct du montant, de la marge estimée et du taux de marge.
- Périmètre imposé côté serveur : un commercial ne peut écrire que dans sa région.
- `POST /api/ventes-manuelle` génère une référence `TX-MAN-…` et journalise l'action.
- `POST /api/pos-push` injecte une vente simulée sur la journée de référence pour alimenter le live.

---

## 9. Rapport & exports

- `/app/rapport` : synthèse 12 mois glissants, Top 10 produits, régions, familles, marge, méthodologie, sceau SHA-256, mise en page imprimable A4.
- `GET /api/rapport` : données signées (`emp`, `horo`, période).
- `GET /api/export/csv` et `/api/export/xlsx` : exports protégés par `exports.csv`, journalisés, limités à 100 000 lignes.

---

## 10. Habilitations

| Permission | Admin | Manager | Commercial | Auditeur |
|---|:---:|:---:|:---:|:---:|
| `dashboard.view` | ✓ | ✓ | ✓ | ✓ |
| `sales.write` | ✓ | ✓ | ✓ | — |
| `imports.read` / `imports.write` | ✓ | ✓ | ✓ | lecture seule |
| `imports.cancel` | ✓ | — | — | — |
| `forms.read` / `forms.submit` | ✓ | ✓ | ✓ | lecture seule |
| `forms.manage` | ✓ | ✓ | — | — |
| `exports.csv` | ✓ | ✓ | ✓ | ✓ |
| `reports.view` | ✓ | ✓ | ✓ | ✓ |
| `audit.view` | ✓ | ✓ | — | ✓ |
| `users.manage` | ✓ | — | — | — |
| `partners.manage` / `partners.read` | ✓ | lecture | — | — |

La matrice est visible dans **Utilisateurs & habilitations** (`/api/users/matrice`). Les contrôles sont appliqués côté serveur, pas seulement dans l'interface.

---

## 11. Recette

```bat
python test_api.py
```

La recette V2 couvre 72 contrôles : vitrine publique, SPA, CSRF, MFA TOTP (bon/mauvais code), cloisonnement, dashboard, filtres, saisie manuelle, POS, exports CSV/XLSX, rapport signé, imports CSV (analyse/exécution/annulation), formulaires dynamiques, utilisateurs, matrice de permissions, chaîne d'audit et verrouillage de compte.

```text
72 TESTS PASS
```

Build frontend : `cd frontend && npm run build` → `frontend/dist`.

---

## 12. Limites & checklist de mise en production

- Pas de SMTP : les liens de réinitialisation et les notifications partenaires restent affichés dans l'interface de démonstration. Brancher un fournisseur d'email avant production.
- Base SQLite adaptée à la démonstration et aux PME ; prévoir PostgreSQL pour un déploiement multi-instances.
- Le mode démo (`MBOA_DEMO=1`) fournit le code TOTP courant : **à désactiver impérativement** en production.
- Stockage des logos sur disque local (`media/logos/`) : prévoir un stockage objet et une sauvegarde.
- Sauvegardes présentes : `app_v1_backup.py`, `frontend/src_v1_backup/`.
- Servir l'application derrière un reverse proxy HTTPS (nginx/Caddy) et activer `MBOA_COOKIE_SECURE=1`.
- Vérifier la rotation des secrets, la politique de sauvegarde de `sales.db` et la supervision des erreurs 500.

---

## 13. Incr�ment de consolidation et extensions livr�es

Cette section d�crit le travail r�alis� apr�s le premier commit de s�curisation. Toutes les fonctions ci-dessous sont op�rationnelles et couvertes par `test_extensions.py`.

### 13.1 Configuration

Toutes les variables sont d�sormais centralis�es dans `mboa/config.py` et charg�es depuis un fichier `.env` � la racine. Copiez `.env.example` vers `.env` puis remplissez les cl�s. Le d�marrage �choue imm�diatement si une cl� obligatoire manque en production. G�n�rez les secrets locaux avec :

```bat
python -m mboa.outils secret
python -m mboa.outils vapid
```

### 13.2 Authentification forte durcie

Le module `mboa/mfa.py` applique la RFC 6238 et les recommandations OWASP. Les graines TOTP sont chiffr�es avec `MBOA_MFA_KEY`. Un code accept� ne peut plus �tre rejou� : le dernier pas de temps est enregistr� et compar� de fa�on atomique. Seuls le pas courant et le pas pr�c�dent sont accept�s, avec une d�rive d horloge conserv�e par jeton. Les codes de secours utilisent un poivre serveur `MBOA_RECOVERY_PEPPER`, sont hach�s et affich�s une seule fois. La d�sactivation de la MFA est interdite aux r�les Admin, Manager et Auditeur. Les actions sensibles exigent une v�rification r�cente. Le code par email et le lien de r�initialisation sont r�ellement envoy�s.

Les passkeys WebAuthn sont disponibles avec `py_webauthn`. Le serveur exige la v�rification utilisateur et contr�le le drapeau c�t� serveur. Le bouton d enr�lement se trouve dans Mon compte et la connexion par passkey est propos�e sur la page de connexion.

### 13.3 Notifications

Le module `mboa/notifications.py` envoie les emails via l API Resend ou via SMTP Brevo selon `MBOA_MAIL_PROVIDER`. Les envois passent par une table outbox avec trois reprises en back-off. Les notifications Web Push utilisent VAPID avec `pywebpush`. Le service worker est servi depuis `/sw.js`. Un badge de cloche affiche les notifications in-app dans l espace client.

Proc�dure Resend : cr�ez un compte sur resend.com, ajoutez et v�rifiez votre domaine dans Domains, cr�ez une cl� dans API keys avec l autorisation Sending access, copiez la valeur dans `RESEND_API_KEY`, puis renseignez `MBOA_MAIL_FROM` avec une adresse du domaine v�rifi�.

Proc�dure Brevo : ouvrez Settings puis SMTP et API, cr�ez une cl� SMTP, relevez le login SMTP affich�, puis renseignez `MBOA_MAIL_PROVIDER=smtp`, `BREVO_SMTP_LOGIN` et `BREVO_SMTP_KEY`.

Proc�dure VAPID : ex�cutez `python -m mboa.outils vapid` et copiez les trois lignes affich�es dans `.env`.

### 13.4 Connecteurs et ETL

Le module `mboa/etl.py` impl�mente des connecteurs REST avec OAuth2, cl� API ou basic auth, CSV distant, SFTP, dossier local, Excel et PDF. Le moteur de transformation reprend la logique de Power Query : s�lection et renommage de colonnes, filtres, colonnes calcul�es, changement de type, suppression de lignes et mapping vers le sch�ma de ventes. Chaque ex�cution est journalis�e dans `connector_runs`. Les endpoints sont `/api/connecteurs`, `/api/connecteurs/tester`, `/api/connecteurs/<id>/sync` et `/api/etl/etapes`. L extraction PDF est disponible via `/api/pdf/extraire`.

### 13.5 Donn�es et temps r�el

Le multiplicateur d objectif de 10 pour cent est remplac� par une table `objectifs` administrable via `/api/objectifs`. Le flux SSE ne pousse plus une table fig�e : il lit la table `evenements` aliment�e par les ventes, les imports et les synchronisations, avec un battement toutes les quinze secondes et un horodatage serveur. Les donn�es publiques de la vitrine ne exposent plus le produit ni le montant des ventes. La requ�te produits de `/api/filtres` respecte d�sormais le p�rim�tre. Les sessions partenaires sont soumises � la m�me expiration et � la m�me v�rification de version que les sessions utilisateurs. Les limites de d�bit sont persist�es en base.

### 13.6 Alertes et rapports

Les r�gles d alerte se configurent via `/api/alert-rules` avec indicateur, op�rateur, seuil, r�gion et criticit�. Le moteur applique un anti-rebond d une heure, envoie les alertes par email et SMS pour la criticit� haute, et cr�e des notifications in-app. Le rapport hebdomadaire est envoy� via `python -m mboa.outils rapport-hebdo`. L export d audit PDF est disponible via `/api/audit/export-pdf` avec une signature HMAC dans l en-t�te `X-Signature`.

### 13.7 Recette

```bat
python test_api.py
python test_extensions.py
```

La premi�re suite couvre 72 contr�les, la seconde 21 contr�les portant sur les nouvelles fonctions.
