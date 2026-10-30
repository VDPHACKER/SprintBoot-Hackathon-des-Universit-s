import { describe, expect, it } from 'vitest'
import { enroll, revoke, type AgentInput } from '../src/agents.ts'
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
  const TOKEN = 'jeton-de-test-0123456789'
  const server = () => buildServer({ ...makeDeps(), adminToken: TOKEN })

  it('endpointsRequireAdminToken', async () => {
    const s = server()
    expect((await s.inject({ method: 'GET', url: '/agents' })).statusCode).toBe(401)
    expect(
      (await s.inject({ method: 'GET', url: '/agents', headers: { authorization: 'Bearer mauvais' } })).statusCode,
    ).toBe(403)
    expect(
      (await s.inject({ method: 'GET', url: '/agents', headers: { authorization: `Bearer ${TOKEN}` } })).statusCode,
    ).toBe(200)
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