import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { roleGuard, type TokenVerifier } from '../src/auth.ts'

const verify: TokenVerifier = async (token) => {
  if (token === 'jwt-admin') return { roles: ['admin', 'agent'] }
  if (token === 'jwt-agent') return { roles: ['agent'] }
  throw new Error('signature invalide')
}

function app() {
  const s = Fastify()
  s.get('/secret', { preHandler: roleGuard(verify, 'admin') }, async () => ({ ok: true }))
  return s
}
const get = (headers: Record<string, string> = {}) => app().inject({ method: 'GET', url: '/secret', headers })

describe('roleGuard', () => {
  it('rejectsMissingToken', async () => {
    expect((await get()).statusCode).toBe(401)
  })
  it('rejectsInvalidToken', async () => {
    expect((await get({ authorization: 'Bearer nimporte-quoi' })).statusCode).toBe(401)
  })
  it('rejectsValidTokenWithoutRequiredRole', async () => {
    expect((await get({ authorization: 'Bearer jwt-agent' })).statusCode).toBe(403)
  })
  it('acceptsValidTokenWithRequiredRole', async () => {
    expect((await get({ authorization: 'Bearer jwt-admin' })).statusCode).toBe(200)
  })
})