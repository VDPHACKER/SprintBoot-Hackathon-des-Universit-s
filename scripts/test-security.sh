#!/usr/bin/env bash
# Lance toutes les épreuves de sécurité automatisées (client puis administration) contre la pile en marche.
# Prérequis: docker compose -f compose.yaml -f compose.test.yaml up -d --wait
set -uo pipefail
cd "$(dirname "$0")/.."

status=0
echo "=== Client: chiffrement, serveur aveugle, révocation, classification, accusés, intrus ==="
(cd client && npm run --silent test:security) || status=1
echo
echo "=== Administration: identité, second facteur, API d'administration ==="
(cd admin-service && npm run --silent test:security) || status=1

echo
if [ "$status" -eq 0 ]; then echo "SÉCURITÉ: toutes les épreuves automatisées passent."; else echo "SÉCURITÉ: au moins une épreuve échoue." >&2; fi
exit "$status"