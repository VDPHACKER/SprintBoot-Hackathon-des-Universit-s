import fr from './fr.json'
import mos from './mos.json'

export type Locale = 'fr' | 'mos'
export const LOCALES: readonly Locale[] = ['fr', 'mos']

const CATALOGS: Record<Locale, Record<string, string>> = { fr, mos }
const STORAGE_KEY = 'bf.locale'
let current: Locale = 'fr'

/** Lecture sûre: uniquement les clés propres du catalogue (jamais `constructor`, `__proto__`...), et seulement du texte. */
const own = (catalog: Record<string, string>, key: string): string | undefined =>
  Object.hasOwn(catalog, key) && typeof catalog[key] === 'string' ? catalog[key] : undefined

export const getLocale = (): Locale => current
export const has = (key: string): boolean => own(fr, key) !== undefined

export function setLocale(locale: Locale): void {
  current = locale
}

/**
 * Libellé dans la langue courante. Une clé absente de cette langue s'affiche en français (jamais vide); une clé inconnue
 * partout est renvoyée telle quelle. Les `{paramètres}` sont remplacés par du texte brut: aucun HTML n'est interprété,
 * l'interface n'insère que du texte.
 */
export function t(key: string, params?: Record<string, string>): string {
  const raw = own(CATALOGS[current], key) ?? own(fr, key) ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (placeholder, name: string) => (Object.hasOwn(params, name) ? params[name] : placeholder))
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>

/** Langue enregistrée sur cet appareil (français par défaut). */
export function initLocale(storage: KeyValueStorage = window.localStorage): Locale {
  let stored: string | null = null
  try {
    stored = storage.getItem(STORAGE_KEY)
  } catch {
    /* stockage indisponible: on reste en français */
  }
  current = stored === 'mos' || stored === 'fr' ? stored : 'fr'
  return current
}

export function persistLocale(locale: Locale, storage: KeyValueStorage = window.localStorage): void {
  current = locale
  try {
    storage.setItem(STORAGE_KEY, locale)
  } catch {
    /* sans stockage, le choix ne dure que le temps de la page */
  }
}