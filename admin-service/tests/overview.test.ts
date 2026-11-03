import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { enroll, revoke, type AgentInput } from '../src/agents.ts'
import { FileAuditLog } from '../src/audit.ts'
import { roleGuard, type TokenVerifier } from '../src/auth.ts'
import { buildArchive, describeMembers, isRoomId, serverStatus, verifyArchive, type ArchiveDocument } from '../src/overview.ts'
import { buildServer } from '../src/server.ts'
import { FakeIdentity, FakeSynapse } from './fakes.ts'

const agent = (username: string, role: AgentInput['role'] = 'agent'): AgentInput => ({
  username, displayName: `Agent ${username}`, ministry: 'Ministère fictif A', fonction: 'Testeur', role,
})

async function setup() {
  const log: string[] = []
  const synapse = new FakeSynapse(log)
  const deps = { identity: new FakeIdentity(log), synapse, domain: 'chat.localhost' }
  await enroll(deps, agent('admin.demo', 'admin'))
  await enroll(deps, agent('awa'))
  await enroll(deps, agent('moussa'))
  synapse.rooms = [
    { roomId: '!abc:chat.localhost', name: 'Cabinet', creator: '@awa:chat.localhost', members: 2, encryption: 'm.megolm.v1.aes-sha2' },
    { roomId: '!def:chat.localhost', name: 'Salon clair', creator: '@awa:chat.localhost', members: 1, encryption: null },
  ]
  synapse.members.set('!abc:chat.localhost', ['@awa:chat.localhost', '@moussa:chat.localhost', '@etranger:autre.serveur'])
  const audit = new FileAuditLog(await mkdtemp(join(tmpdir(), 'ov-')))
  return { deps, synapse, audit }
}

describe('isRoomId', () => {
  it('acceptsMatrixRoomIdsAndRejectsEverythingElse', () => {
    expect(isRoomId('!abc123:chat.localhost')).toBe(true)
    expect(isRoomId('!YwvhdXxJMHrVJn6_VcmF9q8Pyg6Ls5NdLZqOfyNOQcw')).toBe(true) // versions récentes: sans partie serveur
    for (const bad of ['abc:chat.localhost', '!', '!a/../b:x', '!abc:chat.localhost?x=1', '', '!a b:x', '!abc:host/evil']) expect(isRoomId(bad)).toBe(false)
  })
})

describe('describeMembers', () => {
  it('namesEnrolledAgentsAndKeepsForeignIdsVisible', async () => {
    const { deps } = await setup()
    await revoke(deps, 'moussa')
    const members = describeMembers(['@awa:chat.localhost', '@moussa:chat.localhost', '@etranger:autre.serveur'], await deps.identity.listUsers(), 'chat.localhost')
    expect(members).toEqual([
      { mxid: '@awa:chat.localhost', username: 'awa', displayName: 'Agent awa', status: 'active' },
      { mxid: '@moussa:chat.localhost', username: 'moussa', displayName: 'Agent moussa', status: 'revoked' },
      { mxid: '@etranger:autre.serveur', displayName: '@etranger:autre.serveur' },
    ])
  })
})

describe('serverStatus', () => {
  it('countsAgentsAndFlagsUnencryptedRooms', async () => {
    const { deps, audit } = await setup()
    await revoke(deps, 'moussa')
    await audit.append({ actor: 'admin.demo', action: 'revoke', target: 'moussa' })
    const s = await serverStatus(deps, audit, Date.now() - 5000)
    expect(s.agents).toEqual({ total: 3, active: 2, revoked: 1, admins: 1 })
    expect(s.rooms).toEqual({ total: 2, encrypted: 1, unencrypted: 1 })
    expect(s.synapse).toEqual({ reachable: true, version: '1.0.0-test' })
    expect(s.audit).toEqual({ entries: 1, chainValid: true })
    expect(s.uptimeSeconds).toBeGreaterThanOrEqual(5)
  })

  it('reportsAnUnreachableComponentInsteadOfFailing', async () => {
    const { deps, synapse } = await setup()
    synapse.version = async () => { throw new Error('hors ligne') }
    synapse.listRooms = async () => { throw new Error('hors ligne') }
    const s = await serverStatus(deps, undefined, Date.now())
    expect(s.synapse.reachable).toBe(false)
    expect(s.rooms).toBeUndefined()
    expect(s.identity.reachable).toBe(true)
  })
})

describe('buildArchive', () => {
  it('containsMetadataOnlyAndAVerifiableDigest', async () => {
    const { deps, audit } = await setup()
    await audit.append({ actor: 'admin.demo', action: 'enroll', target: 'awa' })
    const doc = await buildArchive(deps, audit)
    expect(doc.contentArchived).toBe(false)
    expect(doc.rooms[0]?.memberList.map((m) => m.displayName)).toEqual(['Agent awa', 'Agent moussa', '@etranger:autre.serveur'])
    expect(doc.audit.entries).toHaveLength(1)
    expect(JSON.stringify(doc)).not.toMatch(/password|initialPassword|secret/i)
    expect(verifyArchive(doc)).toBe(true)
    const tampered: ArchiveDocument = { ...doc, agents: doc.agents.slice(1) }
    expect(verifyArchive(tampered)).toBe(false)
  })
})

describe('overview endpoints', () => {
  const verify: TokenVerifier = async (t) => {
    if (t === 'admin') return { roles: ['admin'], username: 'admin.demo' }
    if (t === 'agent') return { roles: ['agent'], username: 'awa' }
    throw new Error('refusé')
  }
  async function app() {
    const { deps, audit } = await setup()
    const server = buildServer({ ...deps, adminGuard: roleGuard(verify, 'admin'), audit })
    const get = (url: string, token = 'admin') => server.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })
    return { get }
  }

  it('areReservedToAdministrators', async () => {
    const { get } = await app()
    for (const url of ['/server', '/rooms', '/rooms/!abc:chat.localhost/members', '/archive']) {
      expect((await get(url, 'agent')).statusCode).toBe(403)
      expect((await get(url, 'faux')).statusCode).toBe(401)
    }
  })

  it('listsRoomsAndTheirMembers', async () => {
    const { get } = await app()
    const rooms = (await get('/rooms')).json() as Array<{ name: string; encryption: string | null }>
    expect(rooms.map((r) => [r.name, r.encryption])).toEqual([['Cabinet', 'm.megolm.v1.aes-sha2'], ['Salon clair', null]])
    const members = (await get(`/rooms/${encodeURIComponent('!abc:chat.localhost')}/members`)).json() as Array<{ displayName: string }>
    expect(members.map((m) => m.displayName)).toContain('Agent awa')
    expect((await get('/rooms/pas-un-salon/members')).statusCode).toBe(400)
  })

  it('exportsAnArchiveAsADownloadAndRecordsTheExportInTheJournal', async () => {
    const { get } = await app()
    const res = await get('/archive')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="diyoy-archive-\d{4}-\d{2}-\d{2}\.json"$/)
    expect(verifyArchive(res.json() as ArchiveDocument)).toBe(true)
    const { entries } = (await get('/audit')).json() as { entries: Array<{ action: string; actor: string }> }
    expect(entries[0]).toMatchObject({ action: 'archive', actor: 'admin.demo' })
  })
})
