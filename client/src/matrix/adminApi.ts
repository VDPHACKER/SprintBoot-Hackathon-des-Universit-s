/** Appels vers l'API d'administration (même origine, via /admin-api). Le jeton est celui de la session de messagerie de l'administrateur. */
export type AgentRole = 'admin' | 'chef_de_service' | 'agent'
export interface AgentRow {
  username: string
  displayName: string
  ministry: string
  fonction: string
  role: AgentRole
  status: 'active' | 'revoked'
}
export interface EnrollInput {
  username: string
  displayName: string
  ministry: string
  fonction: string
  role: AgentRole
}

async function call(token: string, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`/admin-api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function failure(res: Response): Promise<Error> {
  const { error } = (await res.json().catch(() => ({}))) as { error?: string }
  return new Error(error ?? 'ADMIN_FAILED')
}

/** Liste des agents, ou `undefined` si le compte n'est pas administrateur (l'onglet reste alors caché). */
export async function listAgents(token: string): Promise<AgentRow[] | undefined> {
  const res = await call(token, 'GET', '/agents').catch(() => undefined)
  if (!res || res.status === 401 || res.status === 403) return undefined
  if (!res.ok) throw await failure(res)
  return (await res.json()) as AgentRow[]
}

/** Enrôle un agent; renvoie son mot de passe temporaire (affiché une seule fois, jamais conservé). */
export async function enrollAgent(token: string, input: EnrollInput): Promise<string> {
  const res = await call(token, 'POST', '/agents', input)
  if (!res.ok) throw await failure(res)
  return ((await res.json()) as { initialPassword: string }).initialPassword
}

export interface AuditEntry {
  ts: string
  actor: string
  action: 'enroll' | 'revoke' | 'role' | 'archive'
  target: string
  detail?: string
}

/** Journal d'audit (le plus récent d'abord) et résultat de la vérification de son chaînage. */
export async function listAudit(token: string): Promise<{ entries: AuditEntry[]; chainValid: boolean }> {
  const res = await call(token, 'GET', '/audit?limit=300')
  if (!res.ok) throw await failure(res)
  return (await res.json()) as { entries: AuditEntry[]; chainValid: boolean }
}

/** Change le rôle d'un agent actif (refusé pour le dernier administrateur). */
export async function changeRole(token: string, username: string, role: AgentRole): Promise<void> {
  const res = await call(token, 'POST', `/agents/${encodeURIComponent(username)}/role`, { role })
  if (!res.ok) throw await failure(res)
}

/** Révoque un agent: identité désactivée, sessions fermées, compte de messagerie désactivé. */
export async function revokeAgent(token: string, username: string): Promise<void> {
  const res = await call(token, 'POST', `/agents/${encodeURIComponent(username)}/revoke`)
  if (!res.ok) throw await failure(res)
}

export interface RoomRow {
  roomId: string
  name: string
  creator: string
  members: number
  encryption: string | null
  historyVisibility?: string
}
export interface RoomMemberRow {
  mxid: string
  username?: string
  displayName: string
  status?: 'active' | 'revoked'
}
export interface ServerStatus {
  serverName: string
  generatedAt: string
  uptimeSeconds: number
  synapse: { reachable: boolean; version?: string }
  identity: { reachable: boolean }
  agents?: { total: number; active: number; revoked: number; admins: number }
  rooms?: { total: number; encrypted: number; unencrypted: number }
  audit?: { entries: number; chainValid: boolean }
}

/** Salons vus par le serveur: métadonnées seulement (nom, membres, chiffrement), jamais le contenu. */
export async function listRooms(token: string): Promise<RoomRow[]> {
  const res = await call(token, 'GET', '/rooms')
  if (!res.ok) throw await failure(res)
  return (await res.json()) as RoomRow[]
}

export async function roomMembers(token: string, roomId: string): Promise<RoomMemberRow[]> {
  const res = await call(token, 'GET', `/rooms/${encodeURIComponent(roomId)}/members`)
  if (!res.ok) throw await failure(res)
  return (await res.json()) as RoomMemberRow[]
}

export async function serverStatus(token: string): Promise<ServerStatus> {
  const res = await call(token, 'GET', '/server')
  if (!res.ok) throw await failure(res)
  return (await res.json()) as ServerStatus
}

/** Archive des métadonnées: renvoie le fichier JSON prêt à enregistrer, son nom et son empreinte SHA-256. */
export async function exportArchive(token: string): Promise<{ blob: Blob; filename: string; digest: string }> {
  const res = await call(token, 'GET', '/archive')
  if (!res.ok) throw await failure(res)
  const text = await res.text()
  const filename = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'diyoy-archive.json'
  return { blob: new Blob([text], { type: 'application/json' }), filename, digest: (JSON.parse(text) as { digest: string }).digest }
}
