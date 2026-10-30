import { randomBytes } from 'node:crypto'
import { HttpApiEvent, type MatrixClient } from 'matrix-js-sdk'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createEncryptedRoom, sendText } from '../../src/matrix/rooms.ts'
import { watchForRevocation } from '../../src/matrix/session.ts'
import { BASE, adminJwt, api, registerAgent, startTestClient, waitForEvent, waitForMessage, type TestAgent } from './helpers'

const localpart = (userId: string) => userId.slice(1).split(':')[0]
const sessionId = (event: { getWireContent(): Record<string, unknown> }) => String(event.getWireContent().session_id)

describe('SÉCURITÉ: révocation immédiate', () => {
  let awa: TestAgent
  let moussa: TestAgent
  let issa: TestAgent
  let alice: MatrixClient
  let carol: MatrixClient
  let dave: MatrixClient
  let roomId: string
  // Compteur simple: vitest réinitialise les fonctions simulées entre deux tests, or la déconnexion a lieu pendant le premier.
  let signedOut = 0

  beforeAll(async () => {
    ;[awa, moussa, issa] = await Promise.all([registerAgent('awa'), registerAgent('moussa'), registerAgent('issa')])
    ;[alice, carol, dave] = await Promise.all([startTestClient(awa), startTestClient(moussa), startTestClient(issa)])
    watchForRevocation(carol, () => void signedOut++, { length: 0, key: () => null, removeItem: () => undefined })
    roomId = await createEncryptedRoom(alice, { name: 'Direction', invite: [moussa.userId, issa.userId] })
    await Promise.all([carol.joinRoom(roomId), dave.joinRoom(roomId)])
  })

  afterAll(() => {
    for (const c of [alice, carol, dave]) c?.stopClient()
  })

  it('revokedAgentLosesEverything', async () => {
    // Avant: moussa lit les messages du groupe.
    const before = `avant révocation ${randomBytes(3).toString('hex')}`
    await sendText(alice, roomId, before)
    await waitForMessage(carol, roomId, before)
    const sessionBefore = sessionId(await waitForMessage(dave, roomId, before))

    // L'administrateur révoque moussa.
    const revokedAt = Date.now()
    const res = await fetch(`${BASE}/admin-api/agents/${localpart(moussa.userId)}/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await adminJwt()}` },
    })
    expect(res.status).toBe(200)

    // (a) Son jeton est mort tout de suite: plus aucun accès, nulle part.
    const whoami = await api('/_matrix/client/v3/account/whoami', moussa.accessToken)
    expect(whoami.status).toBe(401)
    expect(((await whoami.json()) as { errcode: string }).errcode).toBe('M_UNKNOWN_TOKEN')
    expect(Date.now() - revokedAt, 'le jeton doit être invalide en moins de 2 s').toBeLessThan(2000)

    // (b) Il n'est plus membre du groupe (la sortie des salons est faite en tâche de fond par Synapse).
    await vi.waitFor(
      async () => {
        const members = await api(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`, awa.accessToken)
        expect(Object.keys(((await members.json()) as { joined: Record<string, unknown> }).joined)).not.toContain(moussa.userId)
      },
      { timeout: 10_000, interval: 500 },
    )

    // (c) Les clients restants changent de clé de groupe: un message écrit après la révocation n'est pas chiffré
    //     avec la clé que moussa possède. On attend qu'alice ait vu son départ avant d'écrire.
    await vi.waitFor(() => expect(alice.getRoom(roomId)?.getMember(moussa.userId)?.membership).toBe('leave'), {
      timeout: 10_000,
      interval: 500,
    })
    const after = `après révocation ${randomBytes(3).toString('hex')}`
    await sendText(alice, roomId, after)
    const received = await waitForMessage(dave, roomId, after)
    expect(sessionId(received)).not.toBe(sessionBefore)

    // Et il ne peut rien lire de nouveau avec son ancien jeton.
    const history = await api(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=5`, moussa.accessToken)
    expect(history.status).toBe(401)
  })

  it('revokedClientSignsItselfOutAndReturnsToLogin', async () => {
    // Point de contrôle 2: l'application de moussa, encore ouverte, doit se déconnecter seule, sans erreur technique.
    await vi.waitFor(() => expect(signedOut).toBe(1), { timeout: 60_000, interval: 500 })
    expect(carol.clientRunning).toBe(false)
  })
})