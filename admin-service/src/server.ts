import Fastify, { type FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import type { Guard } from './auth.ts'
import { AgentError, enroll, revoke, type AgentInput, type Deps } from './agents.ts'

export interface ServerDeps extends Deps {
  adminGuard: Guard
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const server = Fastify({ logger: false })

  // Un POST sans corps (révocation) peut arriver avec un content-type JSON: on l'accepte.
  server.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '') return done(null, undefined)
    try {
      done(null, JSON.parse(body as string))
    } catch {
      done(new AgentError('INVALID_JSON'), undefined)
    }
  })

  server.setErrorHandler((err, _req, reply) => {
    if (err instanceof AgentError) return reply.code(400).send({ error: err.code })
    console.error(err)
    return reply.code(500).send({ error: 'INTERNAL' })
  })

  server.get('/health', async () => ({ status: 'ok' }))

  server.register(async (admin) => {
    admin.addHook('preHandler', deps.adminGuard)

    admin.post('/agents', async (req, reply) => {
      const body = (req.body ?? {}) as AgentInput
      // Mot de passe temporaire: fourni par l'administrateur, sinon généré. Renvoyé une seule fois, jamais stocké ici.
      const initialPassword = body.initialPassword ?? randomBytes(12).toString('base64url')
      const agent = await enroll(deps, { ...body, initialPassword })
      return reply.code(201).send({ ...agent, initialPassword })
    })

    admin.get('/agents', async () => deps.identity.listUsers())

    admin.get('/directory', async (req) => {
      const { ministry } = req.query as { ministry?: string }
      const users = await deps.identity.listUsers()
      return users
        .filter((u) => u.status === 'active' && (ministry === undefined || u.ministry === ministry))
        .map(({ username, displayName, ministry: m, fonction }) => ({ username, displayName, ministry: m, fonction }))
    })

    admin.post('/agents/:username/revoke', async (req) => {
      const { username } = req.params as { username: string }
      return revoke(deps, username)
    })
  })

  return server
}