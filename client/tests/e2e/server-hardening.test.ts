import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BASE, COMPOSE, ROOT, api, registerAgent } from './helpers'

describe('SÉCURITÉ: durcissement du serveur', () => {
  it('registrationIsClosed', async () => {
    const res = await fetch(`${BASE}/_matrix/client/v3/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'intrus', password: 'x', auth: { type: 'm.login.dummy' } }),
    })
    expect(res.status).toBe(403)
  })

  it('adminApiIsNotExposed', async () => {
    const res = await fetch(`${BASE}/_synapse/admin/v1/server_version`)
    expect([403, 404]).toContain(res.status)
  })

  it('federationIsOff', async () => {
    const res = await fetch(`${BASE}/_matrix/federation/v1/version`)
    expect(res.status).not.toBe(200)
  })

  it('passwordLoginIsDisabled', async () => {
    const res = await fetch(`${BASE}/_matrix/client/v3/login`)
    const body = (await res.json()) as { flows: Array<{ type: string }> }
    expect(body.flows.map((f) => f.type)).not.toContain('m.login.password')
  })

  it('roomsAreAlwaysEncrypted', async () => {
    const agent = await registerAgent('test-a')
    const created = await api('/_matrix/client/v3/createRoom', agent.accessToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'salon-test' }),
    })
    expect(created.status).toBe(200)
    const { room_id } = (await created.json()) as { room_id: string }
    const state = await api(
      `/_matrix/client/v3/rooms/${encodeURIComponent(room_id)}/state/m.room.encryption`,
      agent.accessToken,
    )
    expect(state.status).toBe(200)
    expect(((await state.json()) as { algorithm: string }).algorithm).toBe('m.megolm.v1.aes-sha2')
  })

  it('configHasRequiredKeys', () => {
    const cfg = readFileSync(resolve(ROOT, 'data/synapse/homeserver.yaml'), 'utf8')
    expect(cfg).toMatch(/^enable_registration: false$/m)
    expect(cfg).toMatch(/^encryption_enabled_by_default_for_room_type: all$/m)
    expect(cfg).toMatch(/^url_preview_enabled: false$/m)
    expect(cfg).toMatch(/^federation_domain_whitelist: \[\]$/m)
    expect(cfg).toMatch(/^presence:\n\s+enabled: false$/m)
  })

  it('configAndSigningKeyAreNotReadableByOtherUsers', () => {
    // homeserver.yaml contient le mot de passe de la base, le secret d'enregistrement et le secret OIDC.
    const out = execFileSync('docker', [...COMPOSE, 'exec', '-T', 'synapse', 'sh', '-c', 'stat -c "%a %n" /data/homeserver.yaml /data/*.signing.key'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    const modes = out.trim().split('\n').map((l) => l.split(' '))
    expect(modes.length).toBeGreaterThanOrEqual(2)
    for (const [mode, file] of modes) expect(parseInt(mode, 8) & 0o007, `${file} (${mode}) lisible par tout le monde`).toBe(0)
  })
})