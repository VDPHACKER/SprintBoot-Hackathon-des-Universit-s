import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'

export type BearerCheck = 'ok' | 'missing' | 'forbidden'

const digest = (s: string) => createHash('sha256').update(s).digest()

/** Compare des empreintes de même longueur, en temps constant (comparaison, pas de chiffrement). */
export function checkBearer(header: string | undefined, expected: string): BearerCheck {
  const match = /^Bearer (.+)$/.exec(header ?? '')
  if (!match) return 'missing'
  return timingSafeEqual(digest(match[1]), digest(expected)) ? 'ok' : 'forbidden'
}

/** Garde de la tâche 3: jeton statique. La tâche 4 la remplace par la validation du JWT Keycloak. */
export function adminTokenGuard(expected: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const result = checkBearer(req.headers.authorization, expected)
    if (result === 'missing') return reply.code(401).send({ error: 'UNAUTHENTICATED' })
    if (result === 'forbidden') return reply.code(403).send({ error: 'FORBIDDEN' })
  }
}