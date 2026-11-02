import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { BASE, KcBrowser, ROOT, bearer, clientToken, totp } from './e2e-helpers.ts'

interface DemoUser {
  username: string
  password: string
  totpSecret: string
}
const demoUsers = JSON.parse(readFileSync(resolve(ROOT, 'deploy/keycloak/demo-users.json'), 'utf8')) as DemoUser[]
const DEMO_NAMES = ['admin.demo', 'awa.ouedraogo', 'issa.kabore', 'moussa.sawadogo']
/** Les autres tests créent des comptes jetables préfixés; ils ne comptent pas dans l'état de départ. */
const isTestAccount = (u: string) => /^(kc|e2e|cli)-/.test(u)

describe('SÉCURITÉ: comptes de démonstration (second facteur imposé)', () => {
  let admin: Record<string, string>
  beforeAll(async () => {
    admin = bearer(await clientToken('automation'))
  })
  const listAgents = async () =>
    (await (await fetch(`${BASE}/admin-api/agents`, { headers: admin })).json()) as Array<{
      username: string
      status: string
      role: string
    }>

  it('fourDemoAccountsExist', async () => {
    const demo = (await listAgents()).filter((a) => !isTestAccount(a.username))
    expect(demo.map((a) => a.username).sort()).toEqual(DEMO_NAMES)
    expect(demo.every((a) => a.status === 'active')).toBe(true)
  })

  it('credentialsFileMatchesTheDocumentedAccounts', () => {
    expect(demoUsers.map((u) => u.username).sort()).toEqual(DEMO_NAMES)
  })

  it('seedIsIdempotentAcrossRestarts', async () => {
    const before = (await listAgents()).length
    execFileSync('docker', ['compose', '-f', 'compose.yaml', '-f', 'compose.test.yaml', 'restart', 'admin'], { cwd: ROOT })
    for (let i = 0; i < 60; i++) {
      const h = await fetch(`${BASE}/admin-api/health`).catch(() => undefined)
      if (h?.status === 200) break
      await new Promise((r) => setTimeout(r, 1000))
    }
    expect((await listAgents()).length).toBe(before)
  })

  it('demoAccountLogsInWithPasswordAndTotp', async () => {
    const u = demoUsers.find((d) => d.username === 'awa.ouedraogo')!
    const browser = new KcBrowser()
    const { res, html } = await browser.login(u.username, u.password)
    expect(res.status).toBe(200)
    expect(html).toMatch(/name="otp"/)
    const done = await browser.submitOtp(html, totp(u.totpSecret))
    expect(done.status).toBe(302)
    expect(done.headers.get('location')).toMatch(/^http:\/\/localhost:8080\/\?.*code=/)
  })

  it('wrongTotpIsRefused', async () => {
    const u = demoUsers.find((d) => d.username === 'moussa.sawadogo')!
    const browser = new KcBrowser()
    const { html } = await browser.login(u.username, u.password)
    const done = await browser.submitOtp(html, '000000')
    expect(done.headers.get('location') ?? '').not.toMatch(/code=/)
  })

  it('wrongPasswordIsRefused', async () => {
    const u = demoUsers.find((d) => d.username === 'issa.kabore')!
    const { res } = await new KcBrowser().login(u.username, 'mauvais-mot-de-passe')
    expect(res.headers.get('location') ?? '').not.toMatch(/code=/)
  })
})