import { appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { enroll, type AgentInput } from '../src/agents.ts'
import { FileAuditLog, type AuditLog } from '../src/audit.ts'
import { roleGuard, type TokenVerifier } from '../src/auth.ts'
import { buildServer } from '../src/server.ts'
import { FakeIdentity, FakeSynapse } from './fakes.ts'

const newLog = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'audit-'))
  return { dir, log: new FileAuditLog(dir) }
}

describe('FileAuditLog', () => {
  it('chainsEntriesAndListsNewestFirst', async () => {
    const { log } = await newLog()
    await log.append({ actor: 'admin.demo', action: 'enroll', target: 'a.b', detail: 'agent · Min' })
    await log.append({ actor: 'admin.demo', action: 'role', target: 'a.b', detail: 'agent → admin' })
    await log.append({ actor: 'admin.demo', action: 'revoke', target: 'a.b' })
    const { entries, chainValid } = await log.list(10)
    expect(chainValid).toBe(true)
    expect(entries.map((e) => e.action)).toEqual(['revoke', 'role', 'enroll'])
    expect(entries[2]?.prev).toBe('0'.repeat(64))
    expect(entries[1]?.prev).toBe(entries[2]?.hash)
  })

  it('limitsTheNumberOfEntriesButVerifiesTheWholeChain', async () => {
    const { log } = await newLog()
    for (let i = 0; i < 5; i++) await log.append({ actor: 'x', action: 'revoke', target: `t${i}` })
    const { entries, chainValid } = await log.list(2)
    expect(entries.map((e) => e.target)).toEqual(['t4', 't3'])
    expect(chainValid).toBe(true)
  })

  it('keepsTheChainAcrossRestartsAndConcurrentWrites', async () => {
    const { dir, log } = await newLog()
    await Promise.all([1, 2, 3, 4].map((i) => log.append({ actor: 'x', action: 'revoke', target: `t${i}` })))
    const reopened = new FileAuditLog(dir)
    await reopened.append({ actor: 'x', action: 'revoke', target: 't5' })
    expect((await reopened.list(10)).chainValid).toBe(true)
    expect((await reopened.list(10)).entries).toHaveLength(5)
  })

  it('detectsAnEditedEntry', async () => {
    const { dir, log } = await newLog()
    await log.append({ actor: 'admin.demo', action: 'revoke', target: 'moussa.sawadogo' })
    await log.append({ actor: 'admin.demo', action: 'enroll', target: 'autre.agent' })
    const file = join(dir, 'audit.jsonl')
    await writeFile(file, (await readFile(file, 'utf8')).replace('moussa.sawadogo', 'quelquun.dautre'))
    expect((await log.list(10)).chainValid).toBe(false)
  })

  it('detectsADeletedEntryAndAGarbageLine', async () => {
    const { dir, log } = await newLog()
    for (const t of ['a', 'b', 'c']) await log.append({ actor: 'x', action: 'revoke', target: t })
    const file = join(dir, 'audit.jsonl')
    const lines = (await readFile(file, 'utf8')).trim().split('\n')
    await writeFile(file, `${lines[0]}\n${lines[2]}\n`)
    expect((await log.list(10)).chainValid).toBe(false)
    const second = await newLog()
    await second.log.append({ actor: 'x', action: 'revoke', target: 'a' })
    await appendFile(join(second.dir, 'audit.jsonl'), 'pas du json\n')
    expect((await second.log.list(10)).chainValid).toBe(false)
  })

  it('anEmptyJournalIsValid', async () => {
    const { log } = await newLog()
    expect(await log.list(10)).toEqual({ entries: [], chainValid: true })
  })
})

describe('audit through the endpoints', () => {
  const awa: AgentInput = { username: 'awa.ouedraogo', displayName: 'Awa', ministry: 'Ministère fictif A', fonction: 'Chargée de mission', role: 'agent' }
  const verify: TokenVerifier = async (token) => {
    if (token === 'admin-token') return { roles: ['admin'], username: 'admin.demo' }
    if (token === 'cli-token') return { roles: ['admin'], username: 'service-account-automation' }
    if (token === 'agent-token') return { roles: ['agent'], username: 'awa.ouedraogo' }
    throw new Error('refusé')
  }
  async function setup(audit?: AuditLog) {
    const log: string[] = []
    const { log: realLog } = await newLog()
    const deps = { identity: new FakeIdentity(log), synapse: new FakeSynapse(log), domain: 'chat.localhost' }
    await enroll(deps, { ...awa, username: 'admin.demo', displayName: 'Admin', role: 'admin' })
    await enroll(deps, awa)
    const server = buildServer({ ...deps, adminGuard: roleGuard(verify, 'admin'), audit: audit ?? realLog })
    const call = (method: 'GET' | 'POST', url: string, token: string, payload?: object) =>
      server.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) })
    return { call }
  }

  it('recordsEnrolRoleChangeAndRevocationWithTheCaller', async () => {
    const { call } = await setup()
    await call('POST', '/agents', 'admin-token', { username: 'nouvel.agent', displayName: 'N', ministry: 'Min', fonction: 'F', role: 'agent' })
    await call('POST', '/agents/nouvel.agent/role', 'admin-token', { role: 'chef_de_service' })
    await call('POST', '/agents/nouvel.agent/revoke', 'cli-token')
    const body = (await call('GET', '/audit', 'admin-token')).json() as { entries: Array<Record<string, string>>; chainValid: boolean }
    expect(body.chainValid).toBe(true)
    expect(body.entries.map((e) => [e.actor, e.action, e.target, e.detail])).toEqual([
      ['service-account-automation', 'revoke', 'nouvel.agent', undefined],
      ['admin.demo', 'role', 'nouvel.agent', 'agent → chef_de_service'],
      ['admin.demo', 'enroll', 'nouvel.agent', 'agent · Min'],
    ])
  })

  it('doesNotRecordARefusedActionOrAnUnchangedRole', async () => {
    const { call } = await setup()
    await call('POST', '/agents/awa.ouedraogo/role', 'admin-token', { role: 'agent' })
    await call('POST', '/agents/inconnu.agent/role', 'admin-token', { role: 'admin' })
    const body = (await call('GET', '/audit', 'admin-token')).json() as { entries: unknown[] }
    expect(body.entries).toEqual([])
  })

  it('theJournalIsReservedToAdministrators', async () => {
    const { call } = await setup()
    expect((await call('GET', '/audit', 'agent-token')).statusCode).toBe(403)
    expect((await call('GET', '/audit', 'faux-jeton')).statusCode).toBe(401)
  })

  it('aFailingJournalNeverBlocksARevocation', async () => {
    const broken: AuditLog = {
      append: async () => { throw new Error('disque plein') },
      list: async () => ({ entries: [], chainValid: true }),
    }
    const { call } = await setup(broken)
    const res = await call('POST', '/agents/awa.ouedraogo/revoke', 'admin-token')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ identityDisabled: true, synapseDeactivated: true })
  })
})
