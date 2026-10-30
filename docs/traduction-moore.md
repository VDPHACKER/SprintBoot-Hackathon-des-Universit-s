# Interface en mooré : état et sources

**Statut : partiel.** L'interface sait fonctionner dans plusieurs langues (choix de la langue sur l'écran de connexion et
dans le menu latéral). Seules les expressions **attestées dans un dictionnaire** sont en mooré ; tout le reste s'affiche
en français. Aucune traduction n'a été inventée.

## Source

Niggli, Urs (éd.). 2016. *Dictionnaire mooré - français.* SIL International, publié sur Webonary
(<https://www.webonary.org/moore/>). Les entrées ci-dessous viennent du domaine sémantique 3.5.9.6
« Appareils de communication », qui contient le vocabulaire d'interface d'un téléphone et d'un site web.

Le site indique « © 2016 SIL International » et n'énonce pas de licence de réutilisation : le dictionnaire est ici
**cité comme source** (quelques expressions isolées), il n'est ni copié ni redistribué. À vérifier auprès de SIL avant toute
reprise plus large.

## Entrées utilisées

| Clé | Français | Mooré | Entrée du dictionnaire |
|---|---|---|---|
| `login` | Se connecter | N kẽ tõkr pʋgẽ | « N kẽ tõkr pʋgẽ » = « Se connecter » (Log in) |
| `send` | Envoyer | N tʋm koɛɛgã | « N tʋm koɛɛgã » = « Envoyer le message » (Send message) |
| `download` | Télécharger | N moke | « N moke » = « Télécharger » (synonyme : « Dɩke n kẽese ») |
| `messageLabel` | Votre message | Yãmb koɛɛgã | « yãmb » (votre) + « koɛɛgã » (message), attestés dans « Yãmb koɛɛgã tʋmame tɩ kẽnge » = « Votre message a été envoyé » |
| `attach` | Joindre un fichier | Fisiye | « fisiye » = « fichier (dans l'ordinateur) ». Simplification : « Fichier » au lieu de « Joindre un fichier » |
| `voicePlay` | Écouter | N deem | « N deem » = « Jouer » (Play). Simplification : sert aussi à « Écouter » |

## À faire valider ou compléter par un locuteur

Tous les autres libellés restent en français. Pour en traduire un, il suffit d'ajouter sa clé dans
`client/src/i18n/mos.json` (le test `mooreHasNoUnknownKeys` vérifie que la clé existe), puis de reconstruire le client.
Les niveaux de classification (`levels.*`) et le vocabulaire administratif devraient suivre la terminologie officielle
plutôt qu'une traduction libre.

Libellés encore en français :

- `appTitle` : Messagerie souveraine
- `loginIntro` : Réservé aux agents enrôlés. La connexion demande votre mot de passe puis un code à usage unique.
- `revoked` : Votre accès à la messagerie a été retiré ou votre session a pris fin. Si c’est une erreur, contactez votre administrateur.
- `logout` : Se déconnecter
- `newRoom` : Nouveau salon
- `roomName` : Nom du salon
- `invitees` : Agents à inviter (séparés par des virgules)
- `create` : Créer
- `invitations` : Invitations
- `join` : Rejoindre
- `rooms` : Salons
- `noRoom` : Choisissez ou créez un salon.
- `level` : Niveau de classification
- `noForward` : Transfert interdit.
- `instruction` : Instruction de service
- `instructionLabel` : Instruction de service (avec accusé de lecture)
- `pendingLabel` : En attente :
- `exportProof` : Exporter la preuve (JSON)
- `printProof` : Imprimer la preuve
- `proofTitle` : Preuve de lecture d’une instruction de service
- `proofInstruction` : Empreinte SHA-256 du texte
- `proofAgent` : Agent
- `proofDevice` : Appareil
- `proofReadAt` : Lu le
- `proofPending` : Pas encore lu
- `forwardTo` : Transférer vers…
- `forwarded` : Message transféré.
- `encrypted` : Chiffré de bout en bout
- `notEncrypted` : ATTENTION: ce salon n’est pas chiffré
- `decrypting` : Déchiffrement en cours…
- `undecryptable` : Message illisible (clé non reçue)
- `starting` : Connexion en cours…
- `language` : Langue
- `voiceRecord` : Enregistrer un message vocal
- `voiceStop` : Arrêter et envoyer
- `voiceRecording` : Enregistrement en cours…
- `voiceMessage` : Message vocal
- `readBy` : Lu par {read} sur {total}
- `expiresAt` : Expire le {when}.
- `expiresIn` : Expire dans {hours} h.
- `levels.normal` : Normal
- `levels.restreinte` : Diffusion restreinte
- `levels.confidentiel` : Confidentiel
- `errors.INVALID_USER` : Identifiant d’agent invalide.
- `errors.EMPTY_ROOM_NAME` : Le nom du salon est obligatoire.
- `errors.EMPTY_FILE` : Le fichier est vide.
- `errors.NOT_AUTHORITY` : Seuls les modérateurs du salon peuvent émettre une instruction de service.
- `errors.FORWARD_FORBIDDEN` : Ce niveau de classification interdit le transfert.
- `errors.NOT_A_MESSAGE` : Ce message ne peut pas être transféré.
- `errors.INVALID_TTL` : Durée d’expiration invalide.
- `errors.FILE_TOO_LARGE` : Le fichier dépasse la taille autorisée.
- `errors.DOWNLOAD_FAILED` : Le téléchargement a échoué ou le fichier a été altéré.
- `errors.MIC_DENIED` : Le microphone n’est pas accessible. Autorisez-le dans le navigateur.
- `errors.generic` : Une erreur est survenue. Réessayez.

## Limites connues

- Les entrées sont des expressions de menu : leur forme exacte (impératif, accord de classe, ton) doit être confirmée par
  un locuteur avant tout usage officiel.
- Les **messages vocaux** ne dépendent d'aucune traduction : un agent peut parler en mooré, en dioula ou dans toute autre
  langue, ce qui sert aussi les agents peu à l'aise à l'écrit.
- Le dioula n'est pas pris en charge.
