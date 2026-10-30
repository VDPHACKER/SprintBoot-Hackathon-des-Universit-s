/** Libellés de l'interface: même interface qu'avant (`S.xxx`), lue dans la langue courante (voir i18n/). */
import type { Level } from '../lib/classification.ts'
import { has, t } from '../i18n/index.ts'

export const S = {
  get appTitle() {
    return t('appTitle')
  },
  get loginIntro() {
    return t('loginIntro')
  },
  get login() {
    return t('login')
  },
  get revoked() {
    return t('revoked')
  },
  get logout() {
    return t('logout')
  },
  get newRoom() {
    return t('newRoom')
  },
  get roomName() {
    return t('roomName')
  },
  get invitees() {
    return t('invitees')
  },
  get create() {
    return t('create')
  },
  get invitations() {
    return t('invitations')
  },
  get join() {
    return t('join')
  },
  get rooms() {
    return t('rooms')
  },
  get noRoom() {
    return t('noRoom')
  },
  get messageLabel() {
    return t('messageLabel')
  },
  get send() {
    return t('send')
  },
  get attach() {
    return t('attach')
  },
  get level() {
    return t('level')
  },
  get noForward() {
    return t('noForward')
  },
  get instruction() {
    return t('instruction')
  },
  get instructionLabel() {
    return t('instructionLabel')
  },
  get pendingLabel() {
    return t('pendingLabel')
  },
  get exportProof() {
    return t('exportProof')
  },
  get printProof() {
    return t('printProof')
  },
  get proofTitle() {
    return t('proofTitle')
  },
  get proofInstruction() {
    return t('proofInstruction')
  },
  get proofAgent() {
    return t('proofAgent')
  },
  get proofDevice() {
    return t('proofDevice')
  },
  get proofReadAt() {
    return t('proofReadAt')
  },
  get proofPending() {
    return t('proofPending')
  },
  get forwardTo() {
    return t('forwardTo')
  },
  get forwarded() {
    return t('forwarded')
  },
  get download() {
    return t('download')
  },
  get encrypted() {
    return t('encrypted')
  },
  get notEncrypted() {
    return t('notEncrypted')
  },
  get decrypting() {
    return t('decrypting')
  },
  get undecryptable() {
    return t('undecryptable')
  },
  get starting() {
    return t('starting')
  },
  get language() {
    return t('language')
  },
  get voiceRecord() {
    return t('voiceRecord')
  },
  get voiceStop() {
    return t('voiceStop')
  },
  get voiceRecording() {
    return t('voiceRecording')
  },
  get voicePlay() {
    return t('voicePlay')
  },
  get voiceMessage() {
    return t('voiceMessage')
  },
  readBy: (read: number, total: number) => t('readBy', { read: String(read), total: String(total) }),
  expiresAt: (when: string) => t('expiresAt', { when }),
  expiresIn: (hours: number) => t('expiresIn', { hours: String(hours) }),
  get levels(): Record<Level, string> {
    return { normal: t('levels.normal'), restreinte: t('levels.restreinte'), confidentiel: t('levels.confidentiel') }
  },
  /** Message d'erreur pour un code; `undefined` si le code est inconnu (l'appelant retombe sur `errors.generic`). */
  errors: new Proxy({} as Record<string, string>, {
    get: (_target, code) => (typeof code === 'string' && has(`errors.${code}`) ? t(`errors.${code}`) : undefined),
  }),
}