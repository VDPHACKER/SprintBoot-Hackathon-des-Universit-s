import { describe, expect, it } from 'vitest'
import { ACK_TYPE, INSTRUCTION_KEY, contentSha256 } from '../../src/lib/ack.ts'
import { CLASSIFICATION_KEY } from '../../src/lib/classification.ts'
import { buildRoomArchive, verifyRoomArchive, type ArchivableEvent } from '../../src/lib/archive.ts'

const NOW = Date.parse('2026-11-03T12:00:00Z')
const members = [
  { userId: '@chef:chat.localhost', name: 'Issa (chef)' },
  { userId: '@awa:chat.localhost', name: 'Awa' },
  { userId: '@moussa:chat.localhost', name: 'Moussa' },
]

let n = 0
const msg = (sender: string, ts: number, content: Record<string, unknown>, status: ArchivableEvent['status'] = 'ok'): ArchivableEvent =>
  ({ eventId: `$e${++n}`, sender, ts, type: 'm.room.message', status, content })

async function build(events: ArchivableEvent[], authority: string[] = ['@chef:chat.localhost']) {
  return buildRoomArchive({
    roomId: '!room:chat.localhost', roomName: 'Cabinet', members, archivedBy: '@awa:chat.localhost', events,
    isInstructionAuthority: (u) => authority.includes(u), now: NOW,
  })
}

describe('buildRoomArchive', () => {
  it('keepsOrdinaryMessagesInOrderWithTheirHash', async () => {
    const a = await build([
      msg('@awa:chat.localhost', NOW - 1000, { msgtype: 'm.text', body: 'deuxième' }),
      msg('@chef:chat.localhost', NOW - 5000, { msgtype: 'm.text', body: 'premier' }),
    ])
    expect(a.entries.map((e) => e.body)).toEqual(['premier', 'deuxième'])
    expect(a.entries[0]).toMatchObject({ kind: 'text', level: 'normal', sender: '@chef:chat.localhost', sentAt: new Date(NOW - 5000).toISOString() })
    expect(a.entries[0]?.sha256).toBe(await contentSha256('premier'))
    expect(a.archivedBy).toBe('@awa:chat.localhost')
  })

  it('neverArchivesConfidentialExpiredDeletedOrUnreadableMessages', async () => {
    const a = await build([
      msg('@awa:chat.localhost', NOW - 9000, { msgtype: 'm.text', body: 'secret', [CLASSIFICATION_KEY]: { level: 'confidentiel', expiresAt: NOW + 3600_000 } }),
      msg('@awa:chat.localhost', NOW - 8000, { msgtype: 'm.text', body: 'périmé', [CLASSIFICATION_KEY]: { level: 'restreinte', expiresAt: NOW - 1 } }),
      msg('@awa:chat.localhost', NOW - 7000, { msgtype: 'm.text', body: 'supprimé' }, 'redacted'),
      msg('@awa:chat.localhost', NOW - 6000, { msgtype: 'm.text', body: 'illisible' }, 'undecryptable'),
      msg('@awa:chat.localhost', NOW - 5000, { msgtype: 'm.text', body: 'ok', [CLASSIFICATION_KEY]: { level: 'restreinte', expiresAt: null } }),
    ])
    expect(a.entries.map((e) => [e.body, e.level])).toEqual([['ok', 'restreinte']])
    expect(a.excluded).toEqual({ confidentiel: 1, expire: 1, supprime: 1, illisible: 1 })
    expect(JSON.stringify(a)).not.toContain('secret')
  })

  it('treatsAMalformedClassificationAsConfidentialAndSoExcludesIt', async () => {
    const a = await build([msg('@awa:chat.localhost', NOW - 1000, { msgtype: 'm.text', body: 'x', [CLASSIFICATION_KEY]: 'bizarre' })])
    expect(a.entries).toEqual([])
    expect(a.excluded.confidentiel).toBe(1)
  })

  it('listsFilesAndVoiceMessagesByNameWithoutTheirContent', async () => {
    const a = await build([
      msg('@awa:chat.localhost', NOW - 3000, { msgtype: 'm.file', body: 'note.pdf', filename: 'note.pdf', info: { size: 1234, mimetype: 'application/pdf' }, file: { url: 'mxc://x/y', key: { k: 'SECRET-KEY' } } }),
      msg('@awa:chat.localhost', NOW - 2000, { msgtype: 'm.audio', body: 'vocal.webm', file: { url: 'mxc://x/z', key: { k: 'SECRET-KEY' } } }),
    ])
    expect(a.entries[0]).toMatchObject({ kind: 'file', body: 'note.pdf', file: { name: 'note.pdf', size: 1234, mimetype: 'application/pdf', contentIncluded: false } })
    expect(a.entries[1]).toMatchObject({ kind: 'voice', body: 'vocal.webm' })
    expect(JSON.stringify(a)).not.toMatch(/SECRET-KEY|mxc:/)
  })

  it('recordsWhoReadAnInstructionAndWhoDidNot', async () => {
    const instruction = msg('@chef:chat.localhost', NOW - 8000, { msgtype: 'm.text', body: 'Réunion à 15 h', [INSTRUCTION_KEY]: true })
    const sha = await contentSha256('Réunion à 15 h')
    const ack: ArchivableEvent = {
      eventId: '$ack1', sender: '@awa:chat.localhost', ts: NOW - 4000, type: ACK_TYPE, status: 'ok', deviceId: 'DEV1', senderKey: 'KEY1',
      content: { instruction_event_id: instruction.eventId, content_sha256: sha, read_at: NOW - 4000 },
    }
    const a = await build([instruction, ack])
    expect(a.entries).toHaveLength(1)
    expect(a.entries[0]).toMatchObject({
      kind: 'instruction',
      readBy: [{ agent: '@awa:chat.localhost', readAt: new Date(NOW - 4000).toISOString(), deviceId: 'DEV1' }],
      pending: ['@moussa:chat.localhost'],
    })
  })

  it('anInstructionFlagFromANonModeratorIsJustAMessage', async () => {
    const a = await build([msg('@awa:chat.localhost', NOW - 1000, { msgtype: 'm.text', body: 'faux ordre', [INSTRUCTION_KEY]: true })])
    expect(a.entries[0]?.kind).toBe('text')
    expect(a.entries[0]?.readBy).toBeUndefined()
  })

  it('ignoresAnAckWithTheWrongHash', async () => {
    const instruction = msg('@chef:chat.localhost', NOW - 8000, { msgtype: 'm.text', body: 'Ordre', [INSTRUCTION_KEY]: true })
    const ack: ArchivableEvent = {
      eventId: '$ack2', sender: '@awa:chat.localhost', ts: NOW - 4000, type: ACK_TYPE, status: 'ok',
      content: { instruction_event_id: instruction.eventId, content_sha256: 'pas-la-bonne', read_at: NOW - 4000 },
    }
    const a = await build([instruction, ack])
    expect(a.entries[0]?.readBy).toEqual([])
    expect(a.entries[0]?.pending).toEqual(['@awa:chat.localhost', '@moussa:chat.localhost'])
  })

  it('statesItsLimitsAndWhatItIsNot', async () => {
    const a = await build([])
    expect(a.limits).toMatch(/ne prouve ni son auteur ni la date/)
    expect(a.limits).toMatch(/Confidentiel/)
    expect(a.format).toBe('diyoy-archive-echanges/1')
  })
})

describe('verifyRoomArchive', () => {
  it('acceptsAnUntouchedArchiveEvenAfterAJsonRoundTrip', async () => {
    const a = await build([msg('@awa:chat.localhost', NOW - 1000, { msgtype: 'm.text', body: 'bonjour é ü 🙂' })])
    expect(await verifyRoomArchive(JSON.parse(JSON.stringify(a, null, 2)))).toBe('intact')
  })

  it('detectsAnyEditedMessageSenderOrDate', async () => {
    const a = await build([msg('@awa:chat.localhost', NOW - 1000, { msgtype: 'm.text', body: 'virement de 100' })])
    const edited = JSON.parse(JSON.stringify(a))
    edited.entries[0].body = 'virement de 900'
    expect(await verifyRoomArchive(edited)).toBe('modified')
    const other = JSON.parse(JSON.stringify(a))
    other.entries[0].sender = '@moussa:chat.localhost'
    expect(await verifyRoomArchive(other)).toBe('modified')
    const dated = JSON.parse(JSON.stringify(a))
    dated.generatedAt = '2020-01-01T00:00:00.000Z'
    expect(await verifyRoomArchive(dated)).toBe('modified')
  })

  it('detectsADeletedMessageOrAnEditedExclusionCount', async () => {
    const a = await build([msg('@awa:chat.localhost', NOW - 2000, { msgtype: 'm.text', body: 'a' }), msg('@awa:chat.localhost', NOW - 1000, { msgtype: 'm.text', body: 'b' })])
    const cut = JSON.parse(JSON.stringify(a))
    cut.entries.pop()
    expect(await verifyRoomArchive(cut)).toBe('modified')
    const hidden = JSON.parse(JSON.stringify(a))
    hidden.excluded.confidentiel = 0
    hidden.excluded.expire = 5
    expect(await verifyRoomArchive(hidden)).toBe('modified')
  })

  it('rejectsWhatIsNotAnArchive', async () => {
    expect(await verifyRoomArchive(null)).toBe('invalid')
    expect(await verifyRoomArchive([])).toBe('invalid')
    expect(await verifyRoomArchive({ format: 'autre', digest: 'x' })).toBe('invalid')
    expect(await verifyRoomArchive({ format: 'diyoy-archive-echanges/1' })).toBe('invalid')
  })
})
