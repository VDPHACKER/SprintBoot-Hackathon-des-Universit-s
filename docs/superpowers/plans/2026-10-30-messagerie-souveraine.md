# Messagerie souveraine de l'administration : plan d'implémentation

> **Pour les agents d'exécution :** utiliser superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans, tâche par tâche. Les étapes utilisent des cases `- [ ]`.

**Objectif :** livrer un prototype de messagerie chiffrée de bout en bout, enrôlement fermé, révocation immédiate, avec classification des messages, accusé de lecture probant et interface en mooré, plus le dossier de candidature complet, avant le 1er novembre 2026.

**Architecture :** Synapse (non modifié, fédération coupée) derrière Caddy, Keycloak pour l'identité (OIDC, TOTP, rôles), un service d'administration qui orchestre enrôlement et révocation, et un client web TypeScript écrit sur `matrix-js-sdk`. Le chiffrement n'a lieu que dans le navigateur.

**Stack :** Docker Compose, Synapse, PostgreSQL, Caddy, Keycloak, Node 24 + TypeScript, Vite, `matrix-js-sdk` (crypto Rust/WASM), Fastify, Vitest.

**Spec :** `docs/superpowers/specs/2026-10-30-messagerie-souveraine-design.md`

## Contraintes globales

- Licence du dépôt : AGPL-3.0-or-later, fichier `LICENSE` à la racine. Chaque technologie est citée avec sa licence et son lien dans `THIRD-PARTY.md`.
- Installation en une commande : `docker compose up -d`. Aucun appel sortant, aucun service tiers.
- Aucune cryptographie écrite par l'équipe. Les seules opérations de crypto autorisées passent par `matrix-js-sdk` ou une bibliothèque Matrix maintenue. Le hachage SHA-256 de l'accusé de lecture passe par `crypto.subtle.digest` (hachage standard, pas de chiffrement).
- Synapse : `enable_registration: false`, `encryption_enabled_by_default_for_room_type: all`, `url_preview_enabled: false`, présence désactivée, `federation_domain_whitelist: []`.
- Niveaux de classification : `normal`, `restreinte` (Diffusion restreinte), `confidentiel`. Rôles : `admin`, `chef_de_service`, `agent`.
- Données et comptes fictifs uniquement.
- Avant d'écrire du code qui dépend d'une API (Synapse, Keycloak, `matrix-js-sdk`), vérifier la documentation de la version épinglée avec Context7. Épingler les versions exactes et les consigner dans `THIRD-PARTY.md` (tâche 2).
- Hôtes et ports : chat et API sur `http://localhost:8080`, Keycloak sur `http://auth.localhost:8081`. Windows ne résout pas `*.localhost` hors navigateur : les tests Node n'utilisent que `localhost:8080`. Le conteneur Synapse atteint `auth.localhost` par un alias de réseau Docker sur le service Caddy. `server_name` Synapse : `chat.localhost`.

## Points de contrôle de vérification (Review Focus)

Entrées ou conditions que la spec laisse implicites et qui peuvent mettre le logiciel en défaut, du plus probable au moins probable. Chaque ligne a son test dans la tâche indiquée.

1. Un message à expiration alors que l'expéditeur est hors ligne : les destinataires doivent quand même le masquer (tâche 10).
2. Un agent révoqué avec l'application encore ouverte : le client doit purger son stockage local et revenir à l'écran de connexion, sans afficher de message d'erreur technique (tâche 8).
3. Le même agent ouvre une instruction sur deux appareils ou la rouvre : un seul accusé compté (tâche 11).
4. Caractères mooré (`ɛ`, `ɩ`, `ʋ`, `ã`, `ĩ`) dans les messages et l'interface : conservés à l'identique après aller-retour (tâche 12).
5. Fichier vide, fichier trop gros, nom de fichier accentué : refus clair pour les deux premiers, nom conservé pour le troisième (tâche 7).

## Calendrier et ordre de sacrifice

Jour 1 (30 oct) : tâches 1 à 5. Jour 2 (31 oct) : tâches 6 à 11. 1er nov : tâches 12 à 14 et dépôt. Si le retard s'installe, abandonner dans cet ordre : messages vocaux (tâche 12, partie B), rapport de preuve imprimable (tâche 11, étape 7), interface en mooré (tâche 12, partie A). Ne jamais sacrifier les tâches 2, 4, 6, 8, 13, 14.

## Structure des fichiers

```
LICENSE, README.md, THIRD-PARTY.md, .env.example, compose.yaml
deploy/synapse/homeserver.yaml.tmpl     configuration Synapse durcie
deploy/caddy/Caddyfile                  routage (n'expose jamais /_synapse/admin)
deploy/keycloak/realm-bf.json           realm, rôles, TOTP, clients OIDC
scripts/init-stack.sh                   secrets + rendu des gabarits
scripts/clean-install-check.sh          preuve de l'installation en une commande
admin-service/src/{server,agents,synapse,keycloak,auth}.ts
admin-service/src/seed.ts               comptes de démonstration
admin-service/tests/*.test.ts
client/src/matrix/{session,rooms,files}.ts
client/src/lib/{classification,expiry,ack,proof,voice}.ts
client/src/i18n/{index.ts,fr.json,mos.json}
client/src/ui/*                         écrans (construction libre)
client/tests/unit/*.test.ts             tests sans serveur
client/tests/e2e/{helpers.ts,*.test.ts} tests contre la pile en marche
docs/{note-securite,note-pre-projet,fiche-equipe,video-script}.md
```

---

### Tâche 1 : dépôt et licences

**Fichiers :** Créer `LICENSE`, `README.md` (ébauche), `THIRD-PARTY.md` (en-tête), `.gitignore`, `.env.example`.

**Interfaces :** Produit : un dépôt Git initialisé, base de tous les commits suivants.

- [ ] **Étape 1 :** `git init` dans `Print boot`, branche `main`.
- [ ] **Étape 2 :** placer le texte intégral de l'AGPL-3.0 dans `LICENSE` (copie du texte officiel gnu.org, sans modification). `.gitignore` exclut `node_modules/`, `dist/`, `data/`, `.env`.
- [ ] **Étape 3 :** vérifier : `Select-String -Path LICENSE -Pattern "GNU AFFERO GENERAL PUBLIC LICENSE"` renvoie une ligne ; `git status` ne liste ni `.env` ni `data/`.
- [ ] **Étape 4 :** commit `chore: initialise le dépôt sous AGPL-3.0`.

### Tâche 2 : serveur durci (Synapse, PostgreSQL, Caddy)

**Fichiers :** Créer `compose.yaml`, `deploy/synapse/homeserver.yaml.tmpl`, `deploy/caddy/Caddyfile`, `scripts/init-stack.sh`, `client/package.json`, `client/tests/e2e/helpers.ts`, `client/tests/e2e/server-hardening.test.ts`. Modifier `THIRD-PARTY.md`.

**Interfaces :**
- Produit : `helpers.ts` exporte `BASE = 'http://localhost:8080'`, `adminToken(): string` (jeton du compte de service `@svc-admin:chat.localhost`, lu dans `data/secrets/svc-admin.token`), `loginAs(localpart: string): Promise<MatrixClient>` (jeton obtenu par `POST /_synapse/admin/v1/users/{mxid}/login`, client avec `initRustCrypto({ useIndexedDb: false })`), `dumpDb(): string` (sortie de `docker compose exec -T postgres pg_dump -U synapse synapse`).
- Le service `init` génère les secrets une seule fois, rend `homeserver.yaml` depuis le gabarit et crée le compte de service par le secret partagé d'enregistrement. Synapse dépend de `init` (`service_completed_successfully`). Le service `caddy` porte les alias réseau `auth.localhost` et `chat.localhost`.
- Caddy sur `:8080` ne route que `/_matrix`, `/_synapse/client` et le client statique. `/_synapse/admin` n'est jamais exposé. Le port 8448 n'est pas publié.

- [ ] **Étape 1 : écrire les tests qui échouent** dans `server-hardening.test.ts` :
  - `registrationIsClosed` : `POST {BASE}/_matrix/client/v3/register` avec `{ username: 'intrus', password: 'x', auth: { type: 'm.login.dummy' } }` renvoie 403.
  - `adminApiIsNotExposed` : `GET {BASE}/_synapse/admin/v1/server_version` renvoie 404 ou 403.
  - `federationIsOff` : `GET {BASE}/_matrix/federation/v1/version` ne renvoie pas 200.
  - `passwordLoginIsDisabled` : `GET {BASE}/_matrix/client/v3/login` ne liste pas `m.login.password` dans `flows`.
  - `roomsAreAlwaysEncrypted` : un compte `test-a` créé via l'API admin crée un salon sans `initial_state` ; `GET /rooms/{id}/state/m.room.encryption` renvoie 200 avec `algorithm` égal à `m.megolm.v1.aes-sha2`.
  - `configHasRequiredKeys` : le fichier rendu contient `enable_registration: false`, `encryption_enabled_by_default_for_room_type: all`, `url_preview_enabled: false`, `federation_domain_whitelist: []`, et la présence désactivée.
- [ ] **Étape 2 :** `npx vitest run tests/e2e/server-hardening.test.ts` : tout échoue (pile absente).
- [ ] **Étape 3 :** écrire `compose.yaml`, le gabarit Synapse, le Caddyfile et `init-stack.sh`. Épingler les tags d'images (pas de `latest`) et les consigner dans `THIRD-PARTY.md`. Réglages Synapse supplémentaires : `max_upload_size: 50M`, `allow_guest_access: false`, rétention des journaux courte, `password_config.enabled: false`, annuaire limité aux comptes locaux.
- [ ] **Étape 4 :** `docker compose up -d --wait`, puis relancer le fichier de test : tout passe.
- [ ] **Étape 5 :** commit `feat: serveur Synapse durci derrière Caddy`.

### Tâche 3 : service d'administration (enrôlement, révocation, annuaire)

**Fichiers :** Créer `admin-service/package.json`, `admin-service/src/{server,agents,synapse,auth}.ts`, `admin-service/tests/agents.test.ts`. Modifier `compose.yaml` (service `admin`, route Caddy `/admin-api`).

**Interfaces :**
```ts
export type Role = 'admin' | 'chef_de_service' | 'agent'
export interface AgentInput { username: string; displayName: string; ministry: string; fonction: string; role: Role }
export interface Agent extends AgentInput { status: 'active' | 'revoked' }
export interface RevocationReport { username: string; identityDisabled: boolean; synapseDeactivated: boolean }
export interface IdentityProvider {
  createUser(a: AgentInput): Promise<void>
  disableUser(username: string): Promise<void>
  listUsers(): Promise<Agent[]>
}
export interface SynapseAdmin { upsertUser(mxid: string, displayName: string): Promise<void>; deactivate(mxid: string): Promise<void> }
export function enroll(deps: { identity: IdentityProvider; synapse: SynapseAdmin; domain: string }, input: AgentInput): Promise<Agent>
export function revoke(deps: { identity: IdentityProvider; synapse: SynapseAdmin; domain: string }, username: string): Promise<RevocationReport>
```
Routes : `POST /agents`, `GET /agents`, `GET /directory?ministry=`, `POST /agents/:username/revoke`. L'authentification de cette tâche est un jeton statique `ADMIN_API_TOKEN` ; la tâche 4 la remplace par la validation du JWT Keycloak.

- [ ] **Étape 1 : écrire les tests qui échouent** dans `agents.test.ts`, avec un `IdentityProvider` et un `SynapseAdmin` en mémoire :
  - `enrollRejectsUnknownRole` : un rôle `ministre` lève `INVALID_ROLE`.
  - `enrollRejectsBadUsername` : `Awa Ouedraogo` et `ab` lèvent `INVALID_USERNAME` (motif accepté : `^[a-z0-9._-]{3,32}$`).
  - `revokeDisablesIdentityBeforeSynapse` : l'ordre des appels enregistrés est `identity.disableUser` puis `synapse.deactivate`.
  - `revokeIsIdempotent` : deux révocations successives renvoient chacune un rapport sans erreur.
  - `endpointsRequireAdminToken` : sans jeton, 401 ; avec un mauvais jeton, 403 ; avec le bon, 200.
- [ ] **Étape 2 :** `npx vitest run` dans `admin-service` : échec.
- [ ] **Étape 3 :** implémenter `enroll`, `revoke`, le client Synapse (`PUT /_synapse/admin/v2/users/{mxid}`, `POST /_synapse/admin/v1/deactivate/{mxid}` avec `{ erase: false }`) et les routes Fastify. Le service joint Synapse par le réseau interne et lit `data/secrets/svc-admin.token`.
- [ ] **Étape 4 :** les tests passent.
- [ ] **Étape 5 :** commit `feat: service d'administration (enrôlement et révocation)`.

### Tâche 4 : Keycloak, OIDC, TOTP obligatoire, rôles

**Fichiers :** Créer `deploy/keycloak/realm-bf.json`, `admin-service/src/keycloak.ts`, `admin-service/tests/keycloak.e2e.test.ts`. Modifier `compose.yaml`, le gabarit Synapse (bloc `oidc_providers`, identifiant `oidc-keycloak`, `localpart_template` sur `preferred_username`, `allow_existing_users: true`), `admin-service/src/auth.ts`.

**Interfaces :**
- Consomme : `IdentityProvider` (tâche 3). Produit : `KeycloakIdentity implements IdentityProvider` (crée l'utilisateur avec ministère et fonction en attributs et le rôle de realm ; désactiver = `enabled: false` puis fermeture de ses sessions).
- Le realm `bf` impose l'action requise `CONFIGURE_TOTP`, désactive le flux « direct grant » et définit deux clients : `synapse` (confidentiel) et `messagerie-web` (public, PKCE). Les rôles de realm sont `admin`, `chef_de_service`, `agent`.
- `auth.ts` valide le JWT Keycloak (signature par le JWKS du realm, bibliothèque `jose`) et exige le rôle `admin`.
- Le realm définit aussi un client confidentiel `automation` (flux `client_credentials`, compte de service portant le rôle `admin`) pour le seed et les tests, qui n'ont pas de TOTP. Son secret est généré par `init-stack.sh` dans `data/secrets/`. Produit : `helpers.ts` exporte `adminJwt(): Promise<string>` (jeton `client_credentials`), utilisé par les tâches 5, 8 et 13.

**Point de décision, limite de 3 heures :** si la connexion SSO Synapse ↔ Keycloak ne fonctionne pas après 3 heures de travail, **arrêter et demander à l'utilisateur** avant d'appliquer le repli de la spec §8 (TOTP géré par le service d'administration), car il change l'architecture.

- [ ] **Étape 1 : écrire les tests qui échouent** dans `keycloak.e2e.test.ts` :
  - `ssoRedirectGoesToKeycloak` : `GET {BASE}/_matrix/client/v3/login/sso/redirect/oidc-keycloak?redirectUrl=http://localhost:8080/` répond 302 avec un `Location` qui commence par `http://auth.localhost:8081/realms/bf/`.
  - `directGrantIsRefused` : `POST` sur l'endpoint token du realm avec `grant_type=password` répond une erreur `unauthorized_client`.
  - `adminEndpointRejectsNonAdminJwt` : un JWT du rôle `agent` reçoit 403 sur `POST /agents`.
  - `revokeDisablesKeycloakUser` : après `POST /agents/{u}/revoke`, `GET /admin/realms/bf/users?username={u}` montre `enabled: false`.
- [ ] **Étape 2 :** lancer le fichier : échec.
- [ ] **Étape 3 :** écrire le realm, la configuration Synapse et `KeycloakIdentity`. Le compte démo reçoit un secret TOTP fictif et fixe, documenté dans le README (le jury doit pouvoir se connecter).
- [ ] **Étape 4 :** les tests passent. Vérification manuelle : ouvrir `http://localhost:8080`, se connecter avec un compte démo, saisir le code TOTP ; une saisie du seul mot de passe n'ouvre pas de session.
- [ ] **Étape 5 :** commit `feat: identité Keycloak avec TOTP obligatoire et rôles`.

### Tâche 5 : comptes de démonstration et installation en une commande

**Fichiers :** Créer `admin-service/src/seed.ts`, `admin-service/tests/seed.e2e.test.ts`, `scripts/clean-install-check.sh`. Modifier `compose.yaml` (service `seed`, dépend de la santé de Keycloak, Synapse et admin).

**Interfaces :** Consomme `enroll` (tâche 3). Produit : quatre comptes actifs, tous fictifs : `admin.demo` (`admin`), `issa.kabore` (`chef_de_service`), `awa.ouedraogo` et `moussa.sawadogo` (`agent`), répartis sur deux ministères fictifs. Aucun compte `intrus.*` n'est créé : l'intrus du jury est un compte inexistant.

- [ ] **Étape 1 : écrire les tests qui échouent** dans `seed.e2e.test.ts` :
  - `fourDemoAccountsExist` : `GET /agents` renvoie exactement ces quatre noms, tous `active`.
  - `seedIsIdempotent` : relancer le seed ne change pas le nombre de comptes.
- [ ] **Étape 2 :** lancer : échec.
- [ ] **Étape 3 :** implémenter le seed (appelle `enroll` pour chaque compte absent) et le script `clean-install-check.sh` : `docker compose down -v`, `docker compose up -d --wait`, puis `curl -sf http://localhost:8080/_matrix/client/versions`.
- [ ] **Étape 4 :** exécuter `bash scripts/clean-install-check.sh` : sortie 0. Relancer les tests : ils passent.
- [ ] **Étape 5 :** commit `feat: comptes de démonstration et installation en une commande`.

### Tâche 6 : client web, messages chiffrés

**Fichiers :** Créer `client/index.html`, `client/vite.config.ts`, `client/src/matrix/{session,rooms}.ts`, `client/src/ui/*`, `client/tests/unit/rooms.test.ts`, `client/tests/e2e/messaging.test.ts`. Modifier `compose.yaml` et le Caddyfile (service du client construit, servi sur `:8080`).

**Interfaces :**
```ts
export async function startSession(): Promise<MatrixClient>   // restaure la session ou termine le retour SSO (loginToken), puis initRustCrypto()
export async function createEncryptedRoom(c: MatrixClient, o: { name: string; invite: string[] }): Promise<string>
export async function sendText(c: MatrixClient, roomId: string, body: string): Promise<string>  // renvoie l'event_id ; lève EMPTY_MESSAGE si body.trim() === ''
```
La connexion utilise le flux SSO Matrix (`m.login.sso`, puis `client.login('m.login.token', { token })`). L'interface minimale comprend : écran de connexion, liste de salons, fil de messages, zone de saisie.

- [ ] **Étape 1 : écrire les tests qui échouent.**
  - Unitaire, `emptyMessageIsRejected` : `sendText(fakeClient, '!r', '   ')` lève `EMPTY_MESSAGE` sans appeler le client.
  - E2E, `aliceAndBobExchange` : `awa.ouedraogo` crée un salon et invite `moussa.sawadogo` ; il rejoint ; elle envoie `bonjour ministère` ; il reçoit un événement déchiffré dont le corps est identique.
  - E2E, `serverStoresOnlyCiphertext` : `dumpDb()` ne contient pas `bonjour ministère` et contient `m.room.encrypted`.
- [ ] **Étape 2 :** lancer : échec.
- [ ] **Étape 3 :** implémenter `session.ts`, `rooms.ts` et l'interface minimale.
- [ ] **Étape 4 :** les tests passent ; vérification manuelle dans le navigateur avec deux comptes démo.
- [ ] **Étape 5 :** commit `feat: client web et échange de messages chiffrés`.

### Tâche 7 : fichiers chiffrés

**Fichiers :** Créer `client/src/matrix/files.ts`, `client/tests/unit/files.test.ts`, `client/tests/e2e/files.test.ts`. Modifier `THIRD-PARTY.md`.

**Interfaces :**
```ts
export async function sendFile(c: MatrixClient, roomId: string, file: Blob, name: string): Promise<string>  // lève EMPTY_FILE ou FILE_TOO_LARGE
export async function downloadFile(c: MatrixClient, event: MatrixEvent): Promise<Blob>
```
La taille maximale est lue sur `/_matrix/media/v3/config` (50 Mo, tâche 2). Le chiffrement de la pièce jointe utilise une **bibliothèque Matrix maintenue** (candidate : `matrix-encrypt-attachment`). Si aucune bibliothèque maintenue n'est utilisable, **s'arrêter et demander à l'utilisateur** : réimplémenter la spécification avec WebCrypto reviendrait à écrire de la cryptographie, ce qui est éliminatoire.

- [ ] **Étape 1 : écrire les tests qui échouent.**
  - Unitaire, `emptyFileIsRejected` (`EMPTY_FILE`) et `oversizedFileIsRejected` (`FILE_TOO_LARGE`, sans envoi).
  - E2E, `fileRoundtripKeepsBytesAndName` : un fichier de 1 Mo aléatoire nommé `décret-№1.pdf` est reçu par l'autre agent, octets identiques, nom identique.
  - E2E, `serverNeverSeesFileContentOrName` : le contenu commence par le marqueur `SECRET-MARKER-PDF` ; `dumpDb()` ne contient ni ce marqueur ni `décret-№1` ; `docker compose exec -T synapse grep -rl SECRET-MARKER /data/media_store` ne trouve rien.
- [ ] **Étape 2 :** lancer : échec.
- [ ] **Étape 3 :** implémenter `files.ts` ; ajouter l'affichage dans le fil.
- [ ] **Étape 4 :** les tests passent.
- [ ] **Étape 5 :** commit `feat: pièces jointes chiffrées`.

### Tâche 8 : révocation immédiate

**Fichiers :** Créer `client/tests/unit/logout.test.ts`, `client/tests/e2e/revocation.test.ts`. Modifier `client/src/matrix/session.ts`.

**Interfaces :** Ajoute à `session.ts` `export function watchForRevocation(c: MatrixClient, onRevoked: () => void): void` : à l'événement `HttpApiEvent.SessionLoggedOut`, supprime le stockage local (IndexedDB, `localStorage`), arrête le client, puis appelle `onRevoked` qui ramène à l'écran de connexion.

- [ ] **Étape 1 : écrire les tests qui échouent.**
  - Unitaire, `purgesLocalStoreOnLogout` (point de contrôle 2) : un client factice émet `SessionLoggedOut` ; les clés de stockage sont vides et `onRevoked` est appelé une fois.
  - E2E, `revokedAgentLosesEverything` : trois agents (`awa`, `moussa`, `issa`) dans un groupe ; l'administrateur révoque `moussa` par `POST /admin-api/agents/moussa.sawadogo/revoke` ; alors (a) `whoami` avec le jeton de `moussa` renvoie 401 `M_UNKNOWN_TOKEN` en moins de 2 s, (b) `moussa` n'apparaît plus dans les membres du groupe (attendre jusqu'à 10 s), (c) le `session_id` Megolm d'un message envoyé par `awa` après la révocation diffère de celui d'avant.
- [ ] **Étape 2 :** lancer : échec.
- [ ] **Étape 3 :** implémenter `watchForRevocation` et l'appeler depuis le démarrage de session.
- [ ] **Étape 4 :** les tests passent.
- [ ] **Étape 5 :** commit `feat: révocation immédiate et purge locale`.

### Tâche 9 : classification des messages

**Fichiers :** Créer `client/src/lib/classification.ts`, `client/tests/unit/classification.test.ts`, `client/tests/e2e/classification.test.ts`. Modifier `client/src/matrix/rooms.ts` et l'interface (sélecteur de niveau dans la zone de saisie).

**Interfaces :**
```ts
export const CLASSIFICATION_KEY = 'bf.gov.classification'
export type Level = 'normal' | 'restreinte' | 'confidentiel'
export interface Classification { level: Level; noForward: boolean; expiresAt: number | null }
export function policyFor(level: Level): { noForward: boolean; defaultTtlMs: number | null }
export function readClassification(content: Record<string, unknown>): Classification
export async function sendClassified(c: MatrixClient, roomId: string, body: string, level: Level, ttlMs?: number): Promise<string>
export async function forwardMessage(c: MatrixClient, src: MatrixEvent, destRoomId: string): Promise<string>  // lève FORWARD_FORBIDDEN si noForward
```
Valeurs de politique (choix du plan, à valider) : `normal` → `{ noForward: false, defaultTtlMs: null }` ; `restreinte` → `{ noForward: true, defaultTtlMs: null }` ; `confidentiel` → `{ noForward: true, defaultTtlMs: 86_400_000 }`.

- [ ] **Étape 1 : écrire les tests qui échouent.**
  - `policyMatchesTable` : les trois valeurs ci-dessus.
  - `unknownLevelIsTreatedAsConfidential` : un contenu avec `level: 'secret-defense'` ou sans clé de niveau lisible produit `confidentiel` ; un contenu sans aucune clé produit `normal`.
  - `forwardIsForbiddenForRestricted` : `forwardMessage` sur un message `restreinte` lève `FORWARD_FORBIDDEN` et n'envoie rien.
  - E2E, `classificationNeverReachesServer` : après l'envoi d'un message `confidentiel`, `dumpDb()` ne contient pas `bf.gov.classification`.
- [ ] **Étape 2 :** lancer : échec.
- [ ] **Étape 3 :** implémenter le module ; `expiresAt` vaut `Date.now() + (ttlMs ?? defaultTtlMs)` quand un délai existe.
- [ ] **Étape 4 :** les tests passent.
- [ ] **Étape 5 :** commit `feat: classification des messages`.

### Tâche 10 : expiration automatique et masquage

**Fichiers :** Créer `client/src/lib/expiry.ts`, `client/src/ui/privacyShield.ts`, `client/tests/unit/expiry.test.ts`, `client/tests/unit/privacyShield.test.ts`, `client/tests/e2e/expiry.test.ts`.

**Interfaces :**
```ts
export function isExpired(c: Classification, now: number): boolean
export function visibleEvents(events: MatrixEvent[], now: number): MatrixEvent[]
export function scheduleExpiry(c: MatrixClient, event: MatrixEvent, now: () => number): () => void  // seul l'expéditeur rédige ; renvoie la fonction d'annulation
export function shouldBlur(level: Level, s: { windowFocused: boolean; tabVisible: boolean }): boolean
```
Le filigrane affiche le nom de l'agent connecté sur les messages `confidentiel`.

- [ ] **Étape 1 : écrire les tests qui échouent.**
  - `hidesExpiredWithoutSenderRedaction` (point de contrôle 1) : un message dont `expiresAt` est passé est absent de `visibleEvents`, alors qu'aucune rédaction n'a eu lieu.
  - `onlySenderRedacts` : `scheduleExpiry` appelle `redactEvent` quand le client est l'expéditeur, et ne l'appelle pas sinon.
  - `blursConfidentialWhenUnfocused` : `shouldBlur('confidentiel', { windowFocused: false, tabVisible: true })` vaut `true` ; idem avec `tabVisible: false`.
  - `neverBlursNormal` : `shouldBlur('normal', { windowFocused: false, tabVisible: false })` vaut `false`.
  - E2E, `bobHidesAfterTtlEvenIfAliceIsOffline` : `awa` envoie un message `confidentiel` avec 2 s de délai puis son client est arrêté ; après 3 s, `visibleEvents` côté `moussa` est vide.
- [ ] **Étape 2 :** lancer : échec.
- [ ] **Étape 3 :** implémenter les trois modules ; brancher `visibleEvents` sur l'affichage du fil, rafraîchi chaque seconde.
- [ ] **Étape 4 :** les tests passent.
- [ ] **Étape 5 :** commit `feat: expiration automatique et masquage des messages confidentiels`.

### Tâche 11 : instructions de service et accusé de lecture probant

**Fichiers :** Créer `client/src/lib/{ack,proof}.ts`, `client/tests/unit/ack.test.ts`, `client/tests/e2e/ack.test.ts`. Modifier l'interface (bouton « Instruction de service », état « lu / en attente », vue d'impression du rapport).

**Interfaces :**
```ts
export const INSTRUCTION_KEY = 'bf.gov.instruction'
export const ACK_TYPE = 'bf.gov.ack'
export async function contentSha256(body: string): Promise<string>   // hexadécimal, crypto.subtle.digest
export async function sendInstruction(c: MatrixClient, roomId: string, body: string, level?: Level): Promise<string>
export async function sendAck(c: MatrixClient, roomId: string, instruction: { eventId: string; body: string }): Promise<void>
export interface AckRecord { sender: string; deviceId: string; readAt: number }
export function tallyAcks(acks: Array<{ sender: string; deviceId: string; content: { instruction_event_id: string; content_sha256: string; read_at: number } }>, instruction: { eventId: string; sha256: string }, members: string[]): { read: AckRecord[]; pending: string[] }
export function buildProof(instruction: { eventId: string; sha256: string; sentAt: number }, tally: { read: AckRecord[]; pending: string[] }): ProofReport
```
L'accusé est un événement de type `ACK_TYPE` envoyé dans le salon chiffré ; son authenticité repose sur la signature d'appareil de Megolm. Le rapport de preuve est du JSON, et une vue imprimable (`window.print()`) donne le PDF, sans bibliothèque ajoutée.

- [ ] **Étape 1 : écrire les tests qui échouent.**
  - `tallyCountsEachAgentOnce` (point de contrôle 3) : deux accusés du même agent (deux appareils) donnent une seule entrée dans `read`, la plus ancienne `readAt`.
  - `tallyIgnoresHashMismatch` : un accusé dont `content_sha256` diffère est ignoré.
  - `tallyIgnoresNonMembers` : un accusé d'un compte hors de `members` est ignoré.
  - `pendingListsMembersWithoutAck` : les membres sans accusé valide figurent dans `pending`.
  - `proofReportContainsDeviceId` : chaque ligne du rapport comporte `deviceId` et `readAt`.
  - E2E, `ackIsEncryptedAndAttributed` : après un accusé de `moussa`, `dumpDb()` ne contient pas `bf.gov.ack` ; côté `awa`, l'événement déchiffré expose une clé d'appareil de l'expéditeur non nulle.
- [ ] **Étape 2 :** lancer : échec.
- [ ] **Étape 3 :** implémenter les deux modules. L'accusé part à l'ouverture du salon quand l'instruction est à l'écran, une seule fois par appareil.
- [ ] **Étape 4 :** les tests passent.
- [ ] **Étape 5 :** ajouter la vue de l'expéditeur (agents lus, en attente) et le bouton d'export JSON.
- [ ] **Étape 6 :** vérification manuelle : `moussa` ouvre l'instruction, `awa` voit passer l'agent en « lu ».
- [ ] **Étape 7 :** ajouter la vue imprimable du rapport (cible de sacrifice n°2). Commit `feat: instructions de service avec accusé de lecture probant`.

### Tâche 12 : interface en mooré et messages vocaux

**Fichiers :** Créer `client/src/i18n/{index.ts,fr.json,mos.json}`, `client/src/lib/voice.ts`, `client/tests/unit/i18n.test.ts`, `client/tests/unit/voice.test.ts`, `client/tests/e2e/unicode.test.ts`.

**Interfaces :**
```ts
export type Locale = 'fr' | 'mos'
export function setLocale(l: Locale): void
export function t(key: string, params?: Record<string, string>): string   // repli sur le français si la clé manque
export function startRecording(): Promise<{ stop(): Promise<Blob> }>        // MediaRecorder, audio/webm;codecs=opus
export async function sendVoice(c: MatrixClient, roomId: string, blob: Blob, durationMs: number): Promise<string>  // msgtype m.audio, via sendFile
```

**Partie A : mooré.**
- [ ] **Étape 1 : écrire les tests qui échouent** : `fallsBackToFrenchWhenKeyMissing` ; `mooreHasNoUnknownKeys` (chaque clé de `mos.json` existe dans `fr.json`) ; E2E `unicodeSurvivesRoundtrip` (point de contrôle 4) : le message `ɛ ɩ ʋ ã ĩ` reçu est strictement égal à celui envoyé, sans normalisation.
- [ ] **Étape 2 :** lancer : échec.
- [ ] **Étape 3 :** implémenter `i18n` et basculer tous les libellés de l'interface sur `t()`. `mos.json` couvre environ 25 libellés essentiels (connexion, envoi, salons, niveaux de classification, « lu / en attente »). **Les traductions sont des brouillons** : un en-tête de fichier et le README signalent qu'elles attendent la relecture d'un locuteur.
- [ ] **Étape 4 :** les tests passent. Commit `feat: interface en mooré`.

**Partie B : messages vocaux.**
- [ ] **Étape 5 : écrire les tests qui échouent** : `sendVoiceUsesAudioMsgtype` (le contenu envoyé a `msgtype: 'm.audio'` et la durée) ; `emptyRecordingIsRejected` (`EMPTY_FILE`).
- [ ] **Étape 6 :** implémenter `voice.ts` et le bouton d'enregistrement ; les tests passent. Commit `feat: messages vocaux chiffrés`.

### Tâche 13 : suite de tests de sécurité

**Fichiers :** Créer `client/tests/e2e/security.test.ts`. Modifier `client/package.json` (script `test:security`). Les tests existants des tâches 2, 6 à 9 et 11 sont étiquetés `describe('SÉCURITÉ: …')`.

- [ ] **Étape 1 : écrire les tests qui échouent** (spec §9) :
  - `nothingReadableOnServer` : après un scénario complet (texte, fichier, message classifié, accusé), ni `dumpDb()`, ni `docker compose logs caddy synapse`, ni le dossier `/data/media_store` ne contiennent les marqueurs en clair.
  - `intruderCannotEnter` : `POST /register` renvoie 403 ; `whoami` avec un jeton forgé renvoie 401 ; `POST /_matrix/client/v3/login` avec `m.login.password` est refusé ; l'invitation d'un compte inexistant dans un salon est rejetée.
  - `revokedGets401` : repris de la tâche 8.
  - `classificationAbsentFromStorage` : repris de la tâche 9.
  - `ackIsEncrypted` : repris de la tâche 11.
- [ ] **Étape 2 :** lancer `npm run test:security` : les tests non encore écrits échouent.
- [ ] **Étape 3 :** écrire les cas manquants.
- [ ] **Étape 4 :** `npm run test:security` : tout passe. Consigner la sortie dans `docs/note-securite.md` à la tâche 14.
- [ ] **Étape 5 :** commit `test: suite de sécurité automatisée`.

### Tâche 14 : dossier de candidature

**Fichiers :** Créer `docs/note-securite.md`, `docs/note-pre-projet.md`, `docs/fiche-equipe.md`, `docs/video-script.md`, `scripts/check-dossier.ps1`. Modifier `README.md` et `THIRD-PARTY.md`.

**Interfaces :** `check-dossier.ps1` échoue (code de sortie 1) si l'un de ces points manque : `LICENSE` présent ; `README.md` en français avec les sections concept, architecture, technologies et licences, niveau d'engagement, installation, limites ; `README.md`, `note-securite.md` et `note-pre-projet.md` chacun à 1100 mots au maximum (choix du plan pour « deux pages ») ; `THIRD-PARTY.md` cite chaque composant du tableau de la spec §4 avec licence et lien.

- [ ] **Étape 1 :** écrire `check-dossier.ps1` ; le lancer : il échoue.
- [ ] **Étape 2 :** rédiger le README (concept, architecture, technologies et licences, niveau d'engagement « Créer », installation, comptes et secret TOTP de démonstration, limites). Rédiger la note de sécurité à partir de la spec §5 et §6 : menaces, protections, métadonnées visibles (liste de la spec §5), limites connues (capture d'écran, horodatage local, rédaction au mieux), résultats de `npm run test:security`.
- [ ] **Étape 3 :** rédiger la note de pré-projet (concept, architecture, protocole, composants et licences, niveau d'engagement, innovation, répartition des rôles) et `video-script.md` (plan de 3 minutes : échange chiffré entre deux agents, révocation, classification, accusé de lecture, mooré).
- [ ] **Étape 4 :** `fiche-equipe.md` : gabarit avec champs vides (nom d'équipe, université, membres, filière, niveau, contacts, attestation d'inscription 2026-2027). **Ces informations viennent de l'utilisateur, elles ne sont jamais inventées.**
- [ ] **Étape 5 :** lancer `scripts/check-dossier.ps1` : sortie 0. Relancer `bash scripts/clean-install-check.sh` puis `npm run test:security` : tout passe.
- [ ] **Étape 6 :** commit `docs: dossier de candidature`. Le dépôt public et la vidéo sont publiés par l'utilisateur.
