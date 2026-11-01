import { createHash, createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '../..')
export const BASE = 'http://localhost:8080'
/** Keycloak par Caddy (:8081) et en direct (boucle locale, compose.test.yaml uniquement). */
export const KC_PUBLIC = 'http://localhost:8081'
export const KC_DIRECT = 'http://127.0.0.1:8180'
export const SYNAPSE = 'http://127.0.0.1:8008'
export const REALM_ISSUER = 'http://auth.localhost:8081/realms/bf'
export const REDIRECT_URI = 'http://localhost:8080/'

export const secret = (name: string) => readFileSync(resolve(ROOT, 'data/secrets', name), 'utf8').trim()

/** Jeton d'un compte technique (client_credentials). */
export async function clientToken(clientId: 'automation' | 'automation-agent'): Promise<string> {
  const res = await fetch(`${KC_DIRECT}/realms/bf/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: secret(clientId === 'automation' ? 'automation_secret' : 'automation_agent_secret'),
    }),
  })
  if (!res.ok) throw new Error(`jeton ${clientId}: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { access_token: string }).access_token
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' })

/** Code TOTP à 6 chiffres (RFC 6238, SHA-1, pas de 30 s). Code de test: le serveur fait sa propre vérification. */
export function totp(secretText: string, at = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const h = createHmac('sha1', Buffer.from(secretText, 'utf8')).update(counter).digest()
  const o = h[h.length - 1] & 0xf
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

/** Navigateur minimal qui joue le formulaire de connexion Keycloak (cookies + redirections manuelles). */
export class KcBrowser {
  private jar = new Map<string, string>()

  async request(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url.replace('http://auth.localhost:8081', KC_DIRECT), {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers as Record<string, string> | undefined), cookie: [...this.jar.values()].join('; ') },
    })
    for (const c of res.headers.getSetCookie()) this.jar.set(c.split('=')[0], c.split(';')[0])
    return res
  }

  /** Suit les redirections jusqu'à une page (200) ou jusqu'au retour vers le client (redirect_uri). */
  async settle(res: Response): Promise<Response> {
    for (let i = 0; i < 6 && [301, 302, 303].includes(res.status); i++) {
      const location = res.headers.get('location') ?? ''
      if (location.startsWith(REDIRECT_URI)) return res
      res = await this.request(location)
    }
    return res
  }

  private static form(html: string): { action: string; fields: URLSearchParams } {
    const action = /<form\b[^>]*\baction="([^"]+)"/.exec(html)?.[1].replaceAll('&amp;', '&')
    if (!action) throw new Error('formulaire introuvable dans la page Keycloak')
    const fields = new URLSearchParams()
    for (const [tag] of html.matchAll(/<input\b[^>]*>/g)) {
      const name = /\bname="([^"]*)"/.exec(tag)?.[1]
      const type = /\btype="([^"]*)"/.exec(tag)?.[1]
      if (name && type === 'hidden') fields.set(name, /\bvalue="([^"]*)"/.exec(tag)?.[1] ?? '')
    }
    return { action, fields }
  }

  /** Ouvre la page de connexion du client web puis soumet identifiant + mot de passe. */
  async login(username: string, password: string, startUrl?: string): Promise<{ res: Response; html: string }> {
    const challenge = createHash('sha256').update(randomBytes(32)).digest('base64url')
    // `startUrl` (ex.: la redirection SSO de Synapse) remplace la demande directe au client web.
    const page = startUrl
      ? await this.settle(await this.request(startUrl))
      : await this.request(
          `${KC_DIRECT}/realms/bf/protocol/openid-connect/auth?` +
            new URLSearchParams({
              client_id: 'messagerie-web',
              response_type: 'code',
              scope: 'openid',
              redirect_uri: REDIRECT_URI,
              code_challenge: challenge,
              code_challenge_method: 'S256',
            }),
        )
    const { action, fields } = KcBrowser.form(await page.text())
    fields.set('username', username)
    fields.set('password', password)
    const res = await this.settle(
      await this.request(action, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: fields,
      }),
    )
    return { res, html: res.status === 200 ? await res.text() : '' }
  }

  /** Soumet le code TOTP sur la page courante; renvoie la réponse finale (redirection vers le client si accepté). */
  async submitOtp(html: string, code: string): Promise<Response> {
    const { action, fields } = KcBrowser.form(html)
    fields.set('otp', code)
    return this.settle(
      await this.request(action, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: fields,
      }),
    )
  }
}