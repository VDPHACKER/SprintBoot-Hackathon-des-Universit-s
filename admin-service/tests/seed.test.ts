import { describe, expect, it } from 'vitest'
import { DEMO_ACCOUNTS, seedDemoAccounts } from '../src/demo.ts'
import { buildServer } from '../src/server.ts'
import { roleGuard } from '../src/auth.ts'
import { FakeIdentity, FakeSynapse } from './fakes.ts'

function makeDeps() {
  const log: string[] = []
  return { log, identity: new FakeIdentity(log), synapse: new FakeSynapse(log), domain: 'chat.localhost' }
}

describe('seedDemoAccounts', () => {
  it('createsExactlyTheFourDocumentedDemoAccounts', async () => {
    const d = makeDeps()
    await seedDemoAccounts(d)
    const users = await d.identity.listUsers()
    expect(users.map((u) => `${u.username}:${u.role}`).sort()).toEqual([
      'admin.demo:admin',
      'awa.ouedraogo:agent',
      'issa.kabore:chef_de_service',
      'moussa.sawadogo:agent',
    ])
    expect(users.every((u) => u.status === 'active')).toBe(true)
  })

  it('seedIsIdempotent', async () => {
    const d = makeDeps()
    await seedDemoAccounts(d)
    await seedDemoAccounts(d)
    expect(await d.identity.listUsers()).toHaveLength(4)
  })

  it('demoAccountsAreClearlyFictionalAndSpanTwoMinistries', () => {
    expect(DEMO_ACCOUNTS.every((a) => a.displayName.endsWith('(démo)'))).toBe(true)
    expect(new Set(DEMO_ACCOUNTS.map((a) => a.ministry)).size).toBe(2)
  })

  it('noIntruderAccountIsCreated', () => {
    expect(DEMO_ACCOUNTS.some((a) => a.username.startsWith('intrus'))).toBe(false)
  })
})

describe('health', () => {
  const guard = roleGuard(async () => ({ roles: ['admin'] }), 'admin')

  it('healthIsUnavailableUntilReady', async () => {
    let ready = false
    const s = buildServer({ ...makeDeps(), adminGuard: guard, isReady: () => ready })
    expect((await s.inject({ method: 'GET', url: '/health' })).statusCode).toBe(503)
    ready = true
    expect((await s.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
  })
})