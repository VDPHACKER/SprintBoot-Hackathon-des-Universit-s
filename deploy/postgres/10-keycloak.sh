#!/bin/sh
# Exécuté une seule fois, à la création du volume PostgreSQL: base et rôle dédiés à Keycloak.
set -e
KC_PASSWORD=$(cat /secrets/keycloak_db_password)
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres <<SQL
CREATE ROLE keycloak LOGIN PASSWORD '$KC_PASSWORD';
CREATE DATABASE keycloak OWNER keycloak ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;
SQL