"""Crée le compte de service @svc-admin et enregistre son jeton dans /secrets/svc-admin.token.

Utilise l'API d'enregistrement à secret partagé de Synapse (HMAC-SHA1 imposé par cette API, bibliothèque
standard Python : ce n'est pas de la cryptographie écrite par l'équipe). Idempotent.
"""
import hashlib
import hmac
import json
import os
import secrets
import sys
import urllib.error
import urllib.request

BASE = "http://synapse:8008"
TOKEN_PATH = "/secrets/svc-admin.token"
USERNAME = "svc-admin"


def call(path, payload=None, token=None):
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read())


def token_is_valid(token):
    try:
        call("/_matrix/client/v3/account/whoami", token=token)
        return True
    except urllib.error.HTTPError:
        return False


if os.path.exists(TOKEN_PATH):
    existing = open(TOKEN_PATH, encoding="utf-8").read().strip()
    if existing and token_is_valid(existing):
        print("svc-admin déjà prêt")
        sys.exit(0)

shared_secret = open("/secrets/registration_shared_secret", encoding="utf-8").read().strip()
nonce = call("/_synapse/admin/v1/register")["nonce"]
password = secrets.token_urlsafe(32)
mac = hmac.new(shared_secret.encode(), digestmod=hashlib.sha1)
for part in (nonce, USERNAME, password, "admin"):
    mac.update(part.encode())
    if part != "admin":
        mac.update(b"\x00")

try:
    result = call(
        "/_synapse/admin/v1/register",
        {"nonce": nonce, "username": USERNAME, "password": password, "admin": True, "mac": mac.hexdigest()},
    )
except urllib.error.HTTPError as err:
    body = err.read().decode()
    if "taken" in body.lower() or "in use" in body.lower():
        sys.exit("svc-admin existe mais son jeton est perdu: relancer avec 'docker compose down -v'")
    sys.exit(f"échec de l'enregistrement de svc-admin: {err.code} {body}")

old_umask = os.umask(0o077)
with open(TOKEN_PATH, "w", encoding="utf-8") as f:
    f.write(result["access_token"])
os.umask(old_umask)
print("svc-admin créé")