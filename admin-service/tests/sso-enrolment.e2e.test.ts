import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BASE, KC_DIRECT, KcBrowser, ROOT, bearer, clientToken, totp } from './e2e-helpers.ts'

const moussa = (JSON.parse(readFileSync(resolve(ROOT, 'deploy/keycloak/demo-users.json'), 'utf8')) as Array<{
  username: string
  password: string
  totpSecret: string
}>).find((u) => u.username === 'moussa.sawadogo')!

const SSO = `${BASE}/_matrix/client/v3/login/sso/redirect/oidc-keycloak?redirectUrl=${encodeURIComponent('http://localhost:8080/')}`

/** Connexion SSO complète (mot de passe, TOTP, retour chez Synapse). Renvoie la réponse finale de Synapse. */
async function ssoThroughSynapse(): Promise<Response> {
  const browser = new KcBrowser()
  const { html } = await browser.login(moussa.username, moussa.password, SSO)
  const back = await browser.submitOtp(html, totp(moussa.totpSecret))
  expect(back.headers.get('location') ?? '').toMatch(/_synapse\/client\/oidc\/callback/)
  return browser.request(back.headers.get('location')!)
}

describe('SÉCURITÉ: seuls les comptes enrôlés obtiennent un compte de messagerie par SSO', () => {
  it('aKeycloakUserWithoutTheEnrolmentMarkerIsRefusedBySynapse', async () => {
    const admin = bearer(await clientToken('automation'))
    const find = async () =>
      ((await (await fetch(`${KC_DIRECT}/admin/realms/bf/users?username=${moussa.username}&exact=true`, { headers: admin })).json()) as Array<{
        id: string
        attributes: Record<string, string[]>
      }>)[0]
    const user = await find()
    expect(user.attributes.enrolled, 'le compte de démonstration est enrôlé au départ').toEqual(['true'])

    const put = (attributes: Record<string, string[]>) =>
      fetch(`${KC_DIRECT}/admin/realms/bf/users/${user.id}`, { method: 'PUT', headers: admin, body: JSON.stringify({ attributes }) })
    const { enrolled: _removed, ...withoutMarker } = user.attributes
    try {
      expect((await put(withoutMarker)).status).toBe(204)
      const refused = await ssoThroughSynapse()
      expect(refused.headers.get('location') ?? '').not.toMatch(/loginToken=/)
      expect(refused.status).not.toBe(302)
    } finally {
      expect((await put(user.attributes)).status).toBe(204)
    }
  })

  it('anEnrolledAccountStillSignsInThroughSynapse', async () => {
    // Attente d'une nouvelle fenêtre TOTP: Keycloak refuse de rejouer le même code deux fois.
    await new Promise((r) => setTimeout(r, 31_000))
    const done = await ssoThroughSynapse()
    expect(done.status).toBe(302)
    expect(done.headers.get('location')).toMatch(/loginToken=/)
  }, 60_000)
})
