import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk'

/** Clé du niveau de classification, placée DANS le contenu chiffré du message: le serveur ne la voit jamais. */
export const CLASSIFICATION_KEY = 'bf.gov.classification'

export type Level = 'normal' | 'restreinte' | 'confidentiel'
export const LEVELS: readonly Level[] = ['normal', 'restreinte', 'confidentiel']

export interface Classification {
  level: Level
  noForward: boolean
  expiresAt: number | null
}

const DAY_MS = 86_400_000

/** Règles de chaque niveau. C'est le niveau qui décide: aucune règle n'est lue dans le message reçu. */
const POLICY: Record<Level, { noForward: boolean; defaultTtlMs: number | null }> = {
  normal: { noForward: false, defaultTtlMs: null },
  restreinte: { noForward: true, defaultTtlMs: null },
  confidentiel: { noForward: true, defaultTtlMs: DAY_MS },
}

export const policyFor = (level: Level): { noForward: boolean; defaultTtlMs: number | null } => ({ ...POLICY[level] })

const isLevel = (value: unknown): value is Level => typeof value === 'string' && (LEVELS as readonly string[]).includes(value)

/**
 * Lit le niveau d'un message reçu. Sans clé: normal. Clé présente mais illisible ou de niveau inconnu (message
 * d'un client plus récent, ou falsifié): on applique la règle la plus stricte, confidentiel. L'interdiction de
 * transfert est recalculée à partir du niveau; un champ `noForward` envoyé par l'expéditeur est ignoré.
 */
export function readClassification(content: Record<string, unknown>): Classification {
  const raw = content[CLASSIFICATION_KEY]
  if (raw === undefined) return { level: 'normal', noForward: false, expiresAt: null }
  const fields = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const level = isLevel(fields.level) ? fields.level : 'confidentiel'
  const e = fields.expiresAt
  return {
    level,
    noForward: POLICY[level].noForward,
    expiresAt: typeof e === 'number' && Number.isFinite(e) && e > 0 ? e : null,
  }
}

/** Contenu d'un message texte avec son niveau et son éventuelle échéance. Lève EMPTY_MESSAGE ou INVALID_TTL. */
export function classifiedContent(body: string, level: Level, ttlMs?: number): Record<string, unknown> {
  if (body.trim() === '') throw new Error('EMPTY_MESSAGE')
  if (ttlMs !== undefined && !(Number.isFinite(ttlMs) && ttlMs > 0)) throw new Error('INVALID_TTL')

  const ttl = ttlMs ?? POLICY[level].defaultTtlMs
  const content: Record<string, unknown> = { msgtype: 'm.text', body }
  // Un message normal sans expiration reste un message Matrix ordinaire.
  if (level !== 'normal' || ttl !== null) {
    content[CLASSIFICATION_KEY] = { level, expiresAt: ttl === null ? null : Date.now() + ttl }
  }
  return content
}

/** Envoie un message texte avec son niveau. L'expiration vaut `maintenant + ttlMs`, ou la durée par défaut du niveau. */
export async function sendClassified(
  client: Pick<MatrixClient, 'sendMessage'>,
  roomId: string,
  body: string,
  level: Level,
  ttlMs?: number,
): Promise<string> {
  const { event_id } = await client.sendMessage(roomId, classifiedContent(body, level, ttlMs) as never)
  return event_id
}

/** Transfère un message déjà déchiffré vers un autre salon, sauf si son niveau l'interdit. */
export async function forwardMessage(
  client: Pick<MatrixClient, 'sendMessage'>,
  source: MatrixEvent,
  destinationRoomId: string,
): Promise<string> {
  const content: Record<string, unknown> = { ...source.getContent() }
  if (readClassification(content).noForward) throw new Error('FORWARD_FORBIDDEN')
  if (typeof content.msgtype !== 'string') throw new Error('NOT_A_MESSAGE') // pas encore déchiffré
  delete content['m.relates_to'] // un transfert n'est la réponse à rien dans l'autre salon
  const { event_id } = await client.sendMessage(destinationRoomId, content as never)
  return event_id
}