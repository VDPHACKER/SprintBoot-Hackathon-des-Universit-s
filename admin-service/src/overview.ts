import { createHash } from 'node:crypto'
import type { Agent, Deps, RoomInfo } from './agents.ts'
import type { AuditEntry, AuditLog } from './audit.ts'

/** Un identifiant de salon Matrix ressemble à `!abc:chat.localhost` ou, pour les versions récentes, à `!abc` seul; on refuse tout le reste avant de le placer dans une URL. */
const ROOM_ID = /^![A-Za-z0-9._~=+-]{1,100}(:[A-Za-z0-9.-]{1,100})?$/
export const isRoomId = (value: string): boolean => ROOM_ID.test(value)

export interface RoomMember {
  mxid: string
  /** Identifiant d'agent si le membre est un agent enrôlé de ce serveur. */
  username?: string
  displayName: string
  status?: Agent['status']
}

/** Associe les identifiants Matrix aux fiches des agents (nom, état). Un membre inconnu reste affiché par son identifiant. */
export function describeMembers(mxids: string[], agents: Agent[], domain: string): RoomMember[] {
  const byName = new Map(agents.map((a) => [a.username, a]))
  const suffix = `:${domain}`
  return mxids.map((mxid) => {
    const username = mxid.startsWith('@') && mxid.endsWith(suffix) ? mxid.slice(1, -suffix.length) : undefined
    const agent = username === undefined ? undefined : byName.get(username)
    return agent
      ? { mxid, username: agent.username, displayName: agent.displayName, status: agent.status }
      : { mxid, displayName: mxid }
  })
}

const safe = async <T>(run: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await run()
  } catch {
    return undefined
  }
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

/** État réel des composants et chiffres clés. Un composant injoignable est signalé, il ne fait pas échouer toute la page. */
export async function serverStatus(deps: Deps, audit: AuditLog | undefined, startedAt: number): Promise<ServerStatus> {
  const [version, rooms, users, journal] = await Promise.all([
    safe(() => deps.synapse.version()),
    safe(() => deps.synapse.listRooms()),
    safe(() => deps.identity.listUsers()),
    safe(async () => audit?.list(1000)),
  ])
  return {
    serverName: deps.domain,
    generatedAt: new Date().toISOString(),
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    synapse: { reachable: version !== undefined || rooms !== undefined, ...(version === undefined ? {} : { version }) },
    identity: { reachable: users !== undefined },
    ...(users === undefined ? {} : {
      agents: {
        total: users.length,
        active: users.filter((u) => u.status === 'active').length,
        revoked: users.filter((u) => u.status === 'revoked').length,
        admins: users.filter((u) => u.role === 'admin' && u.status === 'active').length,
      },
    }),
    ...(rooms === undefined ? {} : {
      rooms: { total: rooms.length, encrypted: rooms.filter((r) => r.encryption !== null).length, unencrypted: rooms.filter((r) => r.encryption === null).length },
    }),
    ...(journal === undefined ? {} : { audit: { entries: journal.entries.length, chainValid: journal.chainValid } }),
  }
}

export interface ArchiveDocument {
  format: 'diyoy-archive-metadonnees/1'
  generatedAt: string
  serverName: string
  /** Rappel explicite: le serveur n'a jamais le contenu des échanges (chiffrés de bout en bout). */
  contentArchived: false
  note: string
  agents: Array<Pick<Agent, 'username' | 'displayName' | 'ministry' | 'fonction' | 'role' | 'status'>>
  rooms: Array<RoomInfo & { memberList: RoomMember[] }>
  audit: { chainValid: boolean; entries: AuditEntry[] }
  /** SHA-256 du document sans ce champ: permet de vérifier qu'il n'a pas été modifié après l'export. */
  digest: string
}

/** Archive des MÉTADONNÉES (agents, salons et membres, journal d'audit). Aucun message, aucun fichier: le serveur ne peut pas les lire. */
export async function buildArchive(deps: Deps, audit: AuditLog | undefined): Promise<ArchiveDocument> {
  const [users, rooms, journal] = await Promise.all([deps.identity.listUsers(), deps.synapse.listRooms(), audit?.list(100_000)])
  const detailed = await Promise.all(
    rooms.map(async (r) => ({ ...r, memberList: describeMembers(await deps.synapse.roomMembers(r.roomId), users, deps.domain) })),
  )
  const body = {
    format: 'diyoy-archive-metadonnees/1' as const,
    generatedAt: new Date().toISOString(),
    serverName: deps.domain,
    contentArchived: false as const,
    note: 'Archive des métadonnées uniquement. Les messages et fichiers sont chiffrés de bout en bout : le serveur ne peut ni les lire ni les archiver. Un archivage du contenu doit être fait par les destinataires eux-mêmes.',
    agents: users.map(({ username, displayName, ministry, fonction, role, status }) => ({ username, displayName, ministry, fonction, role, status })),
    rooms: detailed,
    audit: { chainValid: journal?.chainValid ?? true, entries: journal?.entries.slice().reverse() ?? [] },
  }
  return { ...body, digest: createHash('sha256').update(JSON.stringify(body)).digest('hex') }
}

/** Vérifie l'empreinte d'une archive relue (utile pour un contrôle hors ligne). */
export function verifyArchive(doc: ArchiveDocument): boolean {
  const { digest, ...body } = doc
  return createHash('sha256').update(JSON.stringify(body)).digest('hex') === digest
}
