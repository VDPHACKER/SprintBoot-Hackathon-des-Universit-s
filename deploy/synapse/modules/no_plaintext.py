"""Module Synapse: le serveur refuse tout contenu en clair.

Dans cette messagerie, tout contenu d'un salon est chiffré de bout en bout PAR LE CLIENT. Sans ce module, un client
modifié ou ancien pourrait poster un message lisible dans un salon chiffré, et le serveur le stockerait. Ce module
transforme la règle « le serveur ne stocke aucun message en clair » en garantie appliquée par le serveur lui-même.

Sont acceptés:
  - les événements d'état (nom du salon, membres, droits, déclaration du chiffrement...): ils ne sont pas chiffrés par
    Matrix, et sont documentés comme métadonnées visibles du serveur;
  - les événements chiffrés (m.room.encrypted);
  - les suppressions (m.room.redaction).
Tout autre événement (m.room.message, m.reaction, m.sticker, types applicatifs...) est refusé avec M_FORBIDDEN.

Ce que le serveur ne peut pas vérifier: que le contenu d'un m.room.encrypted soit réellement chiffré (il ne peut pas
le savoir sans le déchiffrer). Un client malveillant pourrait y mettre n'importe quoi; il ne pourrait pas y mettre
du texte « en clair » reconnaissable sans que ce soit son propre choix de le publier illisible.
"""
from typing import Any, Dict

from synapse.module_api import NOT_SPAM, ModuleApi
from synapse.module_api.errors import Codes

ALLOWED_NON_STATE_TYPES = frozenset({"m.room.encrypted", "m.room.redaction"})


class NoPlaintext:
    def __init__(self, config: Dict[str, Any], api: ModuleApi):
        self._api = api
        api.register_spam_checker_callbacks(check_event_for_spam=self.check_event_for_spam)

    @staticmethod
    def parse_config(config: Dict[str, Any]) -> Dict[str, Any]:
        return config

    async def check_event_for_spam(self, event):
        if event.is_state() or event.type in ALLOWED_NON_STATE_TYPES:
            return NOT_SPAM
        return Codes.FORBIDDEN