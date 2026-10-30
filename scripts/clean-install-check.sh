#!/usr/bin/env bash
# Preuve de l'installation en une commande: pile détruite puis relancée avec `docker compose up -d --wait`
# seul (sans surcharge de test), puis vérifiée de l'extérieur.
# ATTENTION: supprime les conteneurs, les volumes et le dossier data/ (secrets, configuration générée).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" != "--yes" ]; then
  echo "Ce script détruit conteneurs, volumes et data/. Relancer avec --yes pour confirmer." >&2
  exit 2
fi

# --rmi local: supprime aussi les images construites ici (service d'administration), pour tester une vraie construction.
docker compose -f compose.yaml -f compose.test.yaml down -v --rmi local
rm -rf data

start=$(date +%s)
docker compose up -d --wait
echo "installation terminée en $(( $(date +%s) - start )) s"

curl -sf http://localhost:8080/_matrix/client/versions > /dev/null && echo "OK  API Matrix (:8080)"
curl -sf http://localhost:8080/admin-api/health > /dev/null && echo "OK  service d'administration prêt (comptes de démonstration créés)"
curl -sf http://localhost:8081/realms/bf/.well-known/openid-configuration > /dev/null && echo "OK  identité Keycloak (:8081)"

echo "Pour lancer les tests: docker compose -f compose.yaml -f compose.test.yaml up -d --wait"
