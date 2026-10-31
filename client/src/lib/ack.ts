import type { MatrixClient } from 'matrix-js-sdk'
import { classifiedContent, type Level } from './classification.ts'

/** Marque un message comme « instruction de service » (dans le contenu chiffré: le serveur ne le voit pas). */
export const INSTRUCTION_KEY = 'bf.gov.instruction'
/** Type d'événement de l'accusé de lecture. Envoyé dans le salon chiffré, donc chiffré de bout en bout. */
export const ACK_TYPE = 'bf.gov.ack'
/** Niveau de pouvoir minimal dans le salon (modérateur) pour qu'un message compte comme instruction de service. */
export const INSTRUCTION_MIN_POWER = 50

/**
 * Clé de mémorisation « accusé déjà envoyé », PAR UTILISATEUR: deux agents qui se succèdent sur le même navigateur ne
 * doivent pas partager cette mémoire (le second n'enverrait jamais son accusé). Sous le préfixe f.: effacée à la déconnexion.
 */
export const ackMarkerKey = (userId: string, eventId: string): string => `bf.ack.${userId}.${eventId}`

/** Empreinte SHA-256 (hexadécimale) du texte en UTF-8. Hachage standard du navigateur: ce n'est pas du chiffrement. */
export async function contentSha256(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Seul un modérateur du salon peut émettre une instruction de service: les autres clients ne la traitent comme telle
 * que si l'expéditeur a ce pouvoir. (Le serveur ne peut pas le vérifier lui-même: le contenu est chiffré.)
 */
export const isInstructionAuthority = (powerLevel: number | undefined): boolean =>
  typeof powerLevel === 'number' && powerLevel >= INSTRUCTION_MIN_POWER

/** Envoie une instruction de service, éventuellement classifiée. */
export async function sendInstruction(
  client: Pick<MatrixClient, 'sendMessage'>,
  roomId: string,
  body: string,
  level: Level = 'normal',
): Promise<string> {
  const content = { ...classifiedContent(body, level), [INSTRUCTION_KEY]: true }
  const { event_id } = await client.sendMessage(roomId, content as never)
  return event_id
}

/**
 * Envoie l'accusé de lecture d'une instruction: identifiant de l'instruction, empreinte de son texte et heure locale.
 * L'authenticité de l'auteur et de l'appareil vient du chiffrement de groupe (signature d'appareil de Megolm):
 * aucune signature n'est écrite ici.
 */
export async function sendAck(
  client: Pick<MatrixClient, 'sendEvent'>,
  roomId: string,
  instruction: { eventId: string; body: string },
): Promise<void> {
  await client.sendEvent(roomId, ACK_TYPE as never, {
    instruction_event_id: instruction.eventId,
    content_sha256: await contentSha256(instruction.body),
    read_at: Date.now(),
  } as never)
}

export interface AckRecord {
  sender: string
  deviceId: string
  readAt: number
}

export interface ReceivedAck {
  sender: string
  deviceId: string
  content: Record<string, unknown>
}

/**
 * Compte les lecteurs d'une instruction. Un accusé ne compte que s'il vient d'un membre, vise cette instruction, porte
 * l'empreinte exacte de son texte et une heure plausible. Un agent compte une fois, avec sa PREMIÈRE lecture
 * (deux appareils ou une réouverture ne gonflent pas le compte). `pending`: les membres sans accusé valide.
 */
export function tallyAcks(
  acks: ReceivedAck[],
  instruction: { eventId: string; sha256: string },
  members: string[],
): { read: AckRecord[]; pending: string[] } {
  const isMember = new Set(members)
  const first = new Map<string, AckRecord>()
  for (const ack of acks) {
    const c = ack.content
    if (!isMember.has(ack.sender)) continue
    if (c.instruction_event_id !== instruction.eventId || c.content_sha256 !== instruction.sha256) continue
    const readAt = c.read_at
    if (typeof readAt !== 'number' || !Number.isFinite(readAt) || readAt <= 0) continue
    const previous = first.get(ack.sender)
    if (!previous || readAt < previous.readAt) first.set(ack.sender, { sender: ack.sender, deviceId: ack.deviceId, readAt })
  }
  return {
    read: [...first.values()].sort((a, b) => a.readAt - b.readAt),
    pending: members.filter((m) => !first.has(m)),
  }
}