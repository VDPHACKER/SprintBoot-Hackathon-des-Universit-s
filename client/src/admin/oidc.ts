/** Connexion de la console à Keycloak (code d'autorisation + PKCE, client public « admin-console »). Le jeton reste en mémoire. */
const ISSUER = 'http://auth.localhost:8081/realms/bf/protocol/openid-connect'
const CLIENT_ID = 'admin-console'
const redirectUri = () => `${window.location.origin}/`

const b64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const random = (n: number): string => b64url(crypto.getRandomValues(new Uint8Array(n)))

/** Redirige vers l'écran de connexion Keycloak (mot de passe puis code à usage unique). */
export async function startLogin(): Promise<void> {
  const verifier = random(48)
  const state = random(16)
  sessionStorage.setItem('pkce', JSON.stringify({ verifier, state }))
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const params = new URLSearchParams({
    client_id: CLIENT_ID, response_type: 'code', scope: 'openid', redirect_uri: redirectUri(),
    code_challenge: challenge, code_challenge_method: 'S256', state,
  })
  window.location.assign(`${ISSUER}/auth?${params}`)
}

/** Au retour de Keycloak: échange le code contre un jeton d'accès. Renvoie `undefined` s'il n'y a pas de retour de connexion en cours. */
export async function finishLogin(): Promise<string | undefined> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  if (!code) return undefined
  const saved = JSON.parse(sessionStorage.getItem('pkce') ?? 'null') as { verifier: string; state: string } | null
  sessionStorage.removeItem('pkce')
  window.history.replaceState({}, '', '/')
  if (!saved || saved.state !== url.searchParams.get('state')) throw new Error('STATE_MISMATCH')
  const res = await fetch(`${ISSUER}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID, code, redirect_uri: redirectUri(), code_verifier: saved.verifier }),
  })
  if (!res.ok) throw new Error('TOKEN_FAILED')
  return ((await res.json()) as { access_token: string }).access_token
}

/** Ferme aussi la session Keycloak (sinon « Se connecter » rouvrirait la console sans mot de passe). */
export function logoutUrl(): string {
  return `${ISSUER}/logout?${new URLSearchParams({ client_id: CLIENT_ID, post_logout_redirect_uri: redirectUri() })}`
}

/** Identifiant (preferred_username) lu dans le jeton, pour ne pas proposer de se révoquer soi-même. */
export function usernameOf(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { preferred_username?: string }
    return payload.preferred_username ?? ''
  } catch {
    return ''
  }
}
