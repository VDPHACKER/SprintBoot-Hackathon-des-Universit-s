import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const secret = (n: string) => readFileSync(resolve(ROOT, 'data/secrets', n), 'utf8').trim()
const BASE = 'http://localhost:8080'
const SYNAPSE = 'http://127.0.0.1:8008'

describe('SÉCURITÉ: API d\'administration derrière Caddy', () => {
  const adminHeaders = { authorization: `Bearer ${secret('admin_api_token')}`, 'content-type': 'application/json' }
  const synapseUser = async (mxid: string) =>
    (await fetch(`${SYNAPSE}/_synapse/admin/v2/users/${encodeURIComponent(mxid)}`, {
      headers: { authorization: `Bearer ${secret('svc-admin.token')}` },
    })).json() as Promise<{ displayname?: string; deactivated?: boolean }>

  it('rejectsRequestsWithoutToken', async () => {
    expect((await fetch(`${BASE}/admin-api/agents`)).status).toBe(401)
  })

  it('enrollThenRevokeReachesSynapse', async () => {
    const username = `e2e-${randomBytes(4).toString('hex')}`
    const mxid = `@${username}:chat.localhost`
    const enrolled = await fetch(`${BASE}/admin-api/agents`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        username,
        displayName: 'Agent Test',
        ministry: 'Ministère fictif A',
        fonction: 'Testeur',
        role: 'agent',
      }),
    })
    expect(enrolled.status).toBe(201)
    expect(await synapseUser(mxid)).toMatchObject({ displayname: 'Agent Test', deactivated: false })

    const revoked = await fetch(`${BASE}/admin-api/agents/${username}/revoke`, { method: 'POST', headers: adminHeaders })
    expect(revoked.status).toBe(200)
    expect(await synapseUser(mxid)).toMatchObject({ deactivated: true })

    // Idempotent: une seconde révocation ne casse rien.
    const again = await fetch(`${BASE}/admin-api/agents/${username}/revoke`, { method: 'POST', headers: adminHeaders })
    expect(again.status).toBe(200)
  })
})