#!/usr/bin/env node
// Outil d'administration en ligne de commande: lister, enrôler et révoquer des agents (utile pour l'épreuve de révocation).
// Il s'authentifie auprès de Keycloak avec le compte technique `automation` (secret dans data/secrets/automation_secret),
// puis appelle le service d'administration. Aucune dépendance. Les adresses se changent avec CHAT_URL et KC_URL.
//
//   node scripts/admin.mjs list
//   node scripts/admin.mjs enroll <identifiant> "<Nom affiché>" "<Ministère>" "<Fonction>" <agent|chef_de_service|admin>
//   node scripts/admin.mjs revoke <identifiant>
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CHAT = process.env.CHAT_URL ?? 'http://localhost:8080'
const KEYCLOAK = process.env.KC_URL ?? 'http://localhost:8081'
const USAGE = `Usage:
  node scripts/admin.mjs list
  node scripts/admin.mjs enroll <identifiant> "<Nom affiché>" "<Ministère>" "<Fonction>" <agent|chef_de_service|admin>
  node scripts/admin.mjs revoke <identifiant>`

const fail = (message) => {
  console.error(message)
  process.exit(1)
}

const [command, ...args] = process.argv.slice(2)
const needs = { list: 0, enroll: 5, revoke: 1 }
if (!(command in needs) || args.length !== needs[command]) fail(USAGE)

let secret
try {
  secret = readFileSync(resolve(import.meta.dirname, '../data/secrets/automation_secret'), 'utf8').trim()
} catch {
  fail('Secret introuvable (data/secrets/automation_secret): la pile a-t-elle été démarrée depuis ce dossier ?')
}

const tokenResponse = await fetch(`${KEYCLOAK}/realms/bf/protocol/openid-connect/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'automation', client_secret: secret }),
}).catch((e) => fail(`Keycloak injoignable (${KEYCLOAK}): ${e.message}`))
if (!tokenResponse.ok) fail(`Authentification refusée (${tokenResponse.status})`)
const headers = { authorization: `Bearer ${(await tokenResponse.json()).access_token}`, 'content-type': 'application/json' }

async function call(method, path, body) {
  const res = await fetch(`${CHAT}/admin-api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  if (!res.ok) fail(`Refusé (${res.status}): ${text}`)
  return text ? JSON.parse(text) : {}
}

if (command === 'list') {
  console.log(JSON.stringify(await call('GET', '/agents'), null, 2))
} else if (command === 'enroll') {
  const [username, displayName, ministry, fonction, role] = args
  const { initialPassword, ...agent } = await call('POST', '/agents', { username, displayName, ministry, fonction, role })
  console.log(JSON.stringify(agent, null, 2))
  console.log(`\nMot de passe temporaire (affiché UNE SEULE FOIS, à changer à la première connexion): ${initialPassword}`)
  console.log('Le second facteur (TOTP) sera à enregistrer à la première connexion.')
} else {
  console.log(JSON.stringify(await call('POST', `/agents/${encodeURIComponent(args[0])}/revoke`), null, 2))
}