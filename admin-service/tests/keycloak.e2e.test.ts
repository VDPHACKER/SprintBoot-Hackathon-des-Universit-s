import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BASE, KC_DIRECT, REALM_ISSUER, bearer, clientToken } from './e2e-helpers.ts'

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

  it('totpIsEnforcedAfterPassword', async () => {
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

    // Connexion navigateur simulée: formulaire identifiant/mot de passe.
    const jar = new Map<string, string>()
    const remember = (res: Response) => res.headers.getSetCookie().forEach((c) => jar.set(c.split('=')[0], c.split(';')[0]))
    const cookies = () => [...jar.values()].join('; ')
    const toDirect = (u: string) => u.replace('http://auth.localhost:8081', KC_DIRECT)
    const challenge = createHash('sha256').update(randomBytes(32)).digest('base64url')

    const page = await fetch(
      `${KC_DIRECT}/realms/bf/protocol/openid-connect/auth?` +
        new URLSearchParams({
          client_id: 'messagerie-web',
          response_type: 'code',
          scope: 'openid',
          redirect_uri: 'http://localhost:8080/',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }),
    )
    remember(page)
    const html = await page.text()
    const action = /action="([^"]+)"/.exec(html)?.[1].replaceAll('&amp;', '&')
    expect(action, 'formulaire de connexion introuvable').toBeTruthy()

    const after = await fetch(toDirect(action!), {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookies() },
      body: new URLSearchParams({ username, password }),
    })
    // On suit les redirections: à aucun moment le client ne doit recevoir de code d'autorisation avec le seul mot de passe.
    let res = after
    for (let i = 0; i < 5 && [301, 302, 303].includes(res.status); i++) {
      const location = res.headers.get('location') ?? ''
      expect(location).not.toMatch(/^http:\/\/localhost:8080\/\?.*code=/)
      remember(res)
      res = await fetch(toDirect(location), { redirect: 'manual', headers: { cookie: cookies() } })
    }
    expect(res.status).toBe(200)
    expect(await res.text()).toMatch(/name="totp"/)
  })
})