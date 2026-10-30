import { randomBytes } from 'node:crypto'
import type { MatrixClient } from 'matrix-js-sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CLASSIFICATION_KEY, forwardMessage, readClassification, sendClassified } from '../../src/lib/classification.ts'
import { createEncryptedRoom } from '../../src/matrix/rooms.ts'
import { dumpDb, registerAgent, startTestClient, waitForMessage } from './helpers'

describe('SÉCURITÉ: classification des messages', () => {
  let alice: MatrixClient
  let bob: MatrixClient
  let roomId: string
  let archiveId: string
  const secret = `effectifs confidentiels ${randomBytes(4).toString('hex')}`
  const plain = `note de service ${randomBytes(4).toString('hex')}`

  beforeAll(async () => {
    const [a, b] = await Promise.all([registerAgent('awa'), registerAgent('moussa')])
    ;[alice, bob] = await Promise.all([startTestClient(a), startTestClient(b)])
    roomId = await createEncryptedRoom(alice, { name: 'Cabinet', invite: [b.userId] })
    await bob.joinRoom(roomId)
    archiveId = await createEncryptedRoom(bob, { name: 'Archives', invite: [] })
    await sendClassified(alice, roomId, secret, 'confidentiel')
    await sendClassified(alice, roomId, plain, 'normal')
  })

  afterAll(() => {
    alice?.stopClient()
    bob?.stopClient()
  })

  it('recipientSeesTheLevelAndCannotForwardAConfidentialMessage', async () => {
    const received = await waitForMessage(bob, roomId, secret)
    const c = readClassification(received.getContent())
    expect(c.level).toBe('confidentiel')
    expect(c.noForward).toBe(true)
    expect(c.expiresAt).toBeGreaterThan(Date.now() + 23 * 3_600_000)
    await expect(forwardMessage(bob, received, archiveId)).rejects.toThrow('FORWARD_FORBIDDEN')
  })

  it('normalMessageCanBeForwarded', async () => {
    const received = await waitForMessage(bob, roomId, plain)
    expect(readClassification(received.getContent()).level).toBe('normal')
    await forwardMessage(bob, received, archiveId)
    expect((await waitForMessage(bob, archiveId, plain)).getContent().body).toBe(plain)
  })

  it('classificationNeverReachesServer', () => {
    const dump = dumpDb()
    expect(dump, 'la base exportée doit contenir ce salon').toContain(roomId)
    expect(dump).toContain('m.room.encrypted')
    expect(dump).not.toContain(CLASSIFICATION_KEY)
    expect(dump).not.toContain(secret)
  })
})