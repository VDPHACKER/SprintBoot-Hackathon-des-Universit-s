"""Module Synapse: le serveur refuse les contenus en clair qu'il peut reconnaître comme tels.

Dans cette messagerie, tout contenu d'un salon est chiffré de bout en bout PAR LE CLIENT. Sans ce module, un client
modifié ou ancien pourrait poster un message lisible dans un salon chiffré, et le serveur le stockerait. Ce module
ferme les chemins évidents vers du texte en clair.

Acceptés:
  - événements d'état de types STANDARDS uniquement (création, membres, droits, règles d'accès, historique, déclaration
    du chiffrement, nom, sujet, avatar, alias...). Un type d'état personnalisé est refusé: il ne servirait qu'à stocker
    du texte lisible;
  - événements m.room.encrypted dont la forme est celle d'un message Megolm: algorithme m.megolm.v1.aes-sha2, texte
    chiffré en base64 commençant par la version Megolm (« Aw »), et AUCUN champ de contenu en clair à côté
    (body, msgtype, formatted_body, url, info, file);
  - suppressions (m.room.redaction) SANS motif (le champ « reason » d'une suppression part en clair).
Tout autre événement (m.room.message, m.reaction, m.sticker, types applicatifs...) est refusé avec M_FORBIDDEN.

CE QUE CE MODULE NE PEUT PAS FAIRE, et qui reste possible pour un client malveillant:
  - mettre du texte lisible dans les champs libres des événements d'état standards (nom et sujet du salon, nom affiché,
    motif d'un départ): ces champs sont en clair PAR CONCEPTION dans Matrix;
  - fabriquer un « texte chiffré » qui a la bonne forme mais ne chiffre rien (le serveur ne peut pas le déchiffrer pour
    vérifier);
  - téléverser un fichier en clair dans le magasin de médias, ou écrire dans les données de compte et le profil: ces
    chemins ne passent pas par ce contrôle.
Ces limites sont documentées dans docs/note-securite.md.
"""
import re
from typing import Any, Dict

from synapse.module_api import NOT_SPAM, ModuleApi
from synapse.module_api.errors import Codes

ALLOWED_STATE_TYPES = frozenset(
    {
        "m.room.create",
        "m.room.member",
        "m.room.power_levels",
        "m.room.join_rules",
        "m.room.history_visibility",
        "m.room.encryption",
        "m.room.guest_access",
        "m.room.name",
        "m.room.topic",
        "m.room.avatar",
        "m.room.canonical_alias",
        "m.room.server_acl",
        "m.room.tombstone",
        "m.room.third_party_invite",
        "m.room.pinned_events",
    }
)

MEGOLM_ALGORITHM = "m.megolm.v1.aes-sha2"
# Un message Megolm commence par l'octet de version 3 puis une balise: en base64, « Aw ».
MEGOLM_CIPHERTEXT = re.compile(r"^Aw[A-Za-z0-9+/]+={0,2}$")
PLAINTEXT_KEYS = frozenset({"body", "msgtype", "formatted_body", "url", "info", "file"})


def _is_megolm_envelope(content: Any) -> bool:
    if content.get("algorithm") != MEGOLM_ALGORITHM:
        return False
    ciphertext = content.get("ciphertext")
    if not isinstance(ciphertext, str) or not MEGOLM_CIPHERTEXT.match(ciphertext):
        return False
    return not any(key in content for key in PLAINTEXT_KEYS)


class NoPlaintext:
    def __init__(self, config: Dict[str, Any], api: ModuleApi):
        self._api = api
        api.register_spam_checker_callbacks(check_event_for_spam=self.check_event_for_spam)

    @staticmethod
    def parse_config(config: Dict[str, Any]) -> Dict[str, Any]:
        return config

    async def check_event_for_spam(self, event):
        if event.is_state():
            return NOT_SPAM if event.type in ALLOWED_STATE_TYPES else Codes.FORBIDDEN
        if event.type == "m.room.encrypted":
            return NOT_SPAM if _is_megolm_envelope(event.content) else Codes.FORBIDDEN
        if event.type == "m.room.redaction":
            return Codes.FORBIDDEN if event.content.get("reason") else NOT_SPAM
        return Codes.FORBIDDEN