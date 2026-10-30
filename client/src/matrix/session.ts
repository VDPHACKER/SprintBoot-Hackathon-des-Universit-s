import { createClient, type MatrixClient } from 'matrix-js-sdk'
import { SSO_PROVIDER } from './config.ts'

const STORAGE_KEY = 'bf.session'

interface StoredSession {
  accessToken: string
  userId: string
  deviceId: string
}

const baseUrl = () => window.location.origin

/** Adresse de connexion: Synapse redirige vers Keycloak (mot de passe + TOTP), puis revient avec un `loginToken`. */
export function ssoLoginUrl(): string {
  const back = `${window.location.origin}/`
  return `${baseUrl()}/_matrix/client/v3/login/sso/redirect/${SSO_PROVIDER}?redirectUrl=${encodeURIComponent(back)}`
}

function readStored(): StoredSession | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : undefined
  } catch {
    return undefined
  }
}

function store(s: StoredSession): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

/** Échange le jeton SSO du retour de connexion contre une session, puis nettoie l'adresse. */
async function completeSso(loginToken: string): Promise<StoredSession> {
  const url = new URL(window.location.href)
  url.searchParams.delete('loginToken')
  window.history.replaceState({}, '', url.pathname + url.search)
  const res = await createClient({ baseUrl: baseUrl() }).loginRequest({ type: 'm.login.token', token: loginToken })
  const session = { accessToken: res.access_token, userId: res.user_id, deviceId: res.device_id }
  store(session)
  return session
}

/** Restaure la session (ou termine le retour SSO), initialise le chiffrement et démarre la synchronisation. */
export async function startSession(): Promise<MatrixClient> {
  const loginToken = new URL(window.location.href).searchParams.get('loginToken')
  const session = loginToken ? await completeSso(loginToken) : readStored()
  if (!session) throw new Error('NOT_LOGGED_IN')

  const client = createClient({
    baseUrl: baseUrl(),
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,
  })
  await client.initRustCrypto()
  await client.startClient({ initialSyncLimit: 20 })
  return client
}

/** Ferme la session côté serveur et efface les données locales (clés de chiffrement comprises). */
export async function logout(client: MatrixClient): Promise<void> {
  client.stopClient()
  await client.logout(true).catch(() => undefined)
  await client.clearStores().catch(() => undefined)
  window.localStorage.removeItem(STORAGE_KEY)
}