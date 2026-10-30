# Note de sécurité

## 1. Hypothèses

Le serveur est **hébergé par l'État mais considéré comme curieux** : il doit fonctionner sans pouvoir lire. Le navigateur
de l'agent est de confiance tant que l'agent est enrôlé. Seules des données fictives sont utilisées.

## 2. Menaces prises en compte et protections

| Menace | Protection | Vérifié par |
|---|---|---|
| Lecture de la base, des journaux ou du trafic par l'hébergeur | Chiffrement de bout en bout Matrix (Olm/Megolm, bibliothèque officielle, **aucune cryptographie maison**), pièces jointes et vocaux chiffrés dans le navigateur | scénario complet sans aucun marqueur en clair dans la base, les journaux ni le magasin de médias |
| Client modifié postant du texte lisible | Module serveur `no_plaintext` : refuse (403) tout événement de contenu non chiffré | texte, réaction, autocollant, type applicatif refusés ; aucun `m.room.message` stocké |
| Intrus non enrôlé | Inscription fermée, invités refusés, connexion par mot de passe désactivée dans Synapse (identité uniquement par Keycloak), salons sur invitation, API d'administration non exposée | inscription 403, jeton forgé 401, adhésion sans invitation 403 |
| Mot de passe volé | **Second facteur TOTP obligatoire** pour tous (flux d'authentification dédié, accès direct désactivé) | le mot de passe seul ne délivre aucun code d'autorisation |
| Départ d'un agent, appareil perdu | Révocation : compte coupé dans Keycloak puis Synapse, jetons et appareils supprimés, sortie des salons, **nouvelle clé de groupe** | jeton refusé en moins de 2 s ; le message suivant utilise une autre clé ; le client ouvert se déconnecte et efface ses clés |
| Falsification d'un accusé ou d'une pièce jointe | Empreinte SHA-256 du texte dans l'accusé ; empreinte vérifiée au déchiffrement des fichiers ; auteur et appareil authentifiés par le chiffrement de groupe | accusé à l'empreinte fausse ignoré ; fichier falsifié rejeté |
| Fuite par transfert, relecture, vol de session | Transfert interdit (recalculé selon le niveau, un champ falsifié est ignoré) ; expiration ; CSP stricte, texte inséré sans HTML ; accès authentifié aux médias | tests unitaires et d'intégration |

## 3. Ce que le serveur voit malgré tout (mesuré dans la base)

| Visible | Détail | Réduction |
|---|---|---|
| Comptes et appareils | identifiants, nom affiché, appareils | aucun e-mail ni téléphone côté messagerie |
| **Salons** | **nom, sujet, membres, droits** : événements d'état, non chiffrés par Matrix | ne pas y mettre d'information sensible |
| Pour chaque message | expéditeur, salon, heure, taille ; tous apparaissent comme « chiffré » | le texte, le niveau, le type (texte, fichier, vocal) et les accusés sont indiscernables |
| Connexions | adresse IP, navigateur, dernière activité | conservées 7 jours |
| Fichiers | taille et heure ; **pas de nom**, type générique | contenu chiffré |
| Présence, accusés publics, aperçus de liens, notifications externes | **0 ligne mesurée** | désactivés ou non émis |

« Qui parle à qui, et quand » reste donc **visible** ; seule l'équipe d'exploitation du serveur y a accès. L'identité
(ministère, fonction, rôle, journal de connexion) vit dans Keycloak, séparée du serveur de messagerie.

## 4. Limites connues

- **Noms de salons et membres lisibles** par le serveur (voir §3). Un test fige cette limite.
- Le serveur **ne peut pas vérifier** qu'un événement « chiffré » l'est vraiment ; le module ferme le cas d'un texte en clair, pas
  celui d'un client qui dissimulerait du texte dans l'enveloppe chiffrée.
- **Captures d'écran** : impossibles à bloquer sur le web. Le flou et le filigrane dissuadent, ils n'empêchent pas une photo.
- **Expiration** : chaque client masque le message à l'échéance, l'expéditeur le supprime s'il est en ligne ; le message
  chiffré reste sur le serveur sinon, et un destinataire qui l'a lu garde ses clés jusqu'au rechargement.
- **Horloges** : les heures de lecture et d'expiration sont celles de chaque appareil, sans tiers de confiance.
- **Vérification des appareils** absente de l'interface : un serveur malveillant pourrait ajouter un appareil à un compte.
- Jeton et clés dans le navigateur, **non chiffrés au repos** : un accès à la machine ou une faille de script les expose.
- Révocation : n'efface pas ce que l'agent a déjà lu ; un appareil volé garde sa copie jusqu'à sa prochaine requête.
- **Autorité d'une instruction** : fondée sur le rôle de modérateur du salon (vérifiée par les clients), pas sur le rôle Keycloak.
- Démonstration en HTTP local : `skip_verification` (Synapse), `sslRequired: none` (Keycloak). **Non utilisables en production.**
- Identifiants de démonstration publics : à désactiver avant toute vraie installation (`DEMO_ACCOUNTS=false`).
- Droits de fichiers des secrets éprouvés uniquement sous Docker Desktop (Windows) ; pas de test de charge ni d'audit externe.

## 5. Vérifications automatisées

`bash scripts/test-security.sh` : **51 épreuves de sécurité** sur la pile en marche (143 tests automatisés au total). Elles
couvrent les épreuves du jury : serveur aveugle (base, journaux, médias), révocation en conversation de groupe, intrus,
et les fonctions d'innovation. Un test de mutation a révélé, puis fait corriger, l'acceptation d'un message en clair par le
serveur : c'est l'origine du module `no_plaintext`.

## 6. Avant une mise en service réelle

TLS partout et retrait des deux réglages de démonstration ; `DEMO_ACCOUNTS=false` ; secrets hors du dossier de travail
(coffre) ; console d'administration de Keycloak accessible par un réseau d'exploitation seulement ; politique de rétention
des anciens messages chiffrés ; sauvegardes chiffrées ; revue indépendante.