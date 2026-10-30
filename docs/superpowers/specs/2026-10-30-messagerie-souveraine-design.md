# Messagerie souveraine de l'administration : design

Date : 2026-10-30. Sprint Hackathon 226, dépôt à rendre le 1er novembre 2026.
Source : `❶ PRINCIPE DU SPRINT.spanner.database.md`.

## 1. Intention

Les agents publics échangent des informations de service sur des messageries grand public que l'État ne maîtrise pas. On construit une messagerie instantanée (messages, groupes, fichiers) hébergeable sur l'infrastructure de l'État, aussi simple qu'une application grand public, avec un serveur qui ne peut rien lire.

Ce qui doit la distinguer devant le jury (25 points sur l'innovation et la pertinence) : une messagerie conçue pour la **chaîne de commandement administrative** burkinabè, et pas seulement un Matrix renommé.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Passer proprement les 5 épreuves en direct du jury (35 points) : serveur aveugle, révocation, intrus, innovation, explication du code.
- Une innovation démontrable en moins d'une minute, en trois volets (section 6).
- Dossier complet : README, LICENSE, note de sécurité, vidéo de 3 minutes, comptes fictifs.
- Tests automatisés des fonctions de sécurité (bonus +2).

**Non-objectifs**
- Fédération avec d'autres serveurs Matrix.
- Application mobile native. Le client est une application web (PWA).
- Appels audio et vidéo.
- Contribution acceptée en amont (bonus +5) : irréaliste en 2 jours.

**Anti-objectifs** (un échec même si « ça marche »)
- Un seul message lisible en clair côté serveur : élimination.
- Toute cryptographie écrite par l'équipe : élimination.
- Un service tiers indispensable (SaaS, API externe, serveur de push public).
- Une fonction de sécurité que personne de l'équipe ne sait expliquer ligne par ligne.
- Promettre ce que le web ne peut pas garantir (voir les limites en section 6).

## 3. Contraintes

- Open source uniquement. Licence du dépôt : **AGPL-3.0-or-later**, compatible avec Synapse, fichier `LICENSE` à la racine.
- Installation en une commande : `docker compose up -d`. Docker 29 et Compose v5 sont disponibles sur la machine de dev.
- Aucune cryptographie maison : uniquement Matrix (Olm/Megolm) via `matrix-js-sdk` et sa bibliothèque Rust de crypto (`matrix-sdk-crypto-wasm`).
- Données et comptes fictifs uniquement.
- Délai : environ 2 jours de travail. Tout ce qui est risqué a un repli (section 8).

## 4. Architecture

```
Navigateur (client web, PWA)
   matrix-js-sdk + crypto Rust (WASM) : le chiffrement a lieu ici, seulement ici
        │ HTTPS
   Caddy (reverse proxy, TLS)
     ├── Synapse (serveur Matrix, fédération désactivée)
     │      └── PostgreSQL
     ├── Keycloak (identité : TOTP obligatoire, rôles)  ── OIDC ──> Synapse
     └── Service d'administration (enrôlement, révocation, annuaire)
```

| Composant | Rôle | Licence |
|---|---|---|
| Synapse | serveur de messagerie, ne voit que du chiffré | AGPL-3.0 |
| matrix-js-sdk et matrix-sdk-crypto-wasm | client et chiffrement de bout en bout | Apache-2.0 |
| Keycloak | identité, second facteur (TOTP), rôles | Apache-2.0 |
| PostgreSQL | base de données | PostgreSQL License |
| Caddy | proxy et TLS | Apache-2.0 |
| Service d'administration (nouveau) | enrôlement et révocation orchestrés | AGPL-3.0 |
| Client web (nouveau) | interface | AGPL-3.0 |

Niveau d'engagement déclaré : **Créer**, une application nouvelle reposant sur une bibliothèque éprouvée (`matrix-js-sdk`), au-dessus d'un serveur Synapse non modifié.

## 5. Socle de sécurité : correspondance exigence → mécanisme

| Exigence du brief | Mécanisme |
|---|---|
| Chiffrement de bout en bout (messages et fichiers) | Megolm pour les salons, pièces jointes chiffrées au standard Matrix. Tous les salons sont créés chiffrés. Le serveur impose `encryption_enabled_by_default_for_room_type: all`. |
| Hébergement souverain, une commande | Docker Compose. Un conteneur d'initialisation génère la configuration et crée les comptes de démonstration. Aucun appel sortant : pas de push externe, pas d'aperçu d'URL, pas de fédération. |
| Identité vérifiée, second facteur, rôles | Inscription publique désactivée dans Synapse. Seuls les comptes créés par l'administrateur (Keycloak) peuvent se connecter, via OIDC avec TOTP obligatoire. Trois rôles : `admin`, `chef_de_service`, `agent`. |
| Révocation immédiate | Le service d'administration désactive le compte Keycloak, désactive le compte Synapse, supprime tous ses appareils et invalide ses jetons. Le compte sort de tous les salons. Les clients restants renouvellent la clé de groupe Megolm au départ d'un membre, donc le compte révoqué ne déchiffre pas les nouveaux messages. |
| Minimisation des métadonnées | Présence désactivée, indicateurs de frappe désactivés, accusés de lecture publics désactivés, pas d'aperçus d'URL, rétention courte des journaux et des événements d'appareils. |
| Note de sécurité de 2 pages | Rédigée à partir de cette table et de la liste des métadonnées visibles ci-dessous. |

**Métadonnées que le serveur voit malgré tout** (à documenter, sans les cacher) : identifiants des comptes, appartenance aux salons, horodatage et taille de chaque message, taille des fichiers, adresses IP de connexion, liste des appareils. **Mesures** : suppression de la présence et des accusés publics, journaux courts, fédération désactivée, annuaire limité aux comptes locaux. **Ce qui reste visible** : « qui parle à qui et quand ». C'est une limite connue, à écrire telle quelle.

## 6. Innovation : la chaîne de commandement chiffrée

Trois volets qui se renforcent. Le message est classifié, la lecture est prouvée, l'interface est dans la langue de l'agent.

### 6.1 Classification des messages
Niveaux : `Normal`, `Diffusion restreinte`, `Confidentiel`. Le niveau est un champ **à l'intérieur** du contenu chiffré de l'événement : le serveur ne le voit pas.
- *Interdiction de transfert* : le client masque la fonction de transfert et refuse le transfert d'un message classifié.
- *Expiration automatique* : un délai fixé par la classification (ou choisi à l'envoi). À l'échéance, le client de l'expéditeur supprime le message pour tous (suppression Matrix) et chaque client le retire de son affichage.
- *Capture d'écran* : le web ne peut pas bloquer une capture. Mesure réaliste : un message `Confidentiel` est flouté dès que la fenêtre perd le focus ou que l'onglet passe en arrière-plan, avec un filigrane au nom de l'agent. **À écrire dans les limites** : un client modifié ou une photo de l'écran contourne ces mesures.

### 6.2 Accusé de lecture probant
Pour les « instructions de service » (un type de message à part), l'ouverture du message par le destinataire envoie un événement `ack` **chiffré de bout en bout**. Il contient l'identifiant de l'instruction, l'empreinte de son contenu et l'heure locale. Sa provenance est authentifiée par la signature d'appareil que Megolm applique déjà (aucune signature écrite par nous). L'expéditeur voit qui a lu et qui n'a pas lu, et peut exporter un **rapport de preuve** (JSON et PDF) : agent, appareil, empreinte, horodatage. **Limite** : l'horodatage vient du poste du lecteur, sans tiers de confiance ; à écrire dans la note.

### 6.3 Langues nationales
- Interface disponible en français et en **mooré**. Le dioula vient ensuite si le temps le permet.
- **Messages vocaux** : enregistrement dans le navigateur, envoyés comme pièces jointes audio chiffrées.
- Bonus de 3 points visé : interface ou messages vocaux dans une langue nationale.

## 7. Rôles et annuaire
`admin` : enrôle et révoque, voit l'état des comptes. `chef_de_service` : crée des canaux de service, émet des instructions de service avec accusé. `agent` : messages, groupes, fichiers. Annuaire interne par ministère et par fonction, alimenté par les attributs Keycloak.

## 8. Risques et replis

| Risque | Repli |
|---|---|
| Intégration OIDC Keycloak ↔ Synapse trop longue | Remplacer par la connexion Synapse classique, avec un TOTP géré par le service d'administration (bibliothèque TOTP standard). Le comportement visible reste le même. |
| Le client web est trop long à écrire | Se limiter à : connexion, salons chiffrés, fichiers, classification. L'accusé probant et le vocal passent après. |
| Traductions mooré inexactes | Les chaînes sont isolées dans un fichier. Elles doivent être relues par un locuteur avant la démo. |

## 9. Vérification (tests automatisés, bonus +2)
Un script de test, lancé après `docker compose up`, qui vérifie :
1. aucun texte de message ni nom de fichier lisible en clair dans la base Synapse et dans les journaux du proxy ;
2. un compte non enrôlé ne peut ni s'inscrire, ni rejoindre un salon ;
3. un compte révoqué reçoit `401` immédiatement et ne déchiffre plus les nouveaux messages d'un groupe ;
4. une classification n'apparaît pas dans les données stockées côté serveur ;
5. l'événement d'accusé de lecture est chiffré et rattaché à l'appareil du lecteur.

## 10. Choix laissés à l'équipe de construction
Structure du code client (framework), détail visuel, format exact du rapport de preuve.

## 11. Mes choix, à confirmer
- **Client web écrit sur `matrix-js-sdk`, et non un fork d'Element.** J'avais mentionné Element plus tôt ; je change d'avis parce que les trois volets d'innovation demandent un contrôle total de l'interface et qu'un fork d'Element est trop lourd pour 2 jours. Conséquence : le niveau d'engagement passe de « Étendre » à « Créer ».
- Licence AGPL-3.0-or-later.
- Mooré en premier, dioula ensuite. Mes traductions devront être relues par un locuteur.
- L'historique Git commence aujourd'hui : le dossier n'a pas encore de dépôt. Le brief demande des commits progressifs sur la durée du sprint, et on ne peut pas antidater honnêtement.
