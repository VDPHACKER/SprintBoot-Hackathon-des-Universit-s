# Plan de la vidéo de démonstration (3 minutes maximum)

Objectif : montrer un échange chiffré entre deux agents, la révocation d'un agent et la fonctionnalité innovante principale.
Préparer deux fenêtres de navigateur distinctes (ou un profil privé) et un terminal. Installation faite avant l'enregistrement.

| Temps | À l'écran | À dire |
|---|---|---|
| 0:00 – 0:15 | Terminal : `docker compose up -d --wait`, puis `docker compose ps` (tout est « healthy ») | Une seule commande installe tout, sans service tiers. |
| 0:15 – 0:55 | Fenêtre A : connexion de `awa.ouedraogo`, mot de passe puis **code TOTP** (`node scripts/totp-demo.mjs awa.ouedraogo`). Création d'un salon, invitation de `moussa.sawadogo`. Fenêtre B : `moussa.sawadogo` rejoint, échange de deux messages | L'identité est vérifiée par un second facteur. Le salon est chiffré de bout en bout. |
| 0:55 – 1:15 | Terminal : `docker compose exec postgres psql -U synapse -d synapse -c "select type, count(*) from events group by 1"` puis recherche du texte envoyé dans la base | Le serveur ne stocke que des événements chiffrés : le texte n'y est pas. |
| 1:15 – 1:50 | Troisième compte dans un groupe. Terminal : révocation (`POST /admin-api/agents/<compte>/revoke`, jeton `automation`). Fenêtre de l'agent révoqué : retour à l'écran de connexion avec le message d'avis. Un message suivant n'est plus lisible pour lui | Révocation immédiate : le jeton meurt, l'agent sort du groupe, la clé de groupe change. |
| 1:50 – 2:45 | **Innovation** : un chef de service envoie une *instruction de service* ; l'agent l'ouvre ; l'auteur voit « Lu par 1 sur 2 », exporte la preuve. Envoi d'un message *confidentiel* : badge, transfert impossible, flou quand on change de fenêtre. Court message vocal | La chaîne de commandement : qui a lu, quoi ne doit pas circuler, et la voix pour ceux qui écrivent peu. |
| 2:45 – 3:00 | Écran de limites (`docs/note-securite.md`, §4) | Nous disons aussi ce que le serveur voit encore et ce que nous ne garantissons pas. |

**Avant d'enregistrer** : répéter le parcours ; vérifier que les fonctions d'interface (fichiers, vocal, flou, accusés, langue)
fonctionnent bien dans votre navigateur, car elles ont été vérifiées par des tests automatisés mais pas toutes essayées à la
main. Utiliser uniquement les comptes fictifs du dépôt.