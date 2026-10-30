import { describe, expect, it, vi } from 'vitest'
import { shouldBlur, watchVisibility } from '../../src/ui/privacyShield.ts'

describe('shouldBlur', () => {
  it('blursConfidentialWhenUnfocused', () => {
    expect(shouldBlur('confidentiel', { windowFocused: false, tabVisible: true })).toBe(true)
    expect(shouldBlur('confidentiel', { windowFocused: true, tabVisible: false })).toBe(true)
    expect(shouldBlur('confidentiel', { windowFocused: false, tabVisible: false })).toBe(true)
  })

  it('showsConfidentialOnlyWhileTheWindowIsFocusedAndVisible', () => {
    expect(shouldBlur('confidentiel', { windowFocused: true, tabVisible: true })).toBe(false)
  })

  it('neverBlursNormal', () => {
    expect(shouldBlur('normal', { windowFocused: false, tabVisible: false })).toBe(false)
  })

  it('doesNotBlurRestrictedMessages', () => {
    // Choix du plan: seul le niveau confidentiel est flouté (la spec ne le demande que pour lui).
    expect(shouldBlur('restreinte', { windowFocused: false, tabVisible: false })).toBe(false)
  })
})

describe('watchVisibility', () => {
  const setup = (focused = true, visibility: 'visible' | 'hidden' = 'visible') => {
    const win = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: visibility, hasFocus: () => focused })
    return { win, doc }
  }

  it('reportsTheInitialStateThenEveryChange', () => {
    const { win, doc } = setup(true, 'visible')
    const seen: Array<{ windowFocused: boolean; tabVisible: boolean }> = []
    watchVisibility((s) => seen.push(s), win as never, doc as never)
    expect(seen).toEqual([{ windowFocused: true, tabVisible: true }])

    win.dispatchEvent(new Event('blur'))
    expect(seen.at(-1)).toEqual({ windowFocused: false, tabVisible: true })
    win.dispatchEvent(new Event('focus'))
    expect(seen.at(-1)).toEqual({ windowFocused: true, tabVisible: true })
    ;(doc as { visibilityState: string }).visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(seen.at(-1)).toEqual({ windowFocused: true, tabVisible: false })
  })

  it('startsBlurredWhenTheWindowOpensUnfocused', () => {
    const { win, doc } = setup(false, 'visible')
    const onChange = vi.fn()
    watchVisibility(onChange, win as never, doc as never)
    expect(onChange).toHaveBeenCalledWith({ windowFocused: false, tabVisible: true })
  })

  it('stopsReportingAfterUnsubscribe', () => {
    const { win, doc } = setup()
    const onChange = vi.fn()
    const stop = watchVisibility(onChange, win as never, doc as never)
    stop()
    onChange.mockClear()
    win.dispatchEvent(new Event('blur'))
    expect(onChange).not.toHaveBeenCalled()
  })
})