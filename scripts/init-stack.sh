#!/usr/bin/env bash
# Initialisation idempotente: secrets générés une seule fois, configurations rendues à chaque démarrage.
set -euo pipefail

SECRETS=/secrets
DATA=/data
KC_IMPORT=/kc-import
mkdir -p "$SECRETS" "$DATA" "$KC_IMPORT"

gen() { python -c "import secrets; print(secrets.token_urlsafe(32))"; }

for name in postgres_password keycloak_db_password keycloak_admin_password registration_shared_secret \
            macaroon_secret_key form_secret synapse_oidc_secret automation_secret automation_agent_secret; do
  if [ ! -s "$SECRETS/$name" ]; then
    (umask 077; gen > "$SECRETS/$name")
    echo "secret généré: $name"
  fi
done

export DEMO_ACCOUNTS="${DEMO_ACCOUNTS:-true}"
export POSTGRES_PASSWORD REGISTRATION_SHARED_SECRET MACAROON_SECRET_KEY FORM_SECRET SYNAPSE_OIDC_SECRET AUTOMATION_SECRET AUTOMATION_AGENT_SECRET
POSTGRES_PASSWORD=$(cat "$SECRETS/postgres_password")
REGISTRATION_SHARED_SECRET=$(cat "$SECRETS/registration_shared_secret")
MACAROON_SECRET_KEY=$(cat "$SECRETS/macaroon_secret_key")
FORM_SECRET=$(cat "$SECRETS/form_secret")
SYNAPSE_OIDC_SECRET=$(cat "$SECRETS/synapse_oidc_secret")
AUTOMATION_SECRET=$(cat "$SECRETS/automation_secret")
AUTOMATION_AGENT_SECRET=$(cat "$SECRETS/automation_agent_secret")

# Le realm est verrouillé en lecture seule en fin de script: on le déverrouille avant de le réécrire.
[ -e "$KC_IMPORT/realm-bf.json" ] && chmod 0600 "$KC_IMPORT/realm-bf.json"

python - <<'PY'
import json
import os
from string import Template

# Synapse
src = open("/templates/homeserver.yaml.tmpl", encoding="utf-8").read()
open("/data/homeserver.yaml", "w", encoding="utf-8").write(Template(src).substitute(os.environ))

# Keycloak: les secrets sont substitués dans le gabarit; le profil utilisateur est inséré tel quel (JSON sérialisé).
realm = Template(open("/kc-templates/realm-bf.json.tmpl", encoding="utf-8").read()).substitute(os.environ)
realm = json.loads(realm)
profile = json.load(open("/kc-templates/user-profile.json", encoding="utf-8"))
realm["components"]["org.keycloak.userprofile.UserProfileProvider"][0]["config"]["kc.user.profile.config"] = [json.dumps(profile)]
# Comptes de démonstration (fictifs): identifiants importés avec le realm. Désactivables à l'installation
# avec DEMO_ACCOUNTS=false (sans effet sur un realm déjà importé).
if os.environ.get("DEMO_ACCOUNTS", "true").lower() == "true":
    for u in json.load(open("/kc-templates/demo-users.json", encoding="utf-8")):
        realm["users"].append({
            "username": u["username"],
            "enabled": True,
            "credentials": [
                {"type": "password", "value": u["password"], "temporary": False},
                {
                    "type": "otp",
                    "userLabel": "Compte de démonstration",
                    "secretData": json.dumps({"value": u["totpSecret"]}),
                    "credentialData": json.dumps({"subType": "totp", "digits": 6, "period": 30, "algorithm": "HmacSHA1", "counter": 0}),
                },
            ],
        })

fd = os.open("/kc-import/realm-bf.json", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as f:
    json.dump(realm, f, ensure_ascii=False, indent=2)
PY

cp /templates/log.config "$DATA/log.config"

# Clé de signature du serveur (créée seulement si absente). Le module no_plaintext est importé pendant la lecture de la configuration.
PYTHONPATH=/templates/modules python -m synapse.app.homeserver --config-path "$DATA/homeserver.yaml" --generate-keys

# Propriétaires: chaque secret appartient à l'identifiant (uid) du conteneur qui le lit, en lecture seule.
own() { chown "$2" "$SECRETS/$1"; chmod "${3:-0400}" "$SECRETS/$1"; }
own postgres_password 70:1000 0440
own keycloak_db_password 70:0 0440         # lu par PostgreSQL (uid 70) et Keycloak (uid 1000, groupe 0)
own keycloak_admin_password 1000:1000
own automation_secret 1000:1000            # lu par le service d'administration (uid 1000)
own automation_agent_secret 0:0
own registration_shared_secret 0:0
own macaroon_secret_key 0:0
own form_secret 0:0
own synapse_oidc_secret 0:0
chown 1000:1000 "$KC_IMPORT" "$KC_IMPORT/realm-bf.json"
chmod 0400 "$KC_IMPORT/realm-bf.json"

mkdir -p "$DATA/media_store"
chown -R 991:991 "$DATA"
echo "init terminé"