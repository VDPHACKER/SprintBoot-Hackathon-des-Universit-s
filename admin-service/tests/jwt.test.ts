import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose'
import { describe, expect, it } from 'vitest'
import { joseVerifier } from '../src/auth.ts'

const ISSUER = 'http://auth.localhost:8081/realms/bf'

async function setup(jwkAlg: string | undefined = 'RS256') {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk: JWK = { ...(await exportJWK(publicKey)), use: 'sig', kid: 'k1', ...(jwkAlg ? { alg: jwkAlg } : {}) }
  const verify = joseVerifier('http://non-utilise.invalid/certs', ISSUER, createLocalJWKSet({ keys: [jwk] }))
  const sign = (claims: Record<string, unknown> = {}, o: { alg?: string; issuer?: string; expires?: string; key?: CryptoKey } = {}) =>
    new SignJWT({ realm_access: { roles: ['admin'] }, ...claims })
      .setProtectedHeader({ alg: o.alg ?? 'RS256', kid: 'k1' })
      .setIssuer(o.issuer ?? ISSUER)
      .setExpirationTime(o.expires ?? '5m')
      .sign(o.key ?? privateKey)
  return { verify, sign }
}

describe('joseVerifier', () => {
  it('returnsTheRealmRolesOfAValidToken', async () => {
    const { verify, sign } = await setup()
    expect(await verify(await sign())).toEqual({ roles: ['admin'] })
  })

  it('aTokenWithoutRealmAccessHasNoRoles', async () => {
    const { verify, sign } = await setup()
    expect(await verify(await sign({ realm_access: undefined }))).toEqual({ roles: [] })
  })

  it('rejectsAnotherIssuer', async () => {
    const { verify, sign } = await setup()
    await expect(verify(await sign({}, { issuer: 'http://autre.example/realms/bf' }))).rejects.toThrow()
  })

  it('rejectsAnExpiredToken', async () => {
    const { verify, sign } = await setup()
    await expect(verify(await sign({}, { expires: '-1m' }))).rejects.toThrow()
  })

  it('rejectsATokenSignedByAnotherKey', async () => {
    const { verify, sign } = await setup()
    const other = await generateKeyPair('RS256')
    await expect(verify(await sign({}, { key: other.privateKey }))).rejects.toThrow()
  })

  it('rejectsATokenSignedWithAnUnexpectedAlgorithmEvenWithTheRightKey', async () => {
    // Un jeu de clés sans « alg » accepterait RS512 avec la même clé RSA: on impose RS256 (algorithme de Keycloak).
    const { privateKey } = await generateKeyPair('RS256', { extractable: true })
    const { publicKey, privateKey: realKey } = await generateKeyPair('RS512')
    const jwk: JWK = { ...(await exportJWK(publicKey)), use: 'sig', kid: 'k1' } // pas d'« alg »
    void privateKey
    const verify = joseVerifier('http://non-utilise.invalid/certs', ISSUER, createLocalJWKSet({ keys: [jwk] }))
    const token = await new SignJWT({ realm_access: { roles: ['admin'] } })
      .setProtectedHeader({ alg: 'RS512', kid: 'k1' })
      .setIssuer(ISSUER)
      .setExpirationTime('5m')
      .sign(realKey)
    await expect(verify(token)).rejects.toThrow()
  })

  it('rejectsAnUnsignedToken', async () => {
    const { verify } = await setup()
    const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss: ISSUER, realm_access: { roles: ['admin'] } })).toString('base64url')}.`
    await expect(verify(unsigned)).rejects.toThrow()
  })
})