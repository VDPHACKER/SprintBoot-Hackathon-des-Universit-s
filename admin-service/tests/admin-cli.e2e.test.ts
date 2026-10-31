import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT } from './e2e-helpers.ts'

const cli = (...args: string[]) =>
  spawnSync('node', [resolve(ROOT, 'scripts/admin.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' })

describe('SÉCURITÉ: outil d\'administration en ligne de commande (enrôlement et révocation)', () => {
  it('listShowsTheDemoAccounts', () => {
    const r = cli('list')
    expect(r.status, r.stderr).toBe(0)
    for (const name of ['admin.demo', 'issa.kabore', 'awa.ouedraogo', 'moussa.sawadogo']) expect(r.stdout).toContain(name)
  })

  it('enrollThenRevokeFromTheCommandLineThenReenrolmentIsRefused', () => {
    const username = `cli-${randomBytes(3).toString('hex')}`
    const enrolled = cli('enroll', username, 'Agent CLI (démo)', 'Ministère fictif A', 'Testeur', 'agent')
    expect(enrolled.status, enrolled.stderr).toBe(0)
    expect(enrolled.stdout).toContain(username)
    expect(enrolled.stdout, 'le mot de passe temporaire est affiché une fois').toMatch(/mot de passe temporaire/i)

    const revoked = cli('revoke', username)
    expect(revoked.status, revoked.stderr).toBe(0)
    expect(revoked.stdout).toContain('"synapseDeactivated": true')

    const again = cli('enroll', username, 'Agent CLI (démo)', 'Ministère fictif A', 'Testeur', 'agent')
    expect(again.status).not.toBe(0)
    expect(again.stderr).toContain('REVOKED_ACCOUNT')
  })

  it('reservedNamesAndBadArgumentsAreRefused', () => {
    const reserved = cli('enroll', 'svc-admin', 'X', 'Y', 'Z', 'agent')
    expect(reserved.status).not.toBe(0)
    expect(reserved.stderr).toContain('INVALID_USERNAME')
    const missing = cli('revoke')
    expect(missing.status, 'identifiant manquant').not.toBe(0)
    expect(missing.stderr).toContain('Usage')
    expect(cli('inconnu').stderr).toContain('Usage')
  })
})