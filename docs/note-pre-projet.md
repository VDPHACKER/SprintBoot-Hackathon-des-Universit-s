# Note de pré-projet

## Concept

Une messagerie instantanée pour les agents publics, aussi simple qu'une application du marché, mais dont le serveur,
hébergé par l'État, **ne peut rien lire**. Elle ne se contente pas de chiffrer : elle sert la **chaîne de commandement**
administrative, où l'on émet des instructions, où l'on doit savoir qui les a lues, et où certaines informations ne doivent
ni circuler ni durer.

## Architecture

Navigateur (client web, chiffrement Rust/WebAssembly) → Caddy → Synapse (serveur Matrix, sans fédération) + PostgreSQL ;
Keycloak pour l'identité (mot de passe et TOTP obligatoire, trois rôles) ; un service d'administration pour l'enrôlement, la
révocation et l'annuaire. Tout démarre avec `docker compose up -d --wait`, sans service tiers : secrets, configuration et
comptes de démonstration fictifs sont générés à l'installation.

## Protocole de chiffrement retenu

**Matrix** : Olm pour les échanges directs, Megolm pour les groupes, par la bibliothèque officielle `matrix-sdk-crypto`
(Rust, compilée en WebAssembly) via `matrix-js-sdk`. Les pièces jointes et les messages vocaux utilisent le chiffrement de
pièces jointes de la même bibliothèque. **Aucune cryptographie n'est développée par l'équipe.**

## Composants open source et licences

| Composant | Licence |
|---|---|
| Synapse (serveur Matrix) | AGPL-3.0 |
| Keycloak (identité) | Apache-2.0 |
| PostgreSQL | licence PostgreSQL |
| Caddy (proxy) | Apache-2.0 |
| matrix-js-sdk, matrix-sdk-crypto-wasm | Apache-2.0 |
| Fastify, jose, Node.js, Vite | MIT / Apache-2.0 |

Liens et versions : `THIRD-PARTY.md`. Code de l'équipe : **AGPL-3.0-or-later**.

## Niveau d'engagement

**Créer** : application nouvelle (client, service d'administration, module serveur) sur une bibliothèque éprouvée. Le
serveur Synapse n'est pas modifié. Aucune contribution amont n'a été soumise.

## Fonctionnalités innovantes

1. **Classification des messages** (normal, diffusion restreinte, confidentiel) *dans* le message chiffré : le serveur ne la
   voit jamais. Transfert interdit, expiration automatique (masquée même si l'expéditeur est hors ligne), flou et
   filigrane à l'écran.
2. **Instructions de service et accusé de lecture probant** : accusé chiffré, rattaché à l'appareil réel du lecteur,
   compté une fois par agent, lié à l'empreinte du texte ; tableau « lu / à relancer » et rapport de preuve exportable.
3. **Messages vocaux** chiffrés, utiles aux agents peu à l'aise à l'écrit, et interface **multilingue** (mooré partiel,
   à partir d'un dictionnaire de référence ; voir `docs/traduction-moore.md`).
4. **Garantie serveur** : un module refuse tout événement non chiffré, même d'un client modifié.

## Pertinence pour l'administration burkinabè

Données de service sensibles hors de serveurs étrangers ; révocation immédiate au départ d'un agent ; preuve de réception
d'une instruction ; langues nationales ; installation par une équipe informatique réduite.

## Répartition des rôles

*À compléter par l'équipe (noms et rôles réels des membres). Cette partie n'est pas remplie à la place de l'équipe.*

| Membre | Rôle |
|---|---|
| … | … |

## Limites

Voir `docs/note-securite.md` (§4) : notamment, les noms de salons sont visibles du serveur et le flou n'empêche pas une
photo de l'écran.