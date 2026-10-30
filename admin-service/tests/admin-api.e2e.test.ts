import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { BASE, SYNAPSE, bearer, clientToken, secret } from './e2e-helpers.ts'

describe('SÉCURITÉ: API d\'administration derrière Caddy', () => {
  let adminHeaders: Record<string, string>
  beforeAll(async () => {
    adminHeaders = bearer(await clientToken('automation'))
  })
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