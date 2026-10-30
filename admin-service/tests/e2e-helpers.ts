import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '../..')
export const BASE = 'http://localhost:8080'
/** Keycloak par Caddy (:8081) et en direct (boucle locale, compose.test.yaml uniquement). */
export const KC_PUBLIC = 'http://localhost:8081'
export const KC_DIRECT = 'http://127.0.0.1:8180'
export const SYNAPSE = 'http://127.0.0.1:8008'
export const REALM_ISSUER = 'http://auth.localhost:8081/realms/bf'

export const secret = (name: string) => readFileSync(resolve(ROOT, 'data/secrets', name), 'utf8').trim()

/** Jeton d'un compte technique (client_credentials). */
export async function clientToken(clientId: 'automation' | 'automation-agent'): Promise<string> {
  const res = await fetch(`${KC_DIRECT}/realms/bf/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: secret(clientId === 'automation' ? 'automation_secret' : 'automation_agent_secret'),
    }),
  })
  if (!res.ok) throw new Error(`jeton ${clientId}: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { access_token: string }).access_token
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' })