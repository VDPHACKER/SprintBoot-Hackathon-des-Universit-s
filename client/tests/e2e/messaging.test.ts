import { randomBytes } from 'node:crypto'
import type { MatrixClient } from 'matrix-js-sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEncryptedRoom, sendText } from '../../src/matrix/rooms.ts'
import { dumpDb, registerAgent, startTestClient, waitForMessage } from './helpers'

describe('SÉCURITÉ: messages chiffrés de bout en bout', () => {
  let alice: MatrixClient
  let bob: MatrixClient
  let roomId: string
  const phrase = `bonjour ministère ${randomBytes(4).toString('hex')}`

  beforeAll(async () => {
    const [a, b] = await Promise.all([registerAgent('awa'), registerAgent('moussa')])
    ;[alice, bob] = await Promise.all([startTestClient(a), startTestClient(b)])
    // Les comptes jetables sont créés avec un nom aléatoire: on invite par identifiant Matrix complet.
    roomId = await createEncryptedRoom(alice, { name: 'Cabinet', invite: [b.userId] })
    await bob.joinRoom(roomId)
  })

  afterAll(() => {
    alice?.stopClient()
    bob?.stopClient()
  })

  it('aliceAndBobExchange', async () => {
    await sendText(alice, roomId, phrase)
    const received = await waitForMessage(bob, roomId, phrase)
    expect(received.getContent().body).toBe(phrase)
    expect(received.getSender()).toBe(alice.getUserId())

    // Dans l'autre sens aussi: la session est établie dans les deux directions.
    const reply = `bien reçu ${randomBytes(4).toString('hex')}`
    await sendText(bob, roomId, reply)
    expect((await waitForMessage(alice, roomId, reply)).getContent().body).toBe(reply)
  })

  it('serverStoresOnlyCiphertext', async () => {
    const dump = dumpDb()
    expect(dump, 'la base exportée doit contenir ce salon').toContain(roomId)
    expect(dump).toContain('m.room.encrypted')
    expect(dump).not.toContain(phrase)
  })
})