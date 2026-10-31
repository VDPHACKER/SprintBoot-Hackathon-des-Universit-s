import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BASE, KC_DIRECT, KcBrowser, REALM_ISSUER, bearer, clientToken } from './e2e-helpers.ts'

const agent = (username: string) => ({
  username,
  displayName: 'Agent Keycloak',
  ministry: 'Ministère fictif A',
  fonction: 'Testeur',
  role: 'agent',
})

describe('SÉCURITÉ: identité Keycloak', () => {
  it('ssoRedirectGoesToKeycloak', async () => {
    const res = await fetch(
      `${BASE}/_matrix/client/v3/login/sso/redirect/oidc-keycloak?redirectUrl=${encodeURIComponent('http://localhost:8080/')}`,
      { redirect: 'manual' },
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toMatch(/^http:\/\/auth\.localhost:8081\/realms\/bf\//)
  })

  it('directGrantIsRefused', async () => {
    const res = await fetch(`${KC_DIRECT}/realms/bf/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', client_id: 'messagerie-web', username: 'x', password: 'y' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('unauthorized_client')
  })

  it('directGrantIsRefusedOnEveryBuiltInClientEvenWithoutAnOtp', async () => {
    // Relecture indépendante: le client intégré `admin-cli` acceptait mot de passe seul, sans second facteur, pour un
    // utilisateur qui n'avait pas encore enregistré d'OTP. Aucun client ne doit délivrer de jeton par ce flux.
    const admin = bearer(await clientToken('automation'))
    const username = `kc-${randomBytes(3).toString('hex')}`
    const password = randomBytes(12).toString('hex')
    const created = await fetch(`${KC_DIRECT}/admin/realms/bf/users`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ username, enabled: true, credentials: [{ type: 'password', value: password, temporary: false }] }),
    })
    expect(created.status).toBe(201)
    const id = created.headers.get('location')!.split('/').pop()!
    try {
      for (const clientId of ['admin-cli', 'messagerie-web', 'account', 'account-console', 'security-admin-console', 'broker']) {
        const res = await fetch(`${KC_DIRECT}/realms/bf/protocol/openid-connect/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'password', client_id: clientId, username, password }),
        })
        const body = (await res.json()) as { access_token?: string }
        expect(body.access_token, `client ${clientId}`).toBeUndefined()
      }
    } finally {
      await fetch(`${KC_DIRECT}/admin/realms/bf/users/${id}`, { method: 'DELETE', headers: admin })
    }
  })

  it('adminEndpointRejectsNonAdminJwt', async () => {
    const body = JSON.stringify(agent(`kc-${randomBytes(3).toString('hex')}`))
    const asAgent = await fetch(`${BASE}/admin-api/agents`, {
      method: 'POST',
      headers: bearer(await clientToken('automation-agent')),
      body,
    })
    expect(asAgent.status).toBe(403)
    const anonymous = await fetch(`${BASE}/admin-api/agents`, { method: 'POST', body })
    expect(anonymous.status).toBe(401)
  })

  it('revokeDisablesKeycloakUser', async () => {
    const username = `kc-${randomBytes(3).toString('hex')}`
    const admin = bearer(await clientToken('automation'))
    expect((await fetch(`${BASE}/admin-api/agents`, { method: 'POST', headers: admin, body: JSON.stringify(agent(username)) })).status).toBe(201)

    const find = async () =>
      ((await (await fetch(`${KC_DIRECT}/admin/realms/bf/users?username=${username}&exact=true`, { headers: admin })).json()) as Array<{
        enabled: boolean
      }>)[0]
    expect((await find()).enabled).toBe(true)

    expect((await fetch(`${BASE}/admin-api/agents/${username}/revoke`, { method: 'POST', headers: admin })).status).toBe(200)
    expect((await find()).enabled).toBe(false)
  })

  it('tokenIssuerIsThePublicRealmUrl', async () => {
    const payload = JSON.parse(Buffer.from((await clientToken('automation')).split('.')[1], 'base64url').toString())
    expect(payload.iss).toBe(REALM_ISSUER)
  })

  it('aPasswordAloneNeverIssuesAnAuthorizationCode', async () => {
    // Prouve qu'un mot de passe seul ne délivre JAMAIS de code d'autorisation: l'utilisateur est renvoyé vers l'enrôlement du
    // second facteur (page 	otp). La demande du code pour un compte qui en possède un est prouvée par les tests des comptes de
    // démonstration (seed.e2e: page otp, bon code accepté, mauvais code refusé).
    const username = `kc-${randomBytes(3).toString('hex')}`
    const password = randomBytes(12).toString('hex')
    const admin = bearer(await clientToken('automation'))
    const created = await fetch(`${BASE}/admin-api/agents`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ ...agent(username), initialPassword: password }),
    })
    expect(created.status).toBe(201)
    // On retire le mot de passe temporaire et les actions requises: seul le flux du realm doit imposer le TOTP.
    const [{ id }] = (await (await fetch(`${KC_DIRECT}/admin/realms/bf/users?username=${username}&exact=true`, { headers: admin })).json()) as Array<{ id: string }>
    await fetch(`${KC_DIRECT}/admin/realms/bf/users/${id}/reset-password`, {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ type: 'password', value: password, temporary: false }),
    })
    await fetch(`${KC_DIRECT}/admin/realms/bf/users/${id}`, { method: 'PUT', headers: admin, body: JSON.stringify({ requiredActions: [] }) })

    // Connexion navigateur simulée: formulaire identifiant/mot de passe, puis on suit les redirections.
    // À aucun moment le client ne doit recevoir de code d'autorisation avec le seul mot de passe.
    const { res, html } = await new KcBrowser().login(username, password)
    expect(res.headers.get('location') ?? '').not.toMatch(/^http:\/\/localhost:8080\/\?.*code=/)
    expect(res.status).toBe(200)
    expect(html).toMatch(/name="totp"/)  })
})