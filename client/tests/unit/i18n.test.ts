import { afterEach, describe, expect, it } from 'vitest'
import fr from '../../src/i18n/fr.json'
import mos from '../../src/i18n/mos.json'
import { getLocale, initLocale, persistLocale, setLocale, t } from '../../src/i18n/index.ts'
import { S } from '../../src/ui/strings.ts'

const fakeStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}
const keysOf = (catalog: Record<string, string>) => Object.keys(catalog).filter((k) => !k.startsWith('_'))

afterEach(() => setLocale('fr'))

describe('t', () => {
  it('fallsBackToFrenchWhenKeyMissing', () => {
    setLocale('mos')
    expect(keysOf(mos)).not.toContain('rooms') // pas encore traduit...
    expect(t('rooms')).toBe(fr.rooms) // ...donc affiché en français, jamais vide
  })

  it('returnsTheKeyItselfWhenUnknownEverywhereAndIgnoresInheritedProperties', () => {
    expect(t('cle.inexistante')).toBe('cle.inexistante')
    expect(t('constructor')).toBe('constructor')
    expect(t('__proto__')).toBe('__proto__')
  })

  it('usesTheCurrentLocale', () => {
    setLocale('mos')
    expect(t('login')).toBe(mos.login)
    setLocale('fr')
    expect(t('login')).toBe('Se connecter')
    expect(getLocale()).toBe('fr')
  })

  it('substitutesParametersAndLeavesUnknownPlaceholders', () => {
    expect(t('readBy', { read: '2', total: '5' })).toBe('Lu par 2 sur 5')
    expect(t('readBy', { read: '2' })).toBe('Lu par 2 sur {total}')
  })

  it('doesNotInterpretParametersAsMarkup', () => {
    expect(t('readBy', { read: '<img src=x onerror=alert(1)>', total: '5' })).toBe('Lu par <img src=x onerror=alert(1)> sur 5')
  })
})

describe('catalogs', () => {
  it('mooreHasNoUnknownKeys', () => {
    const frenchKeys = new Set(keysOf(fr))
    expect(keysOf(mos).filter((k) => !frenchKeys.has(k))).toEqual([])
  })

  it('mooreEntriesAreNotMereCopiesOfTheFrench', () => {
    for (const key of keysOf(mos)) expect(mos[key as keyof typeof mos], key).not.toBe(fr[key as keyof typeof fr])
  })

  it('mooreFileStatesItsSourceAndThatItIsPartial', () => {
    expect(mos._source).toMatch(/SIL/)
    expect(mos._source).toMatch(/partiel/i)
  })

  it('everyLabelOfTheUiHasAFrenchEntry', () => {
    // t() renvoie la clé quand elle n'existe nulle part: un libellé égal à sa propre clé trahit un oubli.
    for (const [name, value] of Object.entries(S)) {
      if (typeof value === 'string') expect(value, name).not.toBe(name)
    }
    for (const value of Object.values(S.levels)) expect(value).not.toMatch(/^levels\./)
    expect(S.errors.generic).not.toBe('errors.generic')
    expect(S.errors.CODE_INCONNU).toBeUndefined() // un code d'erreur inconnu retombe sur le message générique côté appelant
  })
})

describe('locale persistence', () => {
  it('initLocaleReadsAValidStoredChoiceAndIgnoresAnythingElse', () => {
    expect(initLocale(fakeStorage({ 'bf.locale': 'mos' }))).toBe('mos')
    expect(initLocale(fakeStorage({ 'bf.locale': 'klingon' }))).toBe('fr')
    expect(initLocale(fakeStorage())).toBe('fr')
  })

  it('persistLocaleWritesTheChoiceUnderTheAppPrefix', () => {
    const storage = fakeStorage()
    persistLocale('mos', storage)
    expect(storage.data.get('bf.locale')).toBe('mos')
    expect(getLocale()).toBe('mos')
  })
})