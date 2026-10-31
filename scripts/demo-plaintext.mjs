#!/usr/bin/env node
// Démonstration (vidéo): un client MODIFIÉ essaie de déposer du texte lisible sur le serveur. Le serveur le refuse.
// Utilise un compte jetable créé par l'API d'enregistrement à secret partagé: nécessite compose.test.yaml (Synapse sur 127.0.0.1:8008).
import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CHAT = process.env.CHAT_URL ?? 'http://localhost:8080'
const DIRECT = process.env.SYNAPSE_DIRECT ?? 'http://127.0.0.1:8008'
const secret = readFileSync(resolve(import.meta.dirname, '../data/secrets/registration_shared_secret'), 'utf8').trim()

const direct = await fetch(`${DIRECT}/_synapse/admin/v1/register`).catch(() => undefined)
if (!direct?.ok) {
  console.error(`Synapse direct injoignable (${DIRECT}). Lancer: docker compose -f compose.yaml -f compose.test.yaml up -d --wait`)
  process.exit(1)
}
const { nonce } = await direct.json()
const username = `demo-intrus-${randomBytes(3).toString('hex')}`
const password = randomBytes(16).toString('hex')
const mac = createHmac('sha1', secret).update(`${nonce}\0${username}\0${password}\0notadmin`).digest('hex')
const reg = await fetch(`${DIRECT}/_synapse/admin/v1/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ nonce, username, password, admin: false, mac }),
})
const { access_token: token } = await reg.json()
const call = (method, path, body) =>
  fetch(`${CHAT}/_matrix/client/v3${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })

const room = await (await call('POST', '/createRoom', { name: 'Essai du client modifié', visibility: 'private' })).json()
const r = encodeURIComponent(room.room_id)
const txn = () => `t${randomBytes(4).toString('hex')}`

const attempts = [
  ['Message texte en clair', 'PUT', `/rooms/${r}/send/m.room.message/${txn()}`, { msgtype: 'm.text', body: 'Ceci est un message en clair' }],
  ['Événement d\'état personnalisé avec du texte', 'PUT', `/rooms/${r}/state/com.example.secret/cle`, { texte: 'texte lisible' }],
  ['Enveloppe « chiffrée » contenant du texte', 'PUT', `/rooms/${r}/send/m.room.encrypted/${txn()}`, { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'ceci est du texte lisible', body: 'en clair' }],
  ['Message chiffré de la forme attendue (légitime)', 'PUT', `/rooms/${r}/send/m.room.encrypted/${txn()}`, { algorithm: 'm.megolm.v1.aes-sha2', sender_key: 'k', session_id: 's', ciphertext: 'AwgAEnAEnAEnAEnAEnAEnA' }],
]

console.log(`Compte jetable: @${username}:chat.localhost, salon créé. Tentatives d'un client modifié:\n`)
for (const [label, method, path, body] of attempts) {
  const res = await call(method, path, body)
  const code = ((await res.json()).errcode ?? '').padEnd(12)
  console.log(`  ${res.status === 200 ? 'ACCEPTÉ ' : 'REFUSÉ  '} ${String(res.status)} ${code} ${label}`)
}