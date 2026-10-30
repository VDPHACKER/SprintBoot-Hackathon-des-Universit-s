#!/usr/bin/env node
// Affiche le code à 6 chiffres actuel d'un compte de démonstration (second facteur), sans application d'authentification.
// Usage: node scripts/totp-demo.mjs awa.ouedraogo
// Les secrets sont ceux, publics et fictifs, de deploy/keycloak/demo-users.json. C'est l'algorithme TOTP standard
// (RFC 6238); le serveur fait sa propre vérification. Ne sert qu'aux comptes de démonstration.
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const username = process.argv[2]
const users = JSON.parse(readFileSync(resolve(import.meta.dirname, '../deploy/keycloak/demo-users.json'), 'utf8'))
const user = users.find((u) => u.username === username)
if (!user) {
  console.error(`Compte inconnu. Comptes de démonstration: ${users.map((u) => u.username).join(', ')}`)
  process.exit(1)
}

const counter = Buffer.alloc(8)
counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
const hmac = createHmac('sha1', Buffer.from(user.totpSecret, 'utf8')).update(counter).digest()
const offset = hmac[hmac.length - 1] & 0xf
const code = String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30)
console.log(`${code}   (valable encore ${secondsLeft} s)`)