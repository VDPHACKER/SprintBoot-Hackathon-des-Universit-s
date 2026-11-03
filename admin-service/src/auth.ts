import type { FastifyReply, FastifyRequest } from 'fastify'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { Role } from './agents.ts'

export interface TokenClaims {
  roles: string[]
  /** Identifiant de l'appelant (preferred_username), pour le journal d'audit. */
  username?: string
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Renseigné par la garde d'administration une fois le jeton vérifié. */
    actor?: string
  }
}
/** Vérifie un jeton et renvoie ses rôles; lève une erreur si le jeton est invalide. */
export type TokenVerifier = (token: string) => Promise<TokenClaims>
export type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<void>

/** 401 sans jeton valide, 403 si le jeton est valide mais n'a pas le rôle exigé. */
export function roleGuard(verify: TokenVerifier, role: Role): Guard {
  return async (req, reply) => {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')
    if (!match) return reply.code(401).send({ error: 'UNAUTHENTICATED' })
    let claims: TokenClaims
    try {
      claims = await verify(match[1])
    } catch {
      return reply.code(401).send({ error: 'UNAUTHENTICATED' })
    }
    if (!claims.roles.includes(role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    req.actor = claims.username ?? 'inconnu'
  }
}

/** Valide la signature (JWKS du realm) et l'émetteur d'un JWT Keycloak, puis lit `realm_access.roles`. */
export function joseVerifier(
  jwksUrl: string,
  issuer: string,
  jwks: JWTVerifyGetKey = createRemoteJWKSet(new URL(jwksUrl)),
): TokenVerifier {
  return async (token) => {
    // Algorithme imposé (celui de Keycloak): on ne laisse pas le jeton choisir comment il est vérifié.
    const { payload } = await jwtVerify(token, jwks, { issuer, algorithms: ['RS256'] })
    const realmAccess = payload.realm_access as { roles?: string[] } | undefined
    const username = typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined
    return { roles: realmAccess?.roles ?? [], username }
  }
}