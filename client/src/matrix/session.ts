import { createClient, HttpApiEvent, type MatrixClient } from 'matrix-js-sdk'
import { SSO_PROVIDER } from './config.ts'

/** Toutes les clés de l'application dans le stockage local commencent par ce préfixe. */
const APP_PREFIX = 'bf.'
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

type KeyStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>

/** Préférences qui survivent à une déconnexion ou une révocation (ce n'est pas une donnée de session). */
const KEEP_ON_SIGN_OUT: readonly string[] = ['bf.locale']

/** Efface les clés de l'application du stockage local, sauf celles de keep. */
export function clearAppKeys(storage: KeyStorage, keep: readonly string[] = []): void {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key?.startsWith(APP_PREFIX) && !keep.includes(key)) keys.push(key)
  }
  keys.forEach((key) => storage.removeItem(key))
}

/**
 * Révocation: dès que le serveur refuse le jeton (compte révoqué ou session fermée), le client s'arrête, efface les
 * clés de chiffrement (IndexedDB) et le jeton local, puis appelle `onRevoked` (retour à l'écran de connexion).
 * L'effacement local se termine même si le magasin de clés est inaccessible. Ne s'exécute qu'une fois.
 */
export function watchForRevocation(
  client: Pick<MatrixClient, 'on' | 'stopClient' | 'clearStores'>,
  onRevoked: () => void,
  storage: KeyStorage = window.localStorage,
): void {
  let handled = false
  client.on(HttpApiEvent.SessionLoggedOut, () => {
    if (handled) return
    handled = true
    client.stopClient()
    void client
      .clearStores()
      .catch(() => undefined)
      .finally(() => {
        clearAppKeys(storage, KEEP_ON_SIGN_OUT)
        onRevoked()
      })
  })
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
  watchForRevocation(client, () => window.location.assign('/?revoked=1'))
  await client.initRustCrypto()
  await client.startClient({ initialSyncLimit: 20 })
  return client
}

/** Ferme la session côté serveur et efface les données locales (clés de chiffrement comprises). */
export async function logout(
  client: Pick<MatrixClient, 'stopClient' | 'logout' | 'clearStores'>,
  storage: KeyStorage = window.localStorage,
): Promise<void> {
  client.stopClient()
  await client.logout(true).catch(() => undefined)
  await client.clearStores().catch(() => undefined)
  // Tout ce que l'agent a laissé (jeton, accusés déjà envoyés...) part avec lui; seule la langue choisie reste.
  clearAppKeys(storage, KEEP_ON_SIGN_OUT)
}