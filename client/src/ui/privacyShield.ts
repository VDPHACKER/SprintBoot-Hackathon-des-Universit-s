import type { Level } from '../lib/classification.ts'

export interface Visibility {
  windowFocused: boolean
  tabVisible: boolean
}

/**
 * Un message confidentiel n'est lisible que fenêtre active ET onglet visible. Ce n'est PAS un blocage des captures
 * d'écran (impossible sur le web): c'est un flou dès que la fenêtre perd le focus, pour limiter la lecture par-dessus
 * l'épaule, la capture automatique d'un aperçu ou le partage d'écran d'une autre fenêtre.
 * Choix: seul le niveau confidentiel est flouté.
 */
export const shouldBlur = (level: Level, state: Visibility): boolean =>
  level === 'confidentiel' && !(state.windowFocused && state.tabVisible)

/** Signale l'état courant puis chaque changement de focus ou de visibilité. Renvoie la fonction qui arrête la surveillance. */
export function watchVisibility(
  onChange: (state: Visibility) => void,
  win: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState' | 'hasFocus'> = document,
): () => void {
  let focused = doc.hasFocus()
  const report = () => onChange({ windowFocused: focused, tabVisible: doc.visibilityState === 'visible' })
  const onFocus = () => {
    focused = true
    report()
  }
  const onBlur = () => {
    focused = false
    report()
  }
  win.addEventListener('focus', onFocus)
  win.addEventListener('blur', onBlur)
  doc.addEventListener('visibilitychange', report)
  report()
  return () => {
    win.removeEventListener('focus', onFocus)
    win.removeEventListener('blur', onBlur)
    doc.removeEventListener('visibilitychange', report)
  }
}