import { INSTRUCTION_KEY, contentSha256, tallyAcks, ACK_TYPE, type ReceivedAck } from './ack.ts'
import { readClassification } from './classification.ts'

/**
 * Archivage légal CÔTÉ DESTINATAIRE. Le serveur ne peut pas lire les messages (chiffrés de bout en bout): c'est
 * l'application de l'agent, qui les a déjà déchiffrés pour les afficher, qui en fait une copie datée et scellée.
 * Rien de ce fichier ne passe par le serveur.
 */

/** Un événement du salon, tel que l'application le voit une fois déchiffré (indépendant du SDK pour rester testable). */
export interface ArchivableEvent {
  eventId: string
  sender: string
  ts: number
  type: string
  status: 'ok' | 'redacted' | 'undecryptable'
  content: Record<string, unknown>
  /** Identifiant d'appareil déclaré dans un accusé de lecture. */
  deviceId?: string
  /** Clé d'appareil authentifiée par le chiffrement de groupe (accusés de lecture). */
  senderKey?: string
}

export type ArchiveKind = 'text' | 'instruction' | 'file' | 'voice'

export interface ArchiveEntry {
  eventId: string
  sender: string
  /** Heure d'envoi, ISO 8601 (UTC), telle que reçue du serveur. */
  sentAt: string
  kind: ArchiveKind
  /** Niveau de classification du message (les messages « confidentiel » ne sont jamais archivés). */
  level: 'normal' | 'restreinte'
  /** Texte du message; pour un fichier ou un message vocal, son nom. */
  body: string
  /** SHA-256 du texte (même empreinte que celle des accusés de lecture). */
  sha256: string
  file?: { name: string; size?: number; mimetype?: string; contentIncluded: false }
  /** Instruction de service: qui l'a lue et qui ne l'a pas lue au moment de l'export. */
  readBy?: Array<{ agent: string; readAt: string; deviceId: string }>
  pending?: string[]
}

export interface RoomArchive {
  format: 'diyoy-archive-echanges/1'
  generatedAt: string
  archivedBy: string
  room: { id: string; name: string; members: Array<{ userId: string; name: string }> }
  entries: ArchiveEntry[]
  /** Ce qui n'a PAS été archivé, par catégorie. */
  excluded: { confidentiel: number; expire: number; supprime: number; illisible: number }
  limits: string
  /** SHA-256 de tout ce qui précède: détecte toute modification du fichier après l'export. */
  digest: string
}

export const ARCHIVE_FORMAT = 'diyoy-archive-echanges/1' as const

const LIMITS =
  'Copie faite par l’agent depuis son appareil, à partir des messages déjà déchiffrés et chargés sur cet appareil. ' +
  'N’y figurent ni les messages « Confidentiel » (leur règle d’expiration l’interdit), ni les messages expirés, supprimés ou illisibles ; ' +
  'les fichiers et messages vocaux sont listés par leur nom seulement, sans leur contenu. ' +
  'L’empreinte SHA-256 détecte toute modification du fichier après l’export, mais ne prouve ni son auteur ni la date de l’export ' +
  '(ni signature, ni tiers de confiance) : pour en faire une preuve, déposer l’empreinte auprès d’un tiers. ' +
  'Ce fichier contient des échanges officiels en clair : le conserver comme un document papier de même sensibilité.'

const iso = (ts: number): string => new Date(ts).toISOString()

async function digestOf(body: unknown): Promise<string> {
  return contentSha256(JSON.stringify(body))
}

export interface ArchiveInput {
  roomId: string
  roomName: string
  members: Array<{ userId: string; name: string }>
  archivedBy: string
  events: ArchivableEvent[]
  /** Vrai si l'expéditeur a le pouvoir d'émettre une instruction de service dans ce salon. */
  isInstructionAuthority: (userId: string) => boolean
  now?: number
}

/** Construit l'archive d'un salon. Les règles de masquage de l'application (expiration, suppression) s'appliquent ici aussi. */
export async function buildRoomArchive(input: ArchiveInput): Promise<RoomArchive> {
  const now = input.now ?? Date.now()
  const excluded = { confidentiel: 0, expire: 0, supprime: 0, illisible: 0 }
  const acks: ReceivedAck[] = input.events
    .filter((e) => e.type === ACK_TYPE && e.status === 'ok')
    .map((e) => ({ sender: e.sender, deviceId: e.deviceId ?? '', senderKey: e.senderKey, content: e.content }))
  const memberIds = input.members.map((m) => m.userId)

  const entries: ArchiveEntry[] = []
  for (const e of [...input.events].sort((a, b) => a.ts - b.ts)) {
    if (e.type === 'm.room.encrypted') { excluded.illisible++; continue }
    if (e.type !== 'm.room.message') continue
    if (e.status === 'redacted') { excluded.supprime++; continue }
    if (e.status === 'undecryptable') { excluded.illisible++; continue }
    const c = e.content
    const classification = readClassification(c)
    if (classification.level === 'confidentiel') { excluded.confidentiel++; continue }
    if (classification.expiresAt !== null && now >= classification.expiresAt) { excluded.expire++; continue }

    const msgtype = typeof c.msgtype === 'string' ? c.msgtype : 'm.text'
    const isFile = msgtype === 'm.file'
    const isVoice = msgtype === 'm.audio'
    const text = String(c.filename ?? c.body ?? '')
    if (text === '' && !isFile && !isVoice) continue
    const instruction = c[INSTRUCTION_KEY] === true && input.isInstructionAuthority(e.sender)
    const kind: ArchiveKind = isVoice ? 'voice' : isFile ? 'file' : instruction ? 'instruction' : 'text'
    const sha256 = await contentSha256(text)
    const info = (c.info ?? {}) as { size?: unknown; mimetype?: unknown }
    const entry: ArchiveEntry = {
      eventId: e.eventId, sender: e.sender, sentAt: iso(e.ts), kind,
      level: classification.level === 'restreinte' ? 'restreinte' : 'normal', body: text, sha256,
    }
    if (isFile || isVoice) {
      entry.file = {
        name: text,
        ...(typeof info.size === 'number' ? { size: info.size } : {}),
        ...(typeof info.mimetype === 'string' ? { mimetype: info.mimetype } : {}),
        contentIncluded: false,
      }
    }
    if (kind === 'instruction') {
      const tally = tallyAcks(acks, { eventId: e.eventId, sha256 }, memberIds.filter((m) => m !== e.sender))
      entry.readBy = tally.read.map((r) => ({ agent: r.sender, readAt: iso(r.readAt), deviceId: r.deviceId }))
      entry.pending = tally.pending
    }
    entries.push(entry)
  }

  const body = {
    format: ARCHIVE_FORMAT,
    generatedAt: iso(now),
    archivedBy: input.archivedBy,
    room: { id: input.roomId, name: input.roomName, members: input.members },
    entries,
    excluded,
    limits: LIMITS,
  }
  return { ...body, digest: await digestOf(body) }
}

export type ArchiveCheck = 'intact' | 'modified' | 'invalid'

/** Relit une archive: « intact » si l'empreinte correspond, « modified » si le contenu a changé, « invalid » si ce n'est pas une archive DÎYOY. */
export async function verifyRoomArchive(raw: unknown): Promise<ArchiveCheck> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'invalid'
  const { digest, ...body } = raw as Record<string, unknown>
  if (body.format !== ARCHIVE_FORMAT || typeof digest !== 'string') return 'invalid'
  return (await digestOf(body)) === digest ? 'intact' : 'modified'
}
