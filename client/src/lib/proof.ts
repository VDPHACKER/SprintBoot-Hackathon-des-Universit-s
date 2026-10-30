import type { AckRecord } from './ack.ts'

export interface ProofReport {
  version: 1
  generatedAt: number
  instruction: { eventId: string; sha256: string; sentAt: number }
  read: Array<{ agent: string; deviceId: string; readAt: number }>
  pending: string[]
  limits: string
}

const LIMITS =
  'Les heures de lecture sont celles de l’horloge de l’appareil de chaque lecteur, sans tiers de confiance: ' +
  'ce rapport établit que le compte et l’appareil indiqués ont ouvert un message dont le texte a cette empreinte, ' +
  'pas l’instant exact de la lecture.'

/** Rapport de preuve exportable: qui a lu quelle instruction (identifiée par l'empreinte de son texte), sur quel appareil, et qui ne l'a pas lue. */
export function buildProof(
  instruction: { eventId: string; sha256: string; sentAt: number },
  tally: { read: AckRecord[]; pending: string[] },
  now: () => number = Date.now,
): ProofReport {
  return {
    version: 1,
    generatedAt: now(),
    instruction: { eventId: instruction.eventId, sha256: instruction.sha256, sentAt: instruction.sentAt },
    read: tally.read.map((r) => ({ agent: r.sender, deviceId: r.deviceId, readAt: r.readAt })),
    pending: [...tally.pending],
    limits: LIMITS,
  }
}