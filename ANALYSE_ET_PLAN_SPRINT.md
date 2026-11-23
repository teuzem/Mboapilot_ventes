# MboaPilot SASV : analyse de l'existant et plan du prochain incrément

Document de travail établi le 23 novembre 2026. Il sert de base à la planification du prochain sprint. Il ne modifie aucun fichier de l'application.

## 1. Périmètre de l'analyse

Ont été lus intégralement le product backlog et la charte d'équipe, les cinq blueprints Flask, la fabrique applicative, le noyau de sécurité, le client React et ses vingt six pages, la suite de tests, le générateur de données et le schéma SQLite réel. Une recherche documentaire a été menée sur OWASP, NIST SP 800-63B-4, RFC 6238, PyOTP, py_webauthn et passkeys.dev, ainsi que sur les procédures d'obtention des clés Resend et Brevo.

Les trois chantiers écartés par consigne sont exclus de la liste du sprint : les connexions à des applications externes pour la collecte des ventes, l'extraction de données depuis un PDF, et la PWA. Ils restent mentionnés quand leur absence explique un comportement observé, mais aucune tâche correspondante n'est proposée ici.

## 2. État réel du projet

MboaPilot est une application Flask et React qui fonctionne. Le serveur expose cinq blueprints et une trentaine d'endpoints. Le frontend est un build Vite servi par Flask. La base `sales.db` contient 46 949 lignes de ventes, 5 comptes utilisateurs, 10 partenaires, 5 imports et 375 entrées d'audit. La table des ventes couvre la période du 1er octobre 2024 au 6 novembre 2026.

Ce qui est réel et vérifiable : la connexion avec mot de passe haché en PBKDF2 SHA-256 à 600 000 itérations, le défi TOTP, les codes de secours hachés, le jeton CSRF sur toutes les écritures API, l'expiration de session, la matrice de permissions côté serveur, le filtrage par région, la chaîne d'audit avec empreinte SHA-256, l'analyse et l'exécution des imports CSV et Excel, la saisie manuelle, les exports CSV et XLSX, la gestion des utilisateurs, le portail partenaires et la génération du rapport.

Ce qui est réel dans la mécanique mais faux dans le fond : les 46 946 lignes de ventes initiales proviennent de `generate_data.py`, avec une graine fixe `random.seed(20261013)`, une croissance de 35 pour cent imposée et des coefficients de saisonnalité codés en dur. Les coûts unitaires sont inventés à partir de six taux de marge constants. Les objectifs affichés valent systématiquement la valeur de l'an passé multipliée par 1,10. Les neuf partenaires historiques sont insérés au démarrage par `migrate()` avec des emails et des téléphones fabriqués.

La recette automatisée ne protège pas l'incrément. `test_api.py` exécute 72 contrôles avec un `assert` qui interrompt tout dès le premier échec, et il écrit dans la vraie base `sales.db` sans isolation. Beaucoup de contrôles se contentent du code 200. `test_vitrine.py` ne contient aucun `assert` et ne peut donc rien détecter. Le portail partenaires, le flux SSE, les endpoints détaillés du tableau de bord, les parcours de réinitialisation, les codes de secours, les en-têtes de sécurité et l'expiration de session ne sont pas couverts.

L'état git est le risque de livraison le plus immédiat. Le dépôt ne contient qu'un seul commit, `1c75966 Premier sprint gestion de projets`. Tout le package `mboa/`, qui est la refonte V2 entière, est encore non suivi. Les nouvelles pages React, le dossier `styles/`, les logos uploadés et `.mboa_secret` sont également hors commit. L'arbre de travail contient de nombreux fichiers modifiés. Dans cet état, la démonstration fonctionne sur la machine locale mais ne peut pas être reconstruite à partir du dépôt.

## 3. Ce qui est simulé et où

Le tableau suivant recense les simulacres constatés dans le code. Les références de lignes permettent de vérifier chaque affirmation.

| Élément | Preuve dans le code | Effet visible |
| --- | --- | --- |
| Flux temps réel SSE | `dashboard.py` lignes 426 à 443 : boucle de 60 fois `time.sleep(6)`, relecture de la même table, `event: end` au bout de six minutes | Le tableau de bord affiche un flux « live » qui ne détecte aucun changement et se coupe tout seul |
| Vente POS live | `operations.py` lignes 85 à 106 : `ORDER BY RANDOM()`, `random.choice`, référence aléatoire, écriture avec `source='pos-live'` | Une transaction inventée est inscrite dans les ventes et modifie les KPI sans limitation de débit |
| Coût unitaire | `core.py` lignes 91 et 92, `operations.py` ligne 77, `imports_studio.py` ligne 272 | Toute la marge affichée repose sur un coût calculé et non sur un coût d'achat constaté |
| Objectif commercial | `dashboard.py` lignes 104, 131, 151, 166 et 476 | Aucun objectif réellement défini, toujours N-1 plus 10 pour cent |
| Vitrine publique | `dashboard.py` lignes 479 et 508 à 520 | Les six ou huit dernières ventes avec leurs montants sont exposées sans authentification |
| OTP partenaire | `partners.py` ligne 49 : `audit(..., "email-simule", ...)`, ligne 198 message affirmant l'envoi, lignes 199 et 200 `code_demo` dans la réponse | Le code est livré au client en mode démo, et personne ne le reçoit par email en production |
| OTP de secours utilisateur | `auth.py` lignes 281 à 298 : `audit(..., "email-simule", ...)`, code stocké en clair dans `mfa_codes` | Le fallback email est inutilisable en production |
| Lien de réinitialisation | `auth.py` lignes 410 et 411, `Reset.jsx` ligne 59 | Le lien est affiché à l'écran au lieu d'être envoyé |
| Partenaires de démonstration | `core.py` lignes 247 à 267, avec le commentaire ligne 247 qui affirme le contraire | Le mur de logos est rempli de neuf fausses entreprises |
| Notifications métier | `partners.py` lignes 198, 349 et `operations.py` ligne 247 | Les messages promettent un envoi ou une réponse sous 24 heures alors qu'aucun service de messagerie n'existe |
| Chaîne d'audit de la landing | `Landing.jsx` lignes 575 à 587, hachage arithmétique `(0x9f3a2b + i * 7919).toString(16)` | Démonstration visuelle sans rapport avec la vraie chaîne vérifiée dans `Audit.jsx` |
| Fenêtres de démonstration | `Landing.jsx` lignes 206 à 213 et 310 à 371 | Chiffres codés en dur et bouton « Importer » sans gestionnaire ligne 325 |
| Panneau sessions du compte | `Compte.jsx` lignes 307 à 329 | Liste statique de protections, aucun endpoint de listing des sessions |
| Marge estimée à la saisie | `Saisie.jsx` lignes 22 à 25 | duplication des taux de marge du backend dans le navigateur |

Le mode démo est actif par défaut puisque `core.py` ligne 28 lit `MBOA_DEMO` avec « 1 » comme valeur par défaut. C'est la cause directe de la plupart des fuites de codes de vérification vers le client.

## 4. Lacunes du système MFA

Cette section détaille le point le plus important du sprint. Le code contient une base saine, mais plusieurs éléments annoncés dans le README et le backlog ne sont pas tenus.

### 4.1 Le TOTP est réel

`auth.py` utilise PyOTP avec `provisioning_uri`, `random_base32` et `verify(code, valid_window=1)`. Le secret est généré à l'inscription et à chaque enrôlement. Le QR code est produit par `qrcode` et servi par `/api/auth/mfa/qr`. La vérification accepte un écart d'une fenêtre, soit environ 90 secondes au total. Les codes de secours sont générés par lots de dix et hachés avec SHA-256.

### 4.2 L'anti-rejeu annoncé n'existe pas

Le README affirme « anti-rejeu » ligne 92. PyOTP ne conserve aucun état entre deux vérifications. Un code TOTP accepté peut donc être rejoué pendant toute sa fenêtre de validité, soit jusqu'à 90 secondes. La RFC 6238 section 5.2 et OWASP demandent de stocker le dernier pas de temps accepté et de rejeter ce pas et tous les pas antérieurs, avec une mise à jour atomique pour qu'une seconde instance ne puisse pas accepter le même code. Rien de tel dans `users` ni dans une table dédiée.

### 4.3 L'obligation par rôle n'est jamais appliquée

`core.py` ligne 29 définit `MFA_OBLIGATOIRE` à partir de `MBOA_MFA`. Une recherche sur tout le projet ne trouve aucune autre occurrence de cette variable. La user story US-202 impose le MFA aux rôles Admin, Manager et Auditeur. Le seul contrôle existant est dans `api_mfa_desactiver` ligne 520, qui refuse la désactivation à un Admin uniquement quand `DEMO` vaut faux. Un Manager ou un Auditeur peut désactiver sa MFA en production, et un Admin peut le faire en mode démo.

### 4.4 Le replay par email est une coquille vide

`api_mfa_demande` génère un code à six chiffres, l'insère en clair dans `mfa_codes`, écrit une trace intitulée `email-simule`, et ne renvoie le code au client que si `DEMO` est vrai. En production, aucun service n'envoie ce code. Un utilisateur qui perd son authenticator est donc bloqué, sauf intervention manuelle d'un administrateur. Le même défaut touche le portail partenaire.

### 4.5 Les codes de secours sont fragiles et inutilisables pour les comptes de démonstration

`_hash_code` ligne 35 utilise un SHA-256 avec un préfixe constant et aucun sel ni poivre serveur. Avec dix caractères hexadécimaux, soit quarante bits, une personne ayant accès à la base peut retrouver les codes par recherche exhaustive. Les cinquante codes présents en base appartiennent aux cinq comptes de démonstration et leurs valeurs en clair n'ont jamais été affichées. Le champ `recovery_disponible` annonce donc une option qui ne peut pas être utilisée.

### 4.6 Les secrets TOTP sont stockés en clair

La colonne `mfa_secret` de `users` contient la graine en texte brut. OWASP recommande de chiffrer les graines avec une clé détenue par un service de gestion de clés et de ne les déchiffrer qu'au moment de la vérification. Le projet n'a pas de KMS, mais un chiffrement local avec une clé fournie par l'environnement est déjà un progrès net et sans dépendance nouvelle, puisque `cryptography` est disponible.

### 4.7 Aucune authentification renforcée sur les actions sensibles

OWASP cite explicitement le changement de mot de passe, le changement d'email, la désactivation de la MFA et l'élévation de privilège comme des actions qui doivent exiger une vérification récente. Ici, ces actions demandent le mot de passe courant, parfois un code TOTP, mais jamais une preuve MFA récente liée à la session. Une session volée peut donc modifier les facteurs de sécurité.

### 4.8 Aucune option résistante au phishing

NIST SP 800-63B-4 exige au niveau AAL2 qu'au moins une option résistante au phishing soit proposée, et considère les passkeys synchronisées comme conformes si le drapeau de vérification utilisateur est validé côté serveur. Le projet ne propose que TOTP, qui reste vulnérable aux relais en temps réel. Le backlog ne mentionne pas WebAuthn, mais la demande porte sur un système MFA avancé, et la bibliothèque py_webauthn de Duo Labs est maintenue et utilisable avec Flask.

### 4.9 La session n'est pas régénérée au changement de privilège

`api_login` prépare un défi sans effacer une session éventuellement déjà authentifiée. Entre le défi et la confirmation, l'ancien contexte reste actif. Le jeton CSRF est conservé par `_ouvrir_session` ligne 121 et 124. Il faut vider la session au début de la tentative de connexion et renouveler le jeton CSRF quand l'utilisateur devient authentifié.

### 4.10 Aucune notification de sécurité

Un changement de MFA, une régénération de codes de secours ou un échec répété ne déclenche aucun email. OWASP demande une notification hors bande pour toute modification de facteur et l'affichage de l'heure, du navigateur et de la localisation lors d'une connexion suspecte. Rien n'existe aujourd'hui.

### 4.11 Le verrouillage et le déverrouillage restent artisanais

Cinq échecs donnent quinze minutes et dix échecs un blocage définitif, ce qui correspond à US-206. Mais le compteur est remis à zéro dès que le mot de passe est correct, avant la vérification MFA. Une attaque par force brute sur le second facteur n'est donc limitée que par le compteur de session et la limite en mémoire, elle-même perdue au redémarrage.

## 5. Ce que la recherche impose comme cible

Les sources retenues sont les suivantes. La fiche OWASP Multifactor Authentication, la publication NIST SP 800-63B-4 du 31 juillet 2025, la RFC 6238, la documentation PyOTP, le dépôt duo-labs/py_webauthn et le guide passkeys.dev.

Les points concrets à reprendre : exiger un MFA pour tous les utilisateurs et l'imposer aux comptes privilégiés ; conserver les graines TOTP chiffrées et ne jamais les renvoyer après l'enrôlement ; accepter le pas courant et au plus un pas précédent ; enregistrer la dérive d'horloge par jeton plutôt que d'élargir la fenêtre pour tout le monde ; rejeter un code déjà accepté ; donner aux codes à usage unique une durée courte, un usage unique, une limite de tentatives et les hacher ; proposer des passkeys avec vérification utilisateur obligatoire et contrôler le drapeau serveur ; prévenir l'utilisateur de tout changement de facteur ; prévoir une procédure de récupération qui ne soit pas plus faible que l'authentification normale ; ne jamais utiliser le SMS comme seul facteur pour des données sensibles.

Pour le frontend WebAuthn, la voie recommandée est py_webauthn côté serveur avec `@simplewebauthn/browser` côté navigateur, ou l'appel direct à `navigator.credentials.create()` et `get()` comme le montre passkeys.dev. L'identifiant `rp_id` et l'origine doivent être configurables, et l'HTTPS est obligatoire hors localhost.

## 6. Inventaire des extensions du sprint

Les identifiants EXT sont nouveaux. La colonne backlog rappelle la user story concernée quand elle existe. La colonne sprint indique si la tâche est proposée dans l'incrément de demain ou remise à plus tard. Les efforts sont en jours de travail et supposent deux développeurs.

| ID | Extension | Backlog | Sprint | Effort |
| --- | --- | --- | --- | --- |
| EXT-01 | Appliquer l'obligation MFA par rôle et supprimer le contournement démo | US-202 | oui | 0,5 |
| EXT-02 | Anti-rejeu TOTP avec dernier pas accepté et mise à jour atomique | US-202 | oui | 1 |
| EXT-03 | Fenêtre courante et pas précédent seulement, dérive d'horloge par jeton | US-202 | oui | 0,5 |
| EXT-04 | Chiffrement des graines TOTP avec clé d'environnement | US-202 | oui | 0,5 |
| EXT-05 | Codes de secours avec poivre serveur, affichage unique et notification | US-202 | oui | 1 |
| EXT-06 | Remplacement du fallback email simulé par un envoi réel | US-202, US-205 | oui | 1,5 |
| EXT-07 | Authentification renforcée sur mot de passe, email et facteurs MFA | US-202 | oui | 1 |
| EXT-08 | Régénération de session et rotation CSRF à la connexion | US-201 | oui | 0,5 |
| EXT-09 | Notifications de sécurité par email avec heure, IP et navigateur | US-202, US-501 | oui | 1 |
| EXT-10 | Passkeys WebAuthn avec py_webauthn et vérification utilisateur | extension | oui | 3 |
| EXT-11 | Service d'email transactionnel et table outbox avec reprises | US-205, US-306 | oui | 2 |
| EXT-12 | Envoi des liens de reset et suppression de l'affichage démo | US-205 | oui | 0,5 |
| EXT-13 | Suppression des coûts inventés et statut « marge non calculée » | qualité donnée | oui | 1 |
| EXT-14 | Table d'objectifs éditable à la place du multiplicateur 1,10 | US-301 | oui | 1 |
| EXT-15 | Refonte du flux SSE sur événements réels avec horodatage serveur | US-301 | oui | 1 |
| EXT-16 | Retrait des ventes récentes des endpoints publics vitrine | OM2 | oui | 0,5 |
| EXT-17 | Périmètre appliqué à la requête produits de `/api/filtres` | US-204 | oui | 0,25 |
| EXT-18 | Expiration et version de session pour les partenaires | US-201, US-204 | oui | 0,5 |
| EXT-19 | Invalidation des sessions partenaires au changement de mot de passe | US-205 | oui | 0,25 |
| EXT-20 | Contrôles d'existence et d'appartenance sur demo, forms et annulation d'import | US-203 | oui | 0,5 |
| EXT-21 | Limitation de débit persistante et protection de `ventes-manuelle` et `pos-push` | US-206 | oui | 0,5 |
| EXT-22 | Règles d'alerte No-Code et moteur d'évaluation | US-401 | oui | 3 |
| EXT-23 | Alertes par email avec anti-rebond d'une heure | US-402 | oui | 1 |
| EXT-24 | Notifications in-app, badge, panneau et marquage lu | US-403 | oui | 2 |
| EXT-25 | Historique des alertes avec filtres et export CSV | US-404 | oui | 1 |
| EXT-26 | Rapport hebdomadaire envoyé le lundi à 7 heures | US-306 | oui | 1,5 |
| EXT-27 | Comparaison N et N-1 sur tous les KPI | US-307 | oui | 1 |
| EXT-28 | Recherche d'audit filtrée, paginée et exports CSV et PDF | US-504 | oui | 2 |
| EXT-29 | Signature stable du rapport par HMAC du contenu canonique | US-304, US-505 | oui | 0,5 |
| EXT-30 | Rapport d'audit complet signé | US-505 | différé | 2 |
| EXT-31 | Rétention cinq ans et archivage à treize mois | US-506 | différé | 1,5 |
| EXT-32 | Détection des comportements d'accès anormaux | US-507 | différé | 2 |
| EXT-33 | Aide contextuelle sur chaque page et FAQ de vingt entrées | US-701, US-705 | différé | 2 |
| EXT-34 | Notification SMS pour alertes de criticité haute | US-405 | différé | 1,5 |
| EXT-35 | Export de l'annuaire utilisateur et historique des modifications | US-207 | différé | 1 |
| EXT-36 | Câblage de l'événement `mboa:sale` et bouton Importer de la landing | qualité frontend | oui | 0,25 |
| EXT-37 | Persistance des filtres du tableau de bord dans l'URL | US-302 | oui | 0,5 |
| EXT-38 | Suppression des graines de démonstration du chemin de production | qualité | oui | 0,5 |
| EXT-39 | Mise sous git de la refonte V2 et mise à jour du `.gitignore` | livraison | oui | 0,25 |
| EXT-40 | Suite de tests isolée sur base temporaire avec assertions sur valeurs métier | recette | oui | 1 |
| EXT-41 | Recette MFA négative : rejeu, fenêtre, obligation par rôle, codes de secours | US-202 | oui | 1 |
| EXT-42 | Correction du générateur de données : cohérence région et point de vente, docstring, schéma CSV, non destruction de la base | qualité donnée | différé | 0,5 |
| EXT-43 | Retrait de l'affichage de `mfa_secret` dans `_inspect.py` | OM2 | oui | 0,1 |

La somme des tâches marquées « oui » tourne autour de trente trois jours de travail, soit seize jours calendaires à deux développeurs. C'est au dessus de la vélocité cible de vingt cinq à trente story points par sprint. Le plan ci dessous propose donc un découpage en deux vagues, avec la vague A comme incrément à livrer aujourd'hui.

## 7. Plan d'implémentation

### Vague A, incrément à livrer

L'objectif de la vague A est de rendre l'authentification et les données réellement fiables, puis d'ajouter les notifications qui rendent les promesses de l'interface vraies.

Lot 0, mise sous version et hygiène. Commiter tout le package `mboa/` et les nouveaux fichiers React avant toute modification. Ajouter `sales.db`, `.mboa_secret`, `uploads/` et `frontend/dist/` au `.gitignore`. Corriger le chemin Node codé en dur de `BUILD_FRONT.bat`. Masquer la graine TOTP dans `_inspect.py`. Livrable : un dépôt à partir duquel l'application peut être reconstruite. Dépendance : aucune. Ce lot doit être exécuté en premier.

Lot 1, configuration et démarrage. Créer `.env.example`, charger les variables avec `python-dotenv` dans `app.py`, faire échouer le démarrage si `MBOA_ENV=production` et qu'une clé obligatoire manque, forcer `MBOA_DEMO=0` et `MBOA_COOKIE_SECURE=1` en production. Déplacer l'amorçage des comptes et partenaires de démonstration dans un script `seed_demo.py` appelé seulement en démo. Livrable : une commande de démarrage propre en production et en développement. Dépendance : lot 0.

Lot 2, MFA durci. Modifier le schéma avec trois colonnes `mfa_last_step`, `mfa_drift` et `mfa_secret_enc`, puis écrire `mboa/mfa.py` avec chiffrement Fernet, vérification du pas courant et du pas précédent, rejet des pas déjà utilisés, et dérive enregistrée par jeton. Réécrire les graines existantes au premier démarrage. Refuser la désactivation aux rôles Admin, Manager et Auditeur sans condition de démo. Remplacer le poivre constant des codes de secours par `MBOA_RECOVERY_PEPPER` et les afficher une seule fois. Ajouter le décorateur `@step_up_required` avec une fenêtre de cinq minutes. Vider la session et renouveler le CSRF dans `api_login` et `_ouvrir_session`. Livrable : les huit premières extensions. Dépendance : lot 1.

Lot 3, messagerie. Créer `mboa/notifications.py` avec un fournisseur Resend par défaut et un mode SMTP Brevo en alternative, une table `notifications` en outbox, une fonction d'envoi avec trois reprises en back-off, et une commande `python -m mboa.worker` pour le traitement en production. Remplacer les six zones `email-simule` par de vrais envois. Supprimer le `code_demo` de toutes les réponses quand `DEMO` vaut faux. Livrable : EXT-06, EXT-09, EXT-11 et EXT-12. Dépendance : lot 1 et clés email.

Lot 4, passkeys. Ajouter `webauthn` aux dépendances Python et `@simplewebauthn/browser` au frontend. Créer la table `webauthn_credentials`, les cinq endpoints d'enrôlement et d'authentification, le stockage des challenges en session avec durée de vie courte et usage unique, le contrôle du compteur de signature et le contrôle serveur du drapeau `user_verification`. Ajouter le bouton d'enrôlement dans `Compte.jsx` et l'autocomplétion `username webauthn` dans `Login.jsx`. Livrable : EXT-10. Dépendance : lots 1 et 2, et origine HTTPS configurée.

Lot 5, vérité des données. Créer la table `objectifs`, la table `sales_events` et le service d'évaluation des objectifs. Remplacer les multiplicateurs 1,10 par une lecture en base avec valeur par défaut explicitement étiquetée indicatif. Ne plus inventer `cout_unit`, afficher « marge non calculée » quand le coût manque. Réécrire le générateur SSE pour ne pousser que les événements nouveaux avec un horodatage serveur. Retirer les ventes récentes des endpoints publics. Corriger `/api/filtres`, les sessions partenaires, les contrôles d'existence et les limites de débit. Livrable : EXT-13 à EXT-21, EXT-36 à EXT-38. Dépendance : lot 1.

Lot 6, alertes. Créer les tables `alert_rules`, `alert_events` et `notifications`, l'interface No-Code, l'évaluateur déclenché après chaque import et chaque vente, l'anti-rebond d'une heure, le badge de cloche et l'historique exportable. Livrable : EXT-22 à EXT-25. Dépendance : lots 3 et 5.

Lot 7, reporting. Envoyer le rapport hebdomadaire le lundi à 7 heures avec la messagerie, compléter la comparaison N et N-1, remplacer l'empreinte du rapport par un HMAC calculé sur un contenu canonique sans horodatage, ajouter la recherche d'audit paginée et les exports. Livrable : EXT-26 à EXT-29. Dépendance : lots 3 et 5.

### Vague B, après l'incrément

Les extensions EXT-30 à EXT-35 sont documentées et prêtes à être affinées, mais elles ne sont pas dans le sprint. Elles concernent le rapport d'audit, la rétention réglementaire, la détection d'anomalies, l'aide en ligne, le SMS et l'annuaire. Le SMS restera un facteur restreint au sens de NIST et ne servira jamais de seul mécanisme de récupération.

## 8. Configuration et récupération des clés

Le fichier `.env` se place à la racine de `MboaPilot_Sprint1`. Il est déjà ignoré par Git dans le frontend, il faut ajouter la même règle à la racine. Le fichier `.env.example` suivant sera créé avec des valeurs vides.

```text
MBOA_ENV=development
MBOA_PORT=5000
MBOA_DEBUG=0
MBOA_SECRET=
MBOA_DEMO=1
MBOA_COOKIE_SECURE=0
MBOA_SESSION_MINUTES=30
MBOA_SESSION_MAX_HOURS=8
MBOA_MFA=1
MBOA_MFA_KEY=
MBOA_RECOVERY_PEPPER=
MBOA_RP_ID=localhost
MBOA_ORIGIN=http://localhost:5000
MBOA_MAIL_PROVIDER=resend
RESEND_API_KEY=
MBOA_MAIL_FROM=onboarding@resend.dev
MBOA_MAIL_FROM_NAME=MboaPilot
MBOA_ADMIN_EMAILS=
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_LOGIN=
BREVO_SMTP_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_MESSAGING_SID=
```

Les trois secrets locaux se génèrent en ligne de commande. Pour la clé de chiffrement des graines :

```bat
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Pour le poivre des codes de secours et la clé de signature des sessions :

```bat
python -c "import secrets; print(secrets.token_hex(32))"
```

La procédure Resend, recommandée par défaut. Créer un compte sur resend.com. Ajouter et vérifier un domaine dans la rubrique Domains en copiant les enregistrements DNS fournis. Ouvrir la rubrique API keys, cliquer sur Create API Key, donner un nom, choisir l'autorisation Sending access et éventuellement limiter la clé au domaine vérifié. Copier la clé affichée une seule fois dans `RESEND_API_KEY`. Renseigner `MBOA_MAIL_FROM` avec une adresse du domaine vérifié. Le plan gratuit autorise trois mille emails par mois et cent par jour, ce qui couvre largement la recette.

La procédure Brevo, en alternative SMTP. Créer un compte sur brevo.com. Ouvrir le menu du profil puis Settings, SMTP et API. Dans l'onglet SMTP, créer une clé SMTP et conserver la clé affichée. Relever également le login SMTP indiqué sur la même page, qui peut être l'email du compte ou une adresse générée. Positionner `MBOA_MAIL_PROVIDER=smtp`, `BREVO_SMTP_LOGIN` et `BREVO_SMTP_KEY`. Le serveur est `smtp-relay.brevo.com` sur le port 587 avec STARTTLS. Le plan gratuit autorise trois cents emails par jour.

La procédure Twilio, uniquement pour la vague B. Ouvrir la console Twilio, relever l'Account SID et l'Auth Token dans le tableau de bord, créer un Messaging Service ou acheter un numéro, puis copier l'identifiant du service dans `TWILIO_MESSAGING_SID`. Le consentement exigé par la loi 2024/017 doit être enregistré avant tout envoi. Aucun envoi SMS n'est prévu dans la vague A.

Pour WebAuthn, aucune clé tierce n'est nécessaire. En développement, `MBOA_RP_ID=localhost` et `MBOA_ORIGIN=http://localhost:5000` suffisent. En production, `MBOA_RP_ID` doit être le nom de domaine nu et `MBOA_ORIGIN` l'URL exacte avec HTTPS. Les navigateurs refusent WebAuthn sur une origine non sécurisée, sauf localhost.

## 9. Recette et définition de fini

La suite actuelle couvre les parcours principaux avec 72 contrôles répartis sur la vitrine, la SPA, le CSRF, l'authentification, le tableau de bord, la saisie, les exports, les imports, les formulaires, les utilisateurs, l'audit et le verrouillage. Quelques assertions sont solides : le montant en base après saisie manuelle est comparé au calcul attendu, le périmètre forcé à Littoral est vérifié en base, la chaîne d'audit doit être valide et la matrice doit contenir exactement quatre rôles. Beaucoup d'autres se limitent au code 200. Un simulacre bien construit renvoyant des valeurs constantes plausibles passerait une grande partie de la recette. `test_vitrine.py` ne pose aucune assertion.

Les zones sans couverture sont le portail partenaires dans son ensemble, le flux SSE, les endpoints `/api/kpis`, `/api/serie`, `/api/repartitions`, `/api/mensuel`, `/api/recit` et `/api/ventes/recentes`, les parcours `mfa-demande`, `mfa/qr`, `mfa/activer`, `mfa/confirmer-activation`, `mfa/desactiver`, `mfa/codes-secours`, `inscription`, `reset-request`, `reset-use`, `auth/security` et `auth/password`, les limites de débit, l'expiration de session, les en-têtes de sécurité, l'import Excel réel et le comportement du frontend.

La première tâche de recette est donc de rendre la suite fiable : base SQLite temporaire créée en début de parcours, jeu minimal indépendant de `sales.db`, fonction `check()` qui collecte les échecs au lieu d'interrompre tout, et suppression des dépendances au mode démo pour les scénarios de production. Les contrôles à ajouter pour la vague A sont les suivants. Un code TOTP accepté une première fois doit être refusé lors d'un second envoi dans la même fenêtre. Un code de la fenêtre précédente doit être accepté une seule fois et un code de deux fenêtres antérieures refusé. Un Manager et un Auditeur doivent se voir refuser la désactivation de leur MFA en production. Un code de secours utilisé ne doit pas pouvoir servir deux fois. La requête `/api/auth/demo-secrets` doit répondre 403 avec `MBOA_DEMO=0`. Le champ `code_demo` ne doit apparaître dans aucune réponse avec `MBOA_DEMO=0`. Un changement de mot de passe doit invalider les sessions partenaires. Une vente publiée doit apparaître dans le flux SSE avec un horodatage serveur. Les endpoints vitrine ne doivent plus exposer de montants de ventes. Un import doit déclencher au plus une alerte par règle et par heure.

La définition de fini reste celle de la charte : code relu par un autre membre, contrôle d'accès vérifié, documentation minimale écrite et incrément démontrable en revue de sprint. J'ajoute deux conditions pour ce sprint : toute fonction d'envoi doit être testée avec un destinataire réel ou un serveur SMTP local, et toute valeur précédemment simulée doit être soit supprimée, soit clairement étiquetée comme simulation dans l'interface.

## 10. Décisions à confirmer avant le démarrage

Trois points nécessitent votre validation. Le premier concerne le découpage : la vague A représente seize jours calendaires à deux développeurs et dépasse la capacité habituelle d'un sprint de deux semaines. Il faut soit confirmer deux développeurs à temps plein, soit retenir les lots 1 à 3 comme incrément de demain et reporter les lots 4 à 7. Le deuxième point concerne le fournisseur d'email, Resend ou Brevo, sachant que le code prévoit les deux. Le troisième point concerne l'objectif de production : si la démonstration du jury doit rester sans clés externes, il faut conserver un mode démo explicite mais le rendre visible dans l'interface et le rendre impossible à activer par défaut.
