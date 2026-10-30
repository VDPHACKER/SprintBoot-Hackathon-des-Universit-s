#!/usr/bin/env bash
# Initialisation idempotente : secrets générés une seule fois, configuration Synapse rendue à chaque démarrage.
set -euo pipefail

SECRETS=/secrets
DATA=/data
mkdir -p "$SECRETS" "$DATA"

gen() { python -c "import secrets; print(secrets.token_urlsafe(32))"; }

for name in postgres_password registration_shared_secret macaroon_secret_key form_secret; do
  if [ ! -s "$SECRETS/$name" ]; then
    (umask 077; gen > "$SECRETS/$name")
    echo "secret généré: $name"
  fi
done

export POSTGRES_PASSWORD REGISTRATION_SHARED_SECRET MACAROON_SECRET_KEY FORM_SECRET
POSTGRES_PASSWORD=$(cat "$SECRETS/postgres_password")
REGISTRATION_SHARED_SECRET=$(cat "$SECRETS/registration_shared_secret")
MACAROON_SECRET_KEY=$(cat "$SECRETS/macaroon_secret_key")
FORM_SECRET=$(cat "$SECRETS/form_secret")

python - <<'PY'
import os
from string import Template

src = open("/templates/homeserver.yaml.tmpl", encoding="utf-8").read()
out = Template(src).substitute(os.environ)
open("/data/homeserver.yaml", "w", encoding="utf-8").write(out)
PY

cp /templates/log.config "$DATA/log.config"

# Clé de signature du serveur (créée seulement si absente).
python -m synapse.app.homeserver --config-path "$DATA/homeserver.yaml" --generate-keys

mkdir -p "$DATA/media_store"
chown -R 991:991 "$DATA"
echo "init terminé"