import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLASSIFICATION_KEY,
  forwardMessage,
  policyFor,
  readClassification,
  sendClassified,
} from '../../src/lib/classification.ts'

const DAY = 86_400_000
const fakeClient = () => ({ sendMessage: vi.fn(async (_roomId: string, _content: unknown) => ({ event_id: '$e:chat.localhost' })) })
const eventWith = (content: Record<string, unknown>) => ({ getContent: () => content })

afterEach(() => vi.useRealTimers())

describe('policyFor', () => {
  it('policyMatchesTable', () => {
    expect(policyFor('normal')).toEqual({ noForward: false, defaultTtlMs: null })
    expect(policyFor('restreinte')).toEqual({ noForward: true, defaultTtlMs: null })
    expect(policyFor('confidentiel')).toEqual({ noForward: true, defaultTtlMs: DAY })
  })
})

describe('readClassification', () => {
  it('contentWithoutTheKeyIsNormal', () => {
    expect(readClassification({ msgtype: 'm.text', body: 'bonjour' })).toEqual({ level: 'normal', noForward: false, expiresAt: null })
  })

  it('readsAKnownLevelAndItsExpiry', () => {
    expect(readClassification({ [CLASSIFICATION_KEY]: { level: 'restreinte', expiresAt: 1234 } })).toEqual({
      level: 'restreinte',
      noForward: true,
      expiresAt: 1234,
    })
  })

  it('unknownLevelIsTreatedAsConfidential', () => {
    for (const raw of [{ level: 'secret-defense' }, {}, { level: 42 }, null, 'confidentiel', 7, []]) {
      const c = readClassification({ [CLASSIFICATION_KEY]: raw })
      expect(c.level, JSON.stringify(raw)).toBe('confidentiel')
      expect(c.noForward, JSON.stringify(raw)).toBe(true)
    }
  })

  it('ignoresANoForwardFlagForgedBySenderAndRecomputesFromTheLevel', () => {
    const c = readClassification({ [CLASSIFICATION_KEY]: { level: 'confidentiel', noForward: false } })
    expect(c.noForward).toBe(true)
  })

  it('ignoresNonsenseExpiry', () => {
    for (const expiresAt of ['demain', -5, 0, Number.NaN, Infinity, null]) {
      expect(readClassification({ [CLASSIFICATION_KEY]: { level: 'restreinte', expiresAt } }).expiresAt, String(expiresAt)).toBeNull()
    }
  })
})

describe('sendClassified', () => {
  it('confidentialMessageGetsTheDefaultOneDayExpiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    const c = fakeClient()
    const id = await sendClassified(c as never, '!r:chat.localhost', 'état des effectifs', 'confidentiel')
    expect(id).toBe('$e:chat.localhost')
    expect(c.sendMessage).toHaveBeenCalledWith('!r:chat.localhost', {
      msgtype: 'm.text',
      body: 'état des effectifs',
      [CLASSIFICATION_KEY]: { level: 'confidentiel', expiresAt: Date.now() + DAY },
    })
  })

  it('restrictedMessageHasNoExpiryByDefaultButAnExplicitOneWins', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    const c = fakeClient()
    await sendClassified(c as never, '!r', 'a', 'restreinte')
    await sendClassified(c as never, '!r', 'b', 'restreinte', 5000)
    expect(c.sendMessage.mock.calls[0][1]).toMatchObject({ [CLASSIFICATION_KEY]: { level: 'restreinte', expiresAt: null } })
    expect(c.sendMessage.mock.calls[1][1]).toMatchObject({ [CLASSIFICATION_KEY]: { level: 'restreinte', expiresAt: Date.now() + 5000 } })
  })

  it('plainNormalMessageCarriesNoClassificationKeyAtAll', async () => {
    const c = fakeClient()
    await sendClassified(c as never, '!r', 'bonjour', 'normal')
    expect(c.sendMessage.mock.calls[0][1]).toEqual({ msgtype: 'm.text', body: 'bonjour' })
  })

  it('rejectsEmptyBodyAndInvalidExpiryWithoutSending', async () => {
    const c = fakeClient()
    await expect(sendClassified(c as never, '!r', '  ', 'confidentiel')).rejects.toThrow('EMPTY_MESSAGE')
    for (const ttl of [0, -1, Number.NaN, Infinity]) {
      await expect(sendClassified(c as never, '!r', 'x', 'confidentiel', ttl), String(ttl)).rejects.toThrow('INVALID_TTL')
    }
    expect(c.sendMessage).not.toHaveBeenCalled()
  })
})

describe('forwardMessage', () => {
  it('forwardIsForbiddenForRestricted', async () => {
    const c = fakeClient()
    for (const level of ['restreinte', 'confidentiel', 'secret-defense']) {
      const src = eventWith({ msgtype: 'm.text', body: 'x', [CLASSIFICATION_KEY]: { level } })
      await expect(forwardMessage(c as never, src as never, '!autre:chat.localhost'), level).rejects.toThrow('FORWARD_FORBIDDEN')
    }
    expect(c.sendMessage).not.toHaveBeenCalled()
  })

  it('aMessageNotYetDecryptedIsNeverForwarded', async () => {
    const c = fakeClient()
    await expect(forwardMessage(c as never, eventWith({}) as never, '!autre:chat.localhost')).rejects.toThrow('NOT_A_MESSAGE')
    expect(c.sendMessage).not.toHaveBeenCalled()
  })

  it('normalMessageIsForwardedWithoutItsReplyRelation', async () => {
    const c = fakeClient()
    const src = eventWith({ msgtype: 'm.text', body: 'bonjour', 'm.relates_to': { 'm.in_reply_to': { event_id: '$old' } } })
    const id = await forwardMessage(c as never, src as never, '!autre:chat.localhost')
    expect(id).toBe('$e:chat.localhost')
    expect(c.sendMessage).toHaveBeenCalledWith('!autre:chat.localhost', { msgtype: 'm.text', body: 'bonjour' })
  })
})