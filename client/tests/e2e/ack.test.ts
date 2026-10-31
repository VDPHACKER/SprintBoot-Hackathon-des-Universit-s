import { randomBytes } from 'node:crypto'
import type { MatrixClient } from 'matrix-js-sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ACK_TYPE, INSTRUCTION_KEY, contentSha256, sendAck, sendInstruction, tallyAcks } from '../../src/lib/ack.ts'
import { createEncryptedRoom } from '../../src/matrix/rooms.ts'
import { dumpDb, registerAgent, startTestClient, waitForEvent, waitForMessage, type TestAgent } from './helpers'

describe('SÉCURITÉ: accusé de lecture probant', () => {
  let a: TestAgent
  let b: TestAgent
  let c: TestAgent
  let alice: MatrixClient
  let bob: MatrixClient
  let carol: MatrixClient
  let roomId: string
  const body = `Instruction de service ${randomBytes(4).toString('hex')}: présence obligatoire lundi 8 h`
  let instructionId: string

  beforeAll(async () => {
    ;[a, b, c] = await Promise.all([registerAgent('chef'), registerAgent('moussa'), registerAgent('issa')])
    ;[alice, bob, carol] = await Promise.all([startTestClient(a), startTestClient(b), startTestClient(c)])
    roomId = await createEncryptedRoom(alice, { name: 'Direction', invite: [b.userId, c.userId] })
    await Promise.all([bob.joinRoom(roomId), carol.joinRoom(roomId)])
    instructionId = await sendInstruction(alice, roomId, body)
    await Promise.all([waitForMessage(bob, roomId, body), waitForMessage(carol, roomId, body)])
  })

  afterAll(() => {
    for (const cl of [alice, bob, carol]) cl?.stopClient()
  })

  const acksSeenByAlice = async (expected: number) => {
    const events = []
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      events.length = 0
      for (const e of alice.getRoom(roomId)?.getLiveTimeline().getEvents() ?? []) {
        await alice.decryptEventIfNeeded(e)
        if (e.getType() === ACK_TYPE) events.push(e)
      }
      if (events.length >= expected) return events
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(`accusés attendus: ${expected}, reçus: ${events.length}`)
  }

  it('ackIsEncryptedAttributedAndCountedOncePerAgent', async () => {
    await sendAck(bob, roomId, { eventId: instructionId, body })
    await sendAck(bob, roomId, { eventId: instructionId, body }) // même agent qui rouvre l'instruction: ne compte qu'une fois
    await sendAck(carol, roomId, { eventId: instructionId, body })

    const events = await acksSeenByAlice(3)
    const acks = events.map((e) => ({
      sender: e.getSender()!,
      deviceId: String(e.getWireContent().device_id),
      senderKey: e.getSenderKey() ?? undefined,
      content: e.getContent() as { instruction_event_id: string; content_sha256: string; read_at: number },
    }))
    const tally = tallyAcks(acks, { eventId: instructionId, sha256: await contentSha256(body) }, [b.userId, c.userId])

    expect(tally.read.map((r) => r.sender).sort()).toEqual([b.userId, c.userId].sort())
    expect(tally.pending).toEqual([])
    // L'identifiant d'appareil est seulement DÉCLARÉ par l'expéditeur; ce qui est authentifié par le chiffrement de groupe,
    // c'est la clé d'appareil: elle doit être celle de l'appareil réel de l'auteur.
    expect(tally.read.find((r) => r.sender === b.userId)?.deviceId).toBe(b.deviceId)
    expect(tally.read.find((r) => r.sender === c.userId)?.deviceId).toBe(c.deviceId)
    expect(tally.read.find((r) => r.sender === b.userId)?.deviceKey).toBe((await bob.getCrypto()!.getOwnDeviceKeys()).curve25519)
    expect(tally.read.find((r) => r.sender === c.userId)?.deviceKey).toBe((await carol.getCrypto()!.getOwnDeviceKeys()).curve25519)
    for (const e of events) expect(e.getClaimedEd25519Key(), 'clé d’appareil de l’expéditeur').toBeTruthy()
  })

  it('anAckWithAWrongHashDoesNotCount', async () => {
    const forgedFor = `autre instruction ${randomBytes(3).toString('hex')}`
    const other = await sendInstruction(alice, roomId, forgedFor)
    await waitForMessage(bob, roomId, forgedFor)
    await sendAck(bob, roomId, { eventId: other, body: 'texte que je n’ai pas lu' })
    const events = await acksSeenByAlice(4)
    const acks = events.map((e) => ({
      sender: e.getSender()!,
      deviceId: String(e.getWireContent().device_id),
      senderKey: e.getSenderKey() ?? undefined,
      content: e.getContent() as { instruction_event_id: string; content_sha256: string; read_at: number },
    }))
    expect(tallyAcks(acks, { eventId: other, sha256: await contentSha256(forgedFor) }, [b.userId, c.userId]).read).toEqual([])
  })

  it('serverNeverSeesTheInstructionNorItsAcknowledgements', async () => {
    await waitForEvent(alice, roomId, () => true, 5000, ACK_TYPE)
    const dump = dumpDb()
    expect(dump, 'la base exportée doit contenir ce salon').toContain(roomId)
    expect(dump).toContain('m.room.encrypted')
    expect(dump).not.toContain(ACK_TYPE)
    expect(dump).not.toContain(INSTRUCTION_KEY)
    expect(dump).not.toContain(body)
  })
})