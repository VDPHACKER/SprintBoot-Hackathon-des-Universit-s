import { randomBytes } from 'node:crypto'
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CLASSIFICATION_KEY, readClassification, sendClassified } from '../../src/lib/classification.ts'
import { scheduleExpiry, visibleEvents } from '../../src/lib/expiry.ts'
import { createEncryptedRoom } from '../../src/matrix/rooms.ts'
import { registerAgent, startTestClient, waitForMessage } from './helpers'

describe('SÉCURITÉ: expiration automatique', () => {
  let alice: MatrixClient
  let bob: MatrixClient
  let roomId: string

  beforeAll(async () => {
    const [a, b] = await Promise.all([registerAgent('awa'), registerAgent('moussa')])
    ;[alice, bob] = await Promise.all([startTestClient(a), startTestClient(b)])
    roomId = await createEncryptedRoom(alice, { name: 'Cabinet', invite: [b.userId] })
    await bob.joinRoom(roomId)
  })

  afterAll(() => {
    alice?.stopClient()
    bob?.stopClient()
  })

  const bobsEvents = () => bob.getRoom(roomId)?.getLiveTimeline().getEvents() ?? []
  const bodies = (events: MatrixEvent[]) => events.map((e) => e.getContent().body)

  it('senderOnlineRedactsAtExpiryForEveryone', async () => {
    const body = `éphémère en ligne ${randomBytes(3).toString('hex')}`
    await sendClassified(alice, roomId, body, 'confidentiel', 2000)
    const mine = await waitForMessage(alice, roomId, body)
    scheduleExpiry(alice, mine)
    const theirs = await waitForMessage(bob, roomId, body)
    expect(readClassification(theirs.getContent()).expiresAt).not.toBeNull()

    // Le serveur reçoit une rédaction à l'échéance: le message disparaît aussi de l'historique de moussa.
    await vi.waitFor(() => expect(theirs.isRedacted()).toBe(true), { timeout: 15_000, interval: 500 })
    expect(bodies(visibleEvents(bobsEvents(), Date.now()))).not.toContain(body)
  })

  it('bobHidesAfterTtlEvenIfAliceIsOffline', async () => {
    // Point de contrôle 1: personne ne rédige, et pourtant le destinataire ne doit plus voir le message.
    const body = `éphémère hors ligne ${randomBytes(3).toString('hex')}`
    await sendClassified(alice, roomId, body, 'confidentiel', 2000)
    const received = await waitForMessage(bob, roomId, body)
    expect(bodies(visibleEvents(bobsEvents(), Date.now()))).toContain(body)

    alice.stopClient() // l'expéditeur est hors ligne: aucune rédaction ne partira
    await new Promise((r) => setTimeout(r, 3000))

    expect(bodies(visibleEvents(bobsEvents(), Date.now()))).not.toContain(body)
    expect(received.isRedacted(), 'le serveur n’a reçu aucune rédaction').toBe(false)
    expect(received.getContent()[CLASSIFICATION_KEY], 'le contenu est toujours là, simplement masqué').toBeDefined()
  })
})