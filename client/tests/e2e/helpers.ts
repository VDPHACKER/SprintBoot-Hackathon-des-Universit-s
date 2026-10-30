import { execFileSync } from 'node:child_process'
import { ClientEvent, createClient, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'
import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '../../..')
/** Entrée publique (Caddy). Windows ne résout pas *.localhost hors navigateur : on reste sur localhost. */
export const BASE = 'http://localhost:8080'
/** Port Synapse direct, publié sur la boucle locale par compose.test.yaml uniquement. */
export const SYNAPSE_DIRECT = 'http://127.0.0.1:8008'
export const SERVER_NAME = 'chat.localhost'

export const COMPOSE = ['compose', '-f', 'compose.yaml', '-f', 'compose.test.yaml']

export function readSecret(name: string): string {
  return readFileSync(resolve(ROOT, 'data/secrets', name), 'utf8').trim()
}

/** Jeton du compte de service @svc-admin, créé par le service `bootstrap`. */
export function adminToken(): string {
  return readSecret('svc-admin.token')
}

export interface TestAgent {
  userId: string
  accessToken: string
  deviceId: string
}

/**
 * Crée un compte jetable avec un vrai appareil, par l'API d'enregistrement à secret partagé de Synapse
 * (HMAC-SHA1 imposé par cette API, via node:crypto : ce n'est pas de la cryptographie maison).
 * L'API /users/{id}/login renvoie un jeton sans appareil, inutilisable pour téléverser des clés E2EE.
 */
export async function registerAgent(prefix: string): Promise<TestAgent> {
  const username = `${prefix}-${randomBytes(4).toString('hex')}`
  const password = randomBytes(24).toString('hex')
  const sharedSecret = readSecret('registration_shared_secret')
  const { nonce } = (await (await fetch(`${SYNAPSE_DIRECT}/_synapse/admin/v1/register`)).json()) as { nonce: string }
  const mac = createHmac('sha1', sharedSecret)
    .update(Buffer.from(`${nonce}\0${username}\0${password}\0notadmin`))
    .digest('hex')
  const res = await fetch(`${SYNAPSE_DIRECT}/_synapse/admin/v1/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nonce, username, password, admin: false, mac }),
  })
  if (!res.ok) throw new Error(`registerAgent a échoué: ${res.status} ${await res.text()}`)
  const j = (await res.json()) as { user_id: string; access_token: string; device_id: string }
  return { userId: j.user_id, accessToken: j.access_token, deviceId: j.device_id }
}

/** Export texte complet de la base Synapse, pour prouver l'absence de clair. */
export function dumpDb(): string {
  return execFileSync('docker', [...COMPOSE, 'exec', '-T', 'postgres', 'pg_dump', '-U', 'synapse', 'synapse'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  })
}

export async function api(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}
/** Client Matrix complet (chiffrement Rust en mémoire) pour un compte jetable, synchronisé avec le serveur. */
export async function startTestClient(agent: TestAgent): Promise<MatrixClient> {
  const client = createClient({
    baseUrl: BASE,
    accessToken: agent.accessToken,
    userId: agent.userId,
    deviceId: agent.deviceId,
  })
  await client.initRustCrypto({ useIndexedDB: false })
  await client.startClient({ initialSyncLimit: 10 })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('synchronisation trop longue')), 30_000)
    client.on(ClientEvent.Sync, (state) => {
      if (state === 'PREPARED' || state === 'SYNCING') {
        clearTimeout(timer)
        resolve()
      }
    })
  })
  return client
}

/** Attend un événement de message déchiffré qui satisfait le prédicat, dans le salon. */
export async function waitForEvent(
  client: MatrixClient,
  roomId: string,
  predicate: (event: MatrixEvent) => boolean,
  timeoutMs = 30_000,
  type = 'm.room.message',
): Promise<MatrixEvent> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const room = client.getRoom(roomId)
    for (const event of room?.getLiveTimeline().getEvents() ?? []) {
      await client.decryptEventIfNeeded(event)
      if (event.getType() === type && predicate(event)) return event
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`événement attendu non reçu dans ${roomId}`)
}

/** Attend un message texte déchiffré portant exactement ce corps dans le salon. */
export const waitForMessage = (client: MatrixClient, roomId: string, body: string, timeoutMs = 30_000) =>
  waitForEvent(client, roomId, (e) => e.getContent().body === body, timeoutMs)
/** Jeton d'administration (compte technique `automation`, rôle admin) pour appeler /admin-api. Keycloak est joint en direct (compose.test.yaml). */
export async function adminJwt(): Promise<string> {
  const res = await fetch('http://127.0.0.1:8180/realms/bf/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: 'automation',
      client_secret: readSecret('automation_secret'),
    }),
  })
  if (!res.ok) throw new Error(`jeton admin: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { access_token: string }).access_token
}