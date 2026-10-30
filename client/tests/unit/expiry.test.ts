import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLASSIFICATION_KEY } from '../../src/lib/classification.ts'
import { isExpired, scheduleExpiry, visibleEvents } from '../../src/lib/expiry.ts'

const DAY = 86_400_000
const ME = '@awa:chat.localhost'
const OTHER = '@moussa:chat.localhost'

interface Opts {
  sender?: string
  redacted?: boolean
  id?: string
}
const event = (content: Record<string, unknown>, o: Opts = {}) => ({
  getContent: () => content,
  getSender: () => o.sender ?? OTHER,
  getId: () => o.id ?? '$evt:chat.localhost',
  getRoomId: () => '!room:chat.localhost',
  isRedacted: () => o.redacted ?? false,
})
const expiring = (expiresAt: number | null, level = 'confidentiel') => ({
  msgtype: 'm.text',
  body: 'x',
  [CLASSIFICATION_KEY]: { level, expiresAt },
})
const fakeClient = () => ({ getUserId: () => ME, redactEvent: vi.fn(async (_r: string, _e: string) => ({ event_id: '$redaction' })) })

afterEach(() => vi.useRealTimers())

describe('isExpired', () => {
  it('neverExpiresWithoutADeadlineAndExpiresAtTheDeadline', () => {
    expect(isExpired({ level: 'confidentiel', noForward: true, expiresAt: null }, Date.now() + 10 * DAY)).toBe(false)
    expect(isExpired({ level: 'confidentiel', noForward: true, expiresAt: 1000 }, 999)).toBe(false)
    expect(isExpired({ level: 'confidentiel', noForward: true, expiresAt: 1000 }, 1000)).toBe(true)
    expect(isExpired({ level: 'confidentiel', noForward: true, expiresAt: 1000 }, 5000)).toBe(true)
  })
})

describe('visibleEvents', () => {
  it('hidesExpiredWithoutSenderRedaction', () => {
    const client = fakeClient()
    const now = 1_000_000
    const gone = event(expiring(now - 1), { id: '$gone' })
    const live = event(expiring(now + 1000), { id: '$live' })
    const plain = event({ msgtype: 'm.text', body: 'bonjour' }, { id: '$plain' })
    expect(visibleEvents([gone, live, plain] as never, now).map((e) => (e as never as { getId(): string }).getId())).toEqual(['$live', '$plain'])
    expect(client.redactEvent, 'masquer ne doit rien envoyer au serveur').not.toHaveBeenCalled()
  })

  it('hidesRedactedEvents', () => {
    const redacted = event({}, { redacted: true })
    const kept = event({ msgtype: 'm.text', body: 'ok' })
    expect(visibleEvents([redacted, kept] as never, 0)).toEqual([kept])
  })

  it('keepsAnEventWhoseContentIsNotDecryptedYet', () => {
    const pending = event({ algorithm: 'm.megolm.v1.aes-sha2', ciphertext: '...' })
    expect(visibleEvents([pending] as never, Date.now())).toHaveLength(1)
  })
})

describe('scheduleExpiry', () => {
  it('onlySenderRedacts', async () => {
    vi.useFakeTimers()
    const mine = fakeClient()
    scheduleExpiry(mine as never, event(expiring(Date.now() + 1000), { sender: ME, id: '$mine' }) as never)
    await vi.advanceTimersByTimeAsync(999)
    expect(mine.redactEvent).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(mine.redactEvent).toHaveBeenCalledOnce()
    expect(mine.redactEvent).toHaveBeenCalledWith('!room:chat.localhost', '$mine')

    const notMine = fakeClient()
    scheduleExpiry(notMine as never, event(expiring(Date.now() + 1000), { sender: OTHER }) as never)
    await vi.advanceTimersByTimeAsync(5000)
    expect(notMine.redactEvent).not.toHaveBeenCalled()
  })

  it('doesNothingWithoutADeadline', async () => {
    vi.useFakeTimers()
    const c = fakeClient()
    scheduleExpiry(c as never, event(expiring(null), { sender: ME }) as never)
    scheduleExpiry(c as never, event({ msgtype: 'm.text', body: 'x' }, { sender: ME }) as never)
    await vi.advanceTimersByTimeAsync(10 * DAY)
    expect(c.redactEvent).not.toHaveBeenCalled()
  })

  it('cancelStopsTheRedaction', async () => {
    vi.useFakeTimers()
    const c = fakeClient()
    const cancel = scheduleExpiry(c as never, event(expiring(Date.now() + 1000), { sender: ME }) as never)
    cancel()
    await vi.advanceTimersByTimeAsync(5000)
    expect(c.redactEvent).not.toHaveBeenCalled()
  })

  it('aDeadlineLongerThanSetTimeoutsLimitDoesNotFireImmediately', async () => {
    // setTimeout plafonne à 2^31-1 ms (~24,8 jours): au-delà, il se déclenche tout de suite.
    vi.useFakeTimers()
    const c = fakeClient()
    scheduleExpiry(c as never, event(expiring(Date.now() + 40 * DAY), { sender: ME }) as never)
    await vi.advanceTimersByTimeAsync(0)
    expect(c.redactEvent, 'ne doit pas partir tout de suite').not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(30 * DAY)
    expect(c.redactEvent, 'ni avant l’échéance').not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10 * DAY + 1000)
    expect(c.redactEvent).toHaveBeenCalledOnce()
  })

  it('anAlreadyPastDeadlineRedactsRightAwayAfterARestart', async () => {
    vi.useFakeTimers()
    const c = fakeClient()
    scheduleExpiry(c as never, event(expiring(Date.now() - 5 * DAY), { sender: ME }) as never)
    await vi.advanceTimersByTimeAsync(0)
    expect(c.redactEvent).toHaveBeenCalledOnce()
  })

  it('aFailedRedactionDoesNotCrash', async () => {
    vi.useFakeTimers()
    const c = { getUserId: () => ME, redactEvent: vi.fn(async () => { throw new Error('hors ligne') }) }
    scheduleExpiry(c as never, event(expiring(Date.now() + 10), { sender: ME }) as never)
    await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow()
  })
})