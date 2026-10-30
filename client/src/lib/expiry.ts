import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk'
import { readClassification, type Classification } from './classification.ts'

/** setTimeout plafonne à 2^31-1 ms (environ 24,8 jours): au-delà il se déclenche tout de suite. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1

/** Vrai à partir de l'échéance (comprise). Sans échéance, jamais. */
export function isExpired(classification: Classification, now: number): boolean {
  return classification.expiresAt !== null && now >= classification.expiresAt
}

/**
 * Les événements à afficher: ni expirés, ni supprimés. C'est LE masquage, côté destinataire: il ne dépend de personne.
 * Même si l'expéditeur est hors ligne et ne supprime jamais le message, chaque client cesse de l'afficher à l'échéance.
 * Un événement pas encore déchiffré n'a pas d'échéance connue: il reste affiché (« déchiffrement en cours »).
 */
export function visibleEvents(events: MatrixEvent[], now: number): MatrixEvent[] {
  return events.filter((event) => !event.isRedacted() && !isExpired(readClassification(event.getContent()), now))
}

/**
 * Planifie la suppression, pour tout le monde, d'un message expirant. Seul son expéditeur le fait: les autres clients
 * se contentent de masquer. Une échéance déjà passée (application rouverte après coup) supprime tout de suite.
 * Renvoie la fonction d'annulation. Aucun motif n'est joint: une rédaction part en clair vers le serveur.
 */
export function scheduleExpiry(
  client: Pick<MatrixClient, 'getUserId' | 'redactEvent'>,
  event: MatrixEvent,
  now: () => number = Date.now,
): () => void {
  const { expiresAt } = readClassification(event.getContent())
  const roomId = event.getRoomId()
  const eventId = event.getId()
  if (expiresAt === null || !roomId || !eventId || event.getSender() !== client.getUserId()) return () => undefined

  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = () => {
    const left = expiresAt - now()
    if (left > 0) {
      timer = setTimeout(tick, Math.min(left, MAX_TIMEOUT_MS))
      return
    }
    void client.redactEvent(roomId, eventId).catch(() => undefined) // hors ligne: le masquage local suffit, on réessaiera au prochain démarrage
  }
  tick()
  return () => clearTimeout(timer)
}