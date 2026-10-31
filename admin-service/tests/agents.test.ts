import { describe, expect, it } from 'vitest'
import { enroll, revoke, type AgentInput } from '../src/agents.ts'
import { roleGuard, type TokenVerifier } from '../src/auth.ts'
import { buildServer } from '../src/server.ts'
import { FakeIdentity, FakeSynapse } from './fakes.ts'

const awa: AgentInput = {
  username: 'awa.ouedraogo',
  displayName: 'Awa Ouédraogo',
  ministry: 'Ministère fictif A',
  fonction: 'Chargée de mission',
  role: 'agent',
}

function makeDeps() {
  const log: string[] = []
  return { log, identity: new FakeIdentity(log), synapse: new FakeSynapse(log), domain: 'chat.localhost' }
}

describe('enroll', () => {
  it('enrollRejectsUnknownRole', async () => {
    const d = makeDeps()
    await expect(enroll(d, { ...awa, role: 'ministre' as never })).rejects.toThrow('INVALID_ROLE')
    expect(d.log).toEqual([])
  })

  it('enrollRejectsBadUsername', async () => {
    const d = makeDeps()
    await expect(enroll(d, { ...awa, username: 'Awa Ouedraogo' })).rejects.toThrow('INVALID_USERNAME')
    await expect(enroll(d, { ...awa, username: 'ab' })).rejects.toThrow('INVALID_USERNAME')
    expect(d.log).toEqual([])
  })

  it('enrollRejectsEmptyOrNonStringFields', async () => {
    const d = makeDeps()
    await expect(enroll(d, { ...awa, displayName: '  ' })).rejects.toThrow('INVALID_FIELD')
    await expect(enroll(d, { ...awa, ministry: 42 as never })).rejects.toThrow('INVALID_FIELD')
    await expect(enroll(d, null as never)).rejects.toThrow('INVALID_USERNAME')
    await expect(enroll(d, { ...awa, initialPassword: 'court' })).rejects.toThrow('INVALID_FIELD')
    expect(d.log).toEqual([])
  })

  it('anEnrolmentInterruptedAfterTheIdentityStepCanSimplyBeRetried', async () => {
    // Keycloak réussit, Synapse échoue: l'agent est à moitié créé. Rejouer la même demande doit terminer le travail.
    const log: string[] = []
    let synapseUp = false
    const identity = new FakeIdentity(log)
    const synapse = {
      upsertUser: async (mxid: string) => {
        if (!synapseUp) throw new Error('Synapse indisponible')
        log.push(`synapse.upsertUser:${mxid}`)
      },
      deactivate: async () => undefined,
    }
    const d = { identity, synapse, domain: 'chat.localhost' }
    await expect(enroll(d, awa)).rejects.toThrow('Synapse indisponible')
    synapseUp = true
    await expect(enroll(d, awa)).resolves.toMatchObject({ username: 'awa.ouedraogo', status: 'active' })
    expect(await identity.listUsers()).toHaveLength(1)
    expect(log).toContain('synapse.upsertUser:@awa.ouedraogo:chat.localhost')
  })

  it('enrollRefusesAnAccountThatWasRevokedInsteadOfClaimingItIsActive', async () => {
    // Relecture indépendante: ré-enrôler un nom révoqué laissait Keycloak et Synapse désactivés mais répondait « active ».
    const d = makeDeps()
    await enroll(d, awa)
    await revoke(d, 'awa.ouedraogo')
    d.log.length = 0
    await expect(enroll(d, awa)).rejects.toThrow('REVOKED_ACCOUNT')
    expect(d.log, 'rien ne doit être recréé ni mis à jour').toEqual([])
    expect((await d.identity.listUsers())[0].status).toBe('revoked')
  })

  it('enrollAndRevokeRejectReservedTechnicalNames', async () => {
    // Enrôler « svc-admin » ferait coïncider un agent avec le compte d'administration de Synapse (allow_existing_users).
    const d = makeDeps()
    for (const username of ['svc-admin', 'service-account-automation', 'service-account-x']) {
      await expect(enroll(d, { ...awa, username }), username).rejects.toThrow('INVALID_USERNAME')
      await expect(revoke(d, username), username).rejects.toThrow('INVALID_USERNAME')
    }
    expect(d.log).toEqual([])
  })

  it('enrollCreatesIdentityThenSynapseUser', async () => {
    const d = makeDeps()
    const agent = await enroll(d, awa)
    expect(agent.status).toBe('active')
    expect(d.log).toEqual([
      'identity.createUser:awa.ouedraogo',
      'synapse.upsertUser:@awa.ouedraogo:chat.localhost:Awa Ouédraogo',
    ])
  })
})

describe('revoke', () => {
  it('revokeDisablesIdentityBeforeSynapse', async () => {
    const d = makeDeps()
    await enroll(d, awa)
    d.log.length = 0
    const report = await revoke(d, 'awa.ouedraogo')
    expect(d.log).toEqual(['identity.disableUser:awa.ouedraogo', 'synapse.deactivate:@awa.ouedraogo:chat.localhost'])
    expect(report).toEqual({ username: 'awa.ouedraogo', identityDisabled: true, synapseDeactivated: true })
  })

  it('revokeIsIdempotent', async () => {
    const d = makeDeps()
    await enroll(d, awa)
    const first = await revoke(d, 'awa.ouedraogo')
    const second = await revoke(d, 'awa.ouedraogo')
    expect(second).toEqual(first)
  })

  it('revokeRejectsBadUsername', async () => {
    const d = makeDeps()
    await expect(revoke(d, '../../admin')).rejects.toThrow('INVALID_USERNAME')
    expect(d.log).toEqual([])
  })
})

describe('endpoints', () => {
  const TOKEN = 'jwt-admin'
  const verify: TokenVerifier = async (t) => {
    if (t === TOKEN) return { roles: ['admin'] }
    if (t === 'jwt-agent') return { roles: ['agent'] }
    throw new Error('invalide')
  }
  const server = () => buildServer({ ...makeDeps(), adminGuard: roleGuard(verify, 'admin') })

  it('endpointsRequireAdminRole', async () => {
    const s = server()
    const get = (h?: Record<string, string>) => s.inject({ method: 'GET', url: '/agents', headers: h })
    expect((await get()).statusCode).toBe(401)
    expect((await get({ authorization: 'Bearer mauvais' })).statusCode).toBe(401)
    expect((await get({ authorization: 'Bearer jwt-agent' })).statusCode).toBe(403)
    expect((await get({ authorization: `Bearer ${TOKEN}` })).statusCode).toBe(200)
  })

  it('postAgentsAnswers409ForARevokedAccount', async () => {
    const s = server()
    const headers = { authorization: `Bearer ${TOKEN}` }
    await s.inject({ method: 'POST', url: '/agents', headers, payload: awa })
    await s.inject({ method: 'POST', url: '/agents/awa.ouedraogo/revoke', headers })
    const again = await s.inject({ method: 'POST', url: '/agents', headers, payload: awa })
    expect(again.statusCode).toBe(409)
    expect(again.json()).toEqual({ error: 'REVOKED_ACCOUNT' })
  })

  it('healthNeedsNoToken', async () => {
    expect((await server().inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
  })

  it('postAgentsEnrollsAndMapsErrorsTo400', async () => {
    const s = server()
    const headers = { authorization: `Bearer ${TOKEN}` }
    const ok = await s.inject({ method: 'POST', url: '/agents', headers, payload: awa })
    expect(ok.statusCode).toBe(201)
    const bad = await s.inject({ method: 'POST', url: '/agents', headers, payload: { ...awa, role: 'ministre' } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json()).toEqual({ error: 'INVALID_ROLE' })
  })

  it('postAgentsReturnsInitialPasswordOnceAndNeverListsIt', async () => {
    const s = server()
    const headers = { authorization: `Bearer ${TOKEN}` }
    const created = await s.inject({ method: 'POST', url: '/agents', headers, payload: awa })
    expect(created.json().initialPassword).toMatch(/^.{12,}$/)
    const listed = await s.inject({ method: 'GET', url: '/agents', headers })
    expect(JSON.stringify(listed.json())).not.toContain('initialPassword')
  })

  it('directoryListsOnlyActiveAgentsOfMinistryWithoutRole', async () => {
    const s = server()
    const headers = { authorization: `Bearer ${TOKEN}` }
    await s.inject({ method: 'POST', url: '/agents', headers, payload: awa })
    await s.inject({
      method: 'POST',
      url: '/agents',
      headers,
      payload: { ...awa, username: 'issa.kabore', displayName: 'Issa Kaboré', ministry: 'Ministère fictif B' },
    })
    await s.inject({
      method: 'POST',
      url: '/agents',
      headers,
      payload: { ...awa, username: 'moussa.sawadogo', displayName: 'Moussa Sawadogo' },
    })
    await s.inject({ method: 'POST', url: '/agents/moussa.sawadogo/revoke', headers })
    const res = await s.inject({
      method: 'GET',
      url: `/directory?ministry=${encodeURIComponent('Ministère fictif A')}`,
      headers,
    })
    expect(res.json()).toEqual([
      { username: 'awa.ouedraogo', displayName: 'Awa Ouédraogo', ministry: 'Ministère fictif A', fonction: 'Chargée de mission' },
    ])
  })
})