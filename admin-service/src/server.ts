import Fastify, { type FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import type { AuditAction, AuditLog } from './audit.ts'
import type { Guard } from './auth.ts'
import { buildArchive, describeMembers, isRoomId, serverStatus } from './overview.ts'
import { AgentError, changeRole, enroll, revoke, type AgentInput, type Deps, type Role } from './agents.ts'

export interface ServerDeps extends Deps {
  adminGuard: Guard
  /** Journal d'audit des actions d'administration (absent: rien n'est enregistré). */
  audit?: AuditLog
  /** Faux tant que le démarrage n'est pas terminé (comptes de démonstration); sert au contrôle de santé. */
  isReady?: () => boolean
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const startedAt = Date.now()
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
    if (err instanceof AgentError) return reply.code(err.code === 'REVOKED_ACCOUNT' || err.code === 'LAST_ADMIN' ? 409 : err.code === 'UNKNOWN_AGENT' ? 404 : 400).send({ error: err.code })
    console.error(err)
    return reply.code(500).send({ error: 'INTERNAL' })
  })

  server.get('/health', async (_req, reply) => {
    const ready = deps.isReady?.() ?? true
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ok' : 'starting' })
  })

  // Un échec d'écriture du journal ne doit JAMAIS empêcher une révocation: on le signale dans les journaux du service et on rend le résultat.
  const record = async (actor: string | undefined, action: AuditAction, target: string, detail?: string): Promise<void> => {
    try {
      await deps.audit?.append({ actor: actor ?? 'inconnu', action, target, ...(detail === undefined ? {} : { detail }) })
    } catch (err) {
      console.error('journal d audit: écriture impossible', err)
    }
  }

  server.register(async (admin) => {
    admin.addHook('preHandler', deps.adminGuard)

    admin.get('/server', async () => serverStatus(deps, deps.audit, startedAt))

    admin.get('/rooms', async () => deps.synapse.listRooms())

    admin.get('/rooms/:roomId/members', async (req, reply) => {
      const { roomId } = req.params as { roomId: string }
      if (!isRoomId(roomId)) return reply.code(400).send({ error: 'INVALID_ROOM' })
      const [mxids, users] = await Promise.all([deps.synapse.roomMembers(roomId), deps.identity.listUsers()])
      return describeMembers(mxids, users, deps.domain)
    })

    // Archive des métadonnées (jamais du contenu: il est chiffré de bout en bout). L'export lui-même est tracé dans le journal.
    admin.get('/archive', async (req, reply) => {
      const doc = await buildArchive(deps, deps.audit)
      await record(req.actor, 'archive', 'archive', `${doc.rooms.length} salons · ${doc.agents.length} agents · ${doc.digest.slice(0, 12)}`)
      return reply
        .header('content-disposition', `attachment; filename="diyoy-archive-${doc.generatedAt.slice(0, 10)}.json"`)
        .send(doc)
    })

    admin.get('/audit', async (req) => {
      const { limit } = req.query as { limit?: string }
      const n = Math.min(Math.max(Number.parseInt(limit ?? '', 10) || 200, 1), 1000)
      return (await deps.audit?.list(n)) ?? { entries: [], chainValid: true }
    })

    admin.post('/agents', async (req, reply) => {
      const body = (req.body ?? {}) as AgentInput
      // Mot de passe temporaire: fourni par l'administrateur, sinon généré. Renvoyé une seule fois, jamais stocké ici.
      const initialPassword = body.initialPassword ?? randomBytes(12).toString('base64url')
      const agent = await enroll(deps, { ...body, initialPassword })
      await record(req.actor, 'enroll', agent.username, `${agent.role} · ${agent.ministry}`)
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

    admin.post('/agents/:username/role', async (req) => {
      const { username } = req.params as { username: string }
      const { role } = (req.body ?? {}) as { role?: Role }
      const result = await changeRole(deps, username, role as Role)
      if (result.previousRole !== result.role) await record(req.actor, 'role', username, `${result.previousRole} → ${result.role}`)
      return result
    })

    admin.post('/agents/:username/revoke', async (req) => {
      const { username } = req.params as { username: string }
      const report = await revoke(deps, username)
      await record(req.actor, 'revoke', username)
      return report
    })
  })

  return server
}