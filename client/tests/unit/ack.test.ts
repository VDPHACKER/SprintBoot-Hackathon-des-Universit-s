import { describe, expect, it, vi } from 'vitest'
import { CLASSIFICATION_KEY } from '../../src/lib/classification.ts'
import {
  ACK_TYPE,
  INSTRUCTION_KEY,
  contentSha256,
  ackMarkerKey,
  isInstructionAuthority,
  sendAck,
  sendInstruction,
  tallyAcks,
} from '../../src/lib/ack.ts'
import { buildProof } from '../../src/lib/proof.ts'

const INSTRUCTION = { eventId: '$instr:chat.localhost', sha256: 'abc123' }
const BOB = '@moussa:chat.localhost'
const CAROL = '@issa:chat.localhost'
const ack = (sender: string, deviceId: string, over: Record<string, unknown> = {}) => ({
  sender,
  deviceId,
  content: { instruction_event_id: INSTRUCTION.eventId, content_sha256: INSTRUCTION.sha256, read_at: 1000, ...over },
})

describe('contentSha256', () => {
  it('matchesKnownVectorsAndHandlesUtf8', async () => {
    expect(await contentSha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await contentSha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await contentSha256('é')).not.toBe(await contentSha256('e'))
  })
})

describe('tallyAcks', () => {
  it('tallyCountsEachAgentOnce', () => {
    // Point de contrôle 3: deux appareils, ou une réouverture, ne comptent qu'une fois; on garde la première lecture.
    const t = tallyAcks([ack(BOB, 'PHONE', { read_at: 5000 }), ack(BOB, 'LAPTOP', { read_at: 2000 })], INSTRUCTION, [BOB, CAROL])
    expect(t.read).toEqual([{ sender: BOB, deviceId: 'LAPTOP', readAt: 2000 }])
    expect(t.pending).toEqual([CAROL])
  })

  it('tallyIgnoresHashMismatch', () => {
    const t = tallyAcks([ack(BOB, 'D', { content_sha256: 'autre' })], INSTRUCTION, [BOB])
    expect(t.read).toEqual([])
    expect(t.pending).toEqual([BOB])
  })

  it('tallyIgnoresAcksForAnotherInstruction', () => {
    const t = tallyAcks([ack(BOB, 'D', { instruction_event_id: '$autre:chat.localhost' })], INSTRUCTION, [BOB])
    expect(t.read).toEqual([])
  })

  it('tallyIgnoresNonMembers', () => {
    const t = tallyAcks([ack('@intrus:chat.localhost', 'D')], INSTRUCTION, [BOB])
    expect(t.read).toEqual([])
    expect(t.pending).toEqual([BOB])
  })

  it('tallyIgnoresMalformedReadAt', () => {
    for (const read_at of ['hier', Number.NaN, -1, 0, null]) {
      expect(tallyAcks([ack(BOB, 'D', { read_at })], INSTRUCTION, [BOB]).read, String(read_at)).toEqual([])
    }
  })

  it('pendingListsMembersWithoutAck', () => {
    const t = tallyAcks([ack(BOB, 'D')], INSTRUCTION, [BOB, CAROL])
    expect(t.read.map((r) => r.sender)).toEqual([BOB])
    expect(t.pending).toEqual([CAROL])
  })

  it('readIsSortedByFirstReadTime', () => {
    const t = tallyAcks([ack(CAROL, 'D2', { read_at: 9000 }), ack(BOB, 'D1', { read_at: 3000 })], INSTRUCTION, [BOB, CAROL])
    expect(t.read.map((r) => r.sender)).toEqual([BOB, CAROL])
  })
})

describe('buildProof', () => {
  it('proofReportContainsDeviceId', () => {
    const tally = tallyAcks([ack(BOB, 'LAPTOP', { read_at: 2000 })], INSTRUCTION, [BOB, CAROL])
    const report = buildProof({ ...INSTRUCTION, sentAt: 1500 }, tally, () => 99_000)
    expect(report).toMatchObject({
      version: 1,
      generatedAt: 99_000,
      instruction: { eventId: INSTRUCTION.eventId, sha256: INSTRUCTION.sha256, sentAt: 1500 },
      pending: [CAROL],
    })
    expect(report.read).toEqual([{ agent: BOB, deviceId: 'LAPTOP', readAt: 2000 }])
    expect(report.limits).toMatch(/horloge/i) // la limite connue est écrite dans le rapport lui-même
  })
})

describe('sendAck', () => {
  it('sendsAnEventOfTheAckTypeCarryingTheContentHash', async () => {
    const client = { sendEvent: vi.fn(async (_r: string, _t: string, _c: unknown) => ({ event_id: '$a' })) }
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T08:00:00Z'))
    await sendAck(client as never, '!r:chat.localhost', { eventId: INSTRUCTION.eventId, body: 'abc' })
    vi.useRealTimers()
    expect(client.sendEvent).toHaveBeenCalledWith('!r:chat.localhost', ACK_TYPE, {
      instruction_event_id: INSTRUCTION.eventId,
      content_sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      read_at: Date.parse('2026-11-01T08:00:00Z'),
    })
  })
})

describe('sendInstruction', () => {
  const fake = () => ({ sendMessage: vi.fn(async (_r: string, _c: unknown) => ({ event_id: '$i' })) })

  it('marksTheMessageAsAnInstruction', async () => {
    const c = fake()
    expect(await sendInstruction(c as never, '!r', 'Réunion à 10 h')).toBe('$i')
    expect(c.sendMessage.mock.calls[0][1]).toEqual({ msgtype: 'm.text', body: 'Réunion à 10 h', [INSTRUCTION_KEY]: true })
  })

  it('canCarryAClassification', async () => {
    const c = fake()
    await sendInstruction(c as never, '!r', 'x', 'restreinte')
    expect(c.sendMessage.mock.calls[0][1]).toMatchObject({ [INSTRUCTION_KEY]: true, [CLASSIFICATION_KEY]: { level: 'restreinte' } })
  })

  it('rejectsAnEmptyBody', async () => {
    const c = fake()
    await expect(sendInstruction(c as never, '!r', '  ')).rejects.toThrow('EMPTY_MESSAGE')
    expect(c.sendMessage).not.toHaveBeenCalled()
  })
})

describe('isInstructionAuthority', () => {
  it('requiresModeratorPowerInTheRoom', () => {
    expect(isInstructionAuthority(100)).toBe(true)
    expect(isInstructionAuthority(50)).toBe(true)
    expect(isInstructionAuthority(49)).toBe(false)
    expect(isInstructionAuthority(0)).toBe(false)
    expect(isInstructionAuthority(undefined)).toBe(false)
  })
})
describe('ackMarkerKey', () => {
  it('isPerUserSoASecondAgentOnTheSameBrowserStillAcknowledges', () => {
    const a = ackMarkerKey('@awa:chat.localhost', '$instr:chat.localhost')
    const b = ackMarkerKey('@moussa:chat.localhost', '$instr:chat.localhost')
    expect(a).not.toBe(b)
    expect(a.startsWith('bf.')).toBe(true) // sous le préfixe de l'application: effacé à la déconnexion
    expect(ackMarkerKey('@awa:chat.localhost', '$instr:chat.localhost')).toBe(a) // stable pour un même couple
  })
})