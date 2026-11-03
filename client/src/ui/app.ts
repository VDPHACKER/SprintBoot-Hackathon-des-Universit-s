import { ClientEvent, MatrixEventEvent, Method, RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { ACK_TYPE, INSTRUCTION_KEY, ackMarkerKey, contentSha256, isInstructionAuthority, sendAck, sendInstruction, tallyAcks } from '../lib/ack.ts'
import { LEVELS, forwardMessage, policyFor, readClassification, sendClassified, type Level } from '../lib/classification.ts'
import { scheduleExpiry, visibleEvents } from '../lib/expiry.ts'
import { buildProof, type ProofReport } from '../lib/proof.ts'
import { LOCALES, getLocale, persistLocale, t, type Locale } from '../i18n/index.ts'
import { sendVoice, startRecording } from '../lib/voice.ts'
import { downloadFile, sendFile } from '../matrix/files.ts'
import { buildRoomArchive, verifyRoomArchive, type ArchivableEvent, type ArchiveCheck } from '../lib/archive.ts'
import { createEncryptedRoom, sendText, toMxid } from '../matrix/rooms.ts'
import { identityLogoutUrl } from '../matrix/config.ts'
import { logout, ssoLoginUrl, startSession } from '../matrix/session.ts'
import { shouldBlur, watchVisibility, type Visibility } from './privacyShield.ts'
import { S } from './strings.ts'

/** Crée un élément; tout texte passe par textContent, jamais par innerHTML (pas d'injection possible). */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'function') el.addEventListener(key, value)
    else if (typeof value === 'boolean') (el as unknown as Record<string, unknown>)[key] = value
    else el.setAttribute(key, value)
  }
  el.append(...children)
  return el
}

const formatDate = (ms: number) => new Intl.DateTimeFormat('fr', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms))
/** Délai maximal accepté par setTimeout (~24,8 jours). */
const MAX_TIMEOUT_MS = 2 ** 31 - 1
/** Initiales affichées dans les pastilles (deux lettres au plus). */
const initials = (name: string) => (name.replace(/^[@#]/, '').split(/[\s.:_-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?')
/** Teintes douces des pastilles (palette du design): une couleur stable par nom. */
const TINTS: ReadonlyArray<[string, string]> = [['#D3E5FD', '#0B2A63'], ['#FEE9C4', '#6B4A00'], ['#DAF8DD', '#14532D'], ['#FECFD1', '#7F1D1D'], ['#E4DDFB', '#3B2A7A'], ['#D8F1F6', '#0E4B5A']]
const tintFor = (name: string): [string, string] => {
  let sum = 0
  for (const ch of name) sum = (sum * 31 + ch.charCodeAt(0)) >>> 0
  return TINTS[sum % TINTS.length]!
}
/** Pastille à initiales colorée; les couleurs passent par le CSSOM (la CSP interdit les attributs `style`). */
function avatar(name: string, small = false): HTMLElement {
  const el = h('span', { class: small ? 'avatar sm' : 'avatar', 'aria-hidden': 'true' }, initials(name))
  const [bg, fg] = tintFor(name)
  el.style.setProperty('background', bg)
  el.style.setProperty('color', fg)
  return el
}
/** Logo DÎYOY: bulle de discussion fermée par une serrure, sur fond vert. Construit nœud par nœud, sans innerHTML. */
function logo(size = 40): SVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const mk = (tag: string, attrs: Record<string, string>) => {
    const node = document.createElementNS(ns, tag)
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
    return node
  }
  const svg = mk('svg', { viewBox: '0 0 64 64', width: String(size), height: String(size), role: 'img', 'aria-label': 'DÎYOY' }) as SVGElement
  svg.append(
    mk('path', { d: 'M32 3l24 8v19c0 14-10 24-24 30C18 54 8 44 8 30V11z', fill: '#0B2A63', stroke: '#F2B705', 'stroke-width': '3', 'stroke-linejoin': 'round' }),
    mk('path', { d: 'M19 17h26a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H33l-8 7v-7h-6a5 5 0 0 1-5-5V22a5 5 0 0 1 5-5z', fill: '#FFFFFF' }),
    mk('rect', { x: '27', y: '27', width: '10', height: '8', rx: '1.5', fill: '#F2B705' }),
    mk('path', { d: 'M29 27v-2.5a3 3 0 0 1 6 0V27', fill: 'none', stroke: '#F2B705', 'stroke-width': '2' }),
  )
  return svg
}
/** Petites icônes de navigation (trait, couleur du texte). Construites nœud par nœud, sans innerHTML. */
const ICON_PATHS: Record<string, string> = {
  messages: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z',
  groups: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.300 2.700-5.500 6-5.500s6 2.200 6 5.500M17 11a2.500 2.500 0 1 0 0-5M17.500 14.600c2.200.4 3.500 2.300 3.500 5.400',
  security: 'M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6zM9 12l2 2 4-4',
  shield: 'M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z',
  directory: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM8 4v13M11 8h5',
  channels: 'M4 10v4l12 5V5zM16 8.500a4 4 0 0 1 0 7M7 15l1 5h3',
  documents: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M8 15v4',
}
function icon(name: keyof typeof ICON_PATHS, size = 20): SVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg') as SVGElement
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: String(size), height: String(size), fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v)
  const path = document.createElementNS(ns, 'path')
  path.setAttribute('d', ICON_PATHS[name]!)
  svg.append(path)
  return svg
}
const formatSize = (n: number) => (n < 1024 ? `${n} o` : n < 1048576 ? `${(n / 1024).toFixed(1)} Ko` : `${(n / 1048576).toFixed(1)} Mo`)

/** Propose le fichier déchiffré au téléchargement sous son nom d'origine. */
function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const errorText = (e: unknown) => S.errors[e instanceof Error ? e.message : ''] ?? S.errors.generic

const LANGUAGE_NAMES: Record<Locale, string> = { fr: 'Français', mos: 'Mooré (partiel)' }

/** Choix de la langue. Le changement recharge la page: tous les libellés sont reconstruits dans la nouvelle langue. */
function languageSelect(): HTMLElement {
  const select = h('select', { 'aria-label': S.language, change: () => { persistLocale(select.value as Locale); window.location.reload() } },
    ...LOCALES.map((l) => {
      const option = h('option', { value: l }, LANGUAGE_NAMES[l])
      option.selected = l === getLocale()
      return option
    }))
  return select
}

function renderLogin(root: HTMLElement): void {
  root.replaceChildren(
    h('main', { class: 'login' },
      h('section', { class: 'login-hero' },
        h('div', { class: 'hero-brand' }, logo(44), h('span', {}, S.appTitle)),
        h('h2', {}, t('login.heroTitle')),
        h('p', {}, S.tagline)),
      h('section', { class: 'login-card' },
        logo(64),
        h('h1', {}, S.appTitle),
        h('p', { class: 'subtitle' }, t('login.mark')),
        ...(new URL(window.location.href).searchParams.has('revoked') ? [h('p', { class: 'error', role: 'alert' }, S.revoked)] : []),
        h('p', { class: 'intro' }, S.loginIntro),
        h('a', { class: 'button', href: ssoLoginUrl() }, `${S.login} →`),
        languageSelect(),
        h('p', { class: 'restricted' }, t('login.restricted'))),
    ),
  )
}

export async function mountApp(root: HTMLElement): Promise<void> {
  root.replaceChildren(h('p', { class: 'status', role: 'status' }, S.starting))
  let client: MatrixClient
  try {
    client = await startSession()
  } catch (e) {
    if (e instanceof Error && e.message === 'NOT_LOGGED_IN') return renderLogin(root)
    console.error(e)
    root.replaceChildren(h('p', { class: 'status', role: 'alert' }, S.errors.generic), h('a', { class: 'button', href: '/' }, S.login))
    return
  }
  renderMain(root, client)
}

function renderMain(root: HTMLElement, client: MatrixClient): void {
  let selected: string | undefined
  let scheduled = false
  const refresh = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      draw()
    })
  }
  client.on(ClientEvent.Sync, refresh)
  client.on(RoomEvent.Timeline, refresh)
  client.on(RoomEvent.MyMembership, refresh)
  client.on(MatrixEventEvent.Decrypted, refresh)

  // Flou des messages confidentiels dès que la fenêtre perd le focus ou que l'onglet passe en arrière-plan.
  let shield: Visibility = { windowFocused: true, tabVisible: true }
  watchVisibility((state) => {
    shield = state
    refresh()
  })
  // Messages dont la suppression est déjà planifiée (seul l'expéditeur supprime; les autres clients masquent).
  const redactionScheduled = new Set<string>()
  const hashes = new Map<string, string>() // empreinte du texte de chaque instruction
  const acked = new Set<string>() // instructions déjà accusées dans cette session
  const objectUrls: string[] = [] // adresses temporaires des messages vocaux écoutés
  window.addEventListener('pagehide', () => objectUrls.forEach((url) => URL.revokeObjectURL(url)))
  const proofPrint = h('section', { id: 'proof-print' })
  document.body.append(proofPrint)
  let expiryTimer: ReturnType<typeof setTimeout> | undefined
  // Éléments persistants: les champs de saisie ne sont JAMAIS reconstruits, sinon un message en cours de frappe
  // disparaîtrait à chaque événement de synchronisation.
  type View = 'messages' | 'groups' | 'directory' | 'channels' | 'documents' | 'security' | 'settings'
  let viewUpdate: (() => void) | undefined // mise à jour de la vue ouverte (sans reconstruire ses champs de saisie)
  let view: View = 'messages'
  let tab: 'recent' | 'groups' = 'recent'
  let query = ''
  const meName = (client.getUserId() ?? '').replace(/^@/, '').split(':')[0] ?? ''
  const lists = h('div', { class: 'room-lists' })
  const newRoomForm = drawNewRoomForm()
  const search = h('input', { type: 'search', placeholder: t('search'), 'aria-label': t('search'), input: () => { query = search.value.trim().toLowerCase(); listsSignature = ''; refresh() } })
  const tabButtons = (['recent', 'groups'] as const).map((k) => h('button', { type: 'button', role: 'tab', class: 'tab', 'data-tab': k, click: () => { tab = k; listsSignature = ''; refresh() } }, k === 'recent' ? t('tab.recent') : t('tab.groups')))
  const navButtons = (['messages', 'groups', 'directory', 'channels', 'documents', 'security', 'settings'] as const).map((v) =>
    h('button', { type: 'button', class: 'nav-item', 'data-view': v, click: () => setView(v) }, icon(v), h('span', {}, t(`nav.${v}`))))
  const nav = h('nav', { class: 'nav', 'aria-label': t('nav.label') },
    h('div', { class: 'brand' }, logo(40), h('span', { class: 'brand-name' }, S.appTitle)),
    h('div', { class: 'nav-items' }, ...navButtons),
    h('div', { class: 'me' },
      avatar(meName),
      h('span', { class: 'who', title: client.getUserId() ?? '' },
        h('strong', { class: 'identity' }, meName),
        h('span', { class: 'presence' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), t('online'))),
      languageSelect(),
      h('button', { type: 'button', class: 'ghost', click: () => void logout(client).then(() => location.assign(identityLogoutUrl())) }, S.logout)),
  )
  const listCol = h('section', { class: 'listcol', 'aria-label': S.rooms },
    h('div', { class: 'searchbox' }, search),
    h('div', { class: 'tabs', role: 'tablist' }, ...tabButtons),
    newRoomForm,
    lists,
  )

  // Panneau d'information du salon (colonne de droite). Le formulaire d'invitation est persistant: il n'est jamais reconstruit.
  const infoHead = h('div', { class: 'info-head' })
  const infoMembers = h('ul', { class: 'info-members' })
  const inviteError = h('p', { class: 'error', role: 'alert' })
  const inviteInput = h('input', { id: 'invite-user', placeholder: t('info.addPlaceholder') })
  const inviteForm = h('form', { class: 'invite', submit: (e) => {
    e.preventDefault()
    const roomId = selected
    if (!roomId) return
    let mxid: string
    try { mxid = toMxid(inviteInput.value) } catch (err) { inviteError.textContent = errorText(err); return }
    client.invite(roomId, mxid)
      .then(() => { inviteInput.value = ''; inviteError.textContent = '' })
      .catch((err) => { inviteError.textContent = errorText(err) })
  } },
    h('label', { for: 'invite-user' }, t('info.addMember')),
    h('div', { class: 'invite-row' }, inviteInput, h('button', { type: 'submit', 'aria-label': t('info.addMember') }, '+')),
    inviteError)
  let leaveArmed = false
  const leaveButton = h('button', { type: 'button', class: 'danger-link', click: () => {
    const roomId = selected
    if (!roomId) return
    if (!leaveArmed) {
      leaveArmed = true
      leaveButton.textContent = t('info.leaveConfirm')
      setTimeout(() => { leaveArmed = false; leaveButton.textContent = t('info.leave') }, 4000)
      return
    }
    leaveArmed = false
    leaveButton.textContent = t('info.leave')
    void client.leave(roomId).then(() => { selected = undefined; refresh() }).catch(() => undefined)
  } }, t('info.leave'))
  // Archivage légal côté destinataire: le serveur ne lit rien, c'est cet appareil qui copie ce qu'il a déjà déchiffré.
  const archiveStatus = h('p', { class: 'muted', role: 'status' })
  const archiveButton = h('button', { type: 'button', class: 'secondary', click: () => { if (selected) void archiveRoom(selected) } }, t('info.archive'))
  async function archiveRoom(roomId: string) {
    const room = client.getRoom(roomId)
    if (!room) return
    archiveStatus.textContent = ''
    const events: ArchivableEvent[] = room.getLiveTimeline().getEvents().map((e) => ({
      eventId: e.getId() ?? '', sender: e.getSender() ?? '', ts: e.getTs(), type: e.getType(),
      status: e.isRedacted() ? 'redacted' : e.isDecryptionFailure() ? 'undecryptable' : 'ok',
      content: e.getContent() as Record<string, unknown>,
      deviceId: String(e.getWireContent().device_id ?? ''), senderKey: e.getSenderKey() ?? undefined,
    }))
    const archive = await buildRoomArchive({
      roomId, roomName: room.name, archivedBy: client.getUserId() ?? '', events,
      members: room.getJoinedMembers().map((m) => ({ userId: m.userId, name: m.name })),
      isInstructionAuthority: (user) => isInstructionAuthority(room.getMember(user)?.powerLevel),
    })
    const slug = room.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'salon'
    saveBlob(new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }), `diyoy-echanges-${slug}-${new Date().toISOString().slice(0, 10)}.json`)
    const skipped = Object.values(archive.excluded).reduce((a, b) => a + b, 0)
    archiveStatus.textContent = t('info.archiveDone', { n: String(archive.entries.length), x: String(skipped), digest: archive.digest.slice(0, 16) })
  }
  const infoCol = h('aside', { class: 'info hidden', 'aria-label': t('info.title') },
    infoHead,
    h('div', { class: 'info-level' }, h('span', { class: 'info-label' }, t('info.level')), h('span', { class: 'pill-ok' }, S.encrypted)),
    h('h3', {}, t('info.members')),
    infoMembers,
    inviteForm,
    archiveButton,
    h('p', { class: 'muted small' }, t('info.archiveHelp')),
    archiveStatus,
    leaveButton)

  const roomHeader = h('header')
  const timelineList = h('ol', { class: 'timeline' })
  const content = h('section', { class: 'content' }, h('p', { class: 'status' }, S.noRoom))
  const layout = h('div', { class: 'layout' }, nav, listCol, content, infoCol)
  root.replaceChildren(layout)

  const composers = new Map<string, HTMLElement>() // un brouillon par salon
  let shownRoom: string | undefined
  let listsSignature = ''

  const eventBody = (event: MatrixEvent): string => {
    // Un échec de déchiffrement remplace le contenu par un texte anglais du SDK: on le masque pour afficher notre libellé.
    if (event.isDecryptionFailure()) return S.undecryptable
    if (event.getType() === 'm.room.encrypted') {
      void client.decryptEventIfNeeded(event)
      return S.decrypting
    }
    const body = event.getContent().body
    return typeof body === 'string' ? body : ''
  }

  /** Un message de fichier devient un bouton de téléchargement; tout autre message est du texte. */
  const eventNode = (event: MatrixEvent): HTMLElement => {
    const content = event.getContent()
    if (event.getType() === 'm.room.message' && content.msgtype === 'm.file' && content.file) {
      const size = typeof content.info?.size === 'number' ? ` (${formatSize(content.info.size)})` : ''
      const name = String(content.filename ?? content.body ?? 'fichier')
      const error = h('span', { class: 'error', role: 'alert' })
      const button = h('button', { type: 'button', class: 'file', click: () => {
        error.textContent = ''
        downloadFile(client, event)
          .then((blob) => saveBlob(blob, name))
          .catch(() => { error.textContent = S.errors.DOWNLOAD_FAILED })
      } }, `${S.download} ${name}${size}`)
      return h('span', { class: 'body' }, button, error)
    }
    if (event.getType() === 'm.room.message' && content.msgtype === 'm.audio' && content.file) {
      const seconds = typeof content.info?.duration === 'number' ? Math.round(content.info.duration / 1000) : undefined
      const length = seconds === undefined ? '' : ` (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')})`
      const holder = h('span', { class: 'body' })
      const error = h('span', { class: 'error', role: 'alert' })
      holder.append(h('button', { type: 'button', class: 'file', click: () => {
        error.textContent = ''
        downloadFile(client, event)
          .then((blob) => {
            const url = URL.createObjectURL(blob)
            objectUrls.push(url)
            const audio = h('audio', { controls: true, src: url })
            holder.replaceChildren(audio, error)
            void audio.play().catch(() => undefined)
          })
          .catch(() => { error.textContent = S.errors.DOWNLOAD_FAILED })
      } }, `${S.voicePlay} · ${S.voiceMessage}${length}`), error)
      return holder
    }
    return h('span', { class: 'body' }, eventBody(event))
  }

  /** Niveau de classification du message, et soit l'interdiction de transfert, soit le choix du salon de destination. */
  const eventMeta = (event: MatrixEvent, room: Room): HTMLElement | undefined => {
    if (event.getType() !== 'm.room.message') return undefined
    const classification = readClassification(event.getContent())
    const note = h('span', { role: 'status' })
    const meta = h('span', { class: 'meta' })
    if (classification.level !== 'normal') {
      meta.append(h('span', { class: `level level-${classification.level}` }, S.levels[classification.level]))
    }
    if (classification.expiresAt !== null) meta.append(h('span', { class: 'lock' }, S.expiresAt(formatDate(classification.expiresAt))))
    if (classification.noForward) {
      meta.append(h('span', { class: 'lock' }, S.noForward))
    } else {
      const others = client.getRooms().filter((r) => r.getMyMembership() === 'join' && r.roomId !== room.roomId)
      if (others.length) {
        const select = h('select', { 'aria-label': S.forwardTo, change: () => {
          const destination = select.value
          select.value = ''
          if (!destination) return
          forwardMessage(client, event, destination)
            .then(() => { note.className = 'ok'; note.textContent = S.forwarded })
            .catch((e) => { note.className = 'error'; note.textContent = errorText(e) })
        } }, h('option', { value: '' }, S.forwardTo), ...others.map((r) => h('option', { value: r.roomId }, r.name)))
        meta.append(select)
      }
    }
    meta.append(note)
    return meta
  }

  const store = (key: string, value?: string) => {
    try {
      if (value === undefined) return window.localStorage.getItem(key)
      window.localStorage.setItem(key, value)
    } catch {
      /* stockage indisponible: l'accusé peut être renvoyé, ce qui est sans conséquence (compté une fois) */
    }
    return null
  }

  /** Accuse réception à l'ouverture: l'instruction est à l'écran, fenêtre active, et l'agent n'en est pas l'auteur. */
  const maybeAck = (event: MatrixEvent, room: Room) => {
    const id = event.getId()
    if (!id || event.getSender() === client.getUserId() || !shield.windowFocused || !shield.tabVisible) return
    const key = ackMarkerKey(client.getUserId() ?? '', id)
    if (acked.has(id) || store(key)) return
    acked.add(id)
    store(key, '1')
    sendAck(client, room.roomId, { eventId: id, body: String(event.getContent().body ?? '') }).catch(() => {
      acked.delete(id)
      try { window.localStorage.removeItem(key) } catch { /* ignoré */ }
    })
  }

  const printProof = (report: ProofReport, nameOf: (user: string) => string) => {
    proofPrint.replaceChildren(
      h('h1', {}, S.proofTitle),
      h('p', {}, `${S.proofInstruction} : ${report.instruction.sha256}`),
      h('p', {}, report.limits),
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, S.proofAgent), h('th', {}, S.proofDevice), h('th', {}, S.proofReadAt))),
        h('tbody', {}, ...report.read.map((r) => h('tr', {}, h('td', {}, nameOf(r.agent)), h('td', {}, r.deviceId), h('td', {}, formatDate(r.readAt)))))),
      ...(report.pending.length ? [h('p', {}, `${S.proofPending} : ${report.pending.map(nameOf).join(', ')}`)] : []),
    )
    window.print()
  }

  /** Pour l'auteur d'une instruction: qui l'a lue, qui reste à relancer, et la preuve exportable. */
  const instructionPanel = (event: MatrixEvent, room: Room, all: MatrixEvent[]): HTMLElement | undefined => {
    const id = event.getId()
    if (!id) return undefined
    const sha256 = hashes.get(id)
    if (!sha256) {
      void contentSha256(String(event.getContent().body ?? '')).then((hash) => { hashes.set(id, hash); refresh() })
      return undefined
    }
    const members = room.getJoinedMembers().map((m) => m.userId).filter((u) => u !== client.getUserId())
    const acks = all
      .filter((e) => e.getType() === ACK_TYPE)
      .map((e) => ({ sender: e.getSender() ?? '', deviceId: String(e.getWireContent().device_id ?? ''), senderKey: e.getSenderKey() ?? undefined, content: e.getContent() as Record<string, unknown> }))
    const tally = tallyAcks(acks, { eventId: id, sha256 }, members)
    const nameOf = (user: string) => room.getMember(user)?.name ?? user
    const report = buildProof({ eventId: id, sha256, sentAt: event.getTs() }, tally)
    return h('div', { class: 'ack-panel' },
      h('strong', {}, S.readBy(tally.read.length, members.length)),
      ...(tally.pending.length ? [h('span', { class: 'lock' }, `${S.pendingLabel} ${tally.pending.map(nameOf).join(', ')}`)] : []),
      h('button', { type: 'button', click: () => saveBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `preuve-lecture-${id.slice(1, 9)}.json`) }, S.exportProof),
      h('button', { type: 'button', click: () => printProof(report, nameOf) }, S.printProof),
    )
  }

  let lastTimelineSignature = ''
  const fillTimeline = (room: Room, forceBottom: boolean) => {
    // On ne ramène en bas que si l'agent y était déjà: il peut relire l'historique sans être renvoyé en bas.
    const atBottom = timelineList.scrollHeight - timelineList.scrollTop - timelineList.clientHeight < 40
    const now = Date.now()
    const all = room.getLiveTimeline().getEvents()

    // Mes propres messages expirants: je planifie leur suppression pour tous (une fois par message).
    for (const event of all) {
      const id = event.getId()
      if (id && event.getType() === 'm.room.message' && !redactionScheduled.has(id)) {
        redactionScheduled.add(id)
        scheduleExpiry(client, event)
      }
    }

    const shown = visibleEvents(all, now).filter((e) => e.getType() === 'm.room.message' || e.getType() === 'm.room.encrypted')

    // Un seul minuteur, réglé sur la prochaine échéance: le message disparaît à l'heure, sans redessiner chaque seconde.
    let nextDeadline: number | undefined
    for (const event of shown) {
      const { expiresAt } = readClassification(event.getContent())
      if (expiresAt !== null && (nextDeadline === undefined || expiresAt < nextDeadline)) nextDeadline = expiresAt
    }
    clearTimeout(expiryTimer)
    if (nextDeadline !== undefined) expiryTimer = setTimeout(refresh, Math.min(Math.max(nextDeadline - now, 0) + 50, MAX_TIMEOUT_MS))

    // Rien de visible n'a changé: on ne touche pas au DOM. Sinon un message vocal en cours de lecture serait coupé
    // à chaque événement de synchronisation, et une sélection de texte perdue.
    // Le focus de la fenêtre ne change l'affichage que pour les messages confidentiels (flou) et les instructions (accusé):
    // ailleurs, reconstruire la liste couperait inutilement un message vocal en cours de lecture.
    const shieldMatters = shown.some((e) => readClassification(e.getContent()).level === 'confidentiel' || e.getContent()[INSTRUCTION_KEY] === true)
    const signature = JSON.stringify([
      room.roomId,
      shown.map((e) => [e.getId(), e.getType(), e.isDecryptionFailure()]),
      shieldMatters ? shield.windowFocused && shield.tabVisible : null,
      hashes.size,
      room.getJoinedMemberCount(),
      client.getRooms().filter((r) => r.getMyMembership() === 'join').map((r) => r.roomId),
    ])
    if (signature === lastTimelineSignature) return
    lastTimelineSignature = signature

    const me = client.getUserId() ?? ''
    const watermark = room.getMember(me)?.name ?? me
    const items: HTMLElement[] = []
    for (const event of shown) {
      const type = event.getType()
      const classification = readClassification(event.getContent())
      const blurred = shouldBlur(classification.level, shield)
      const classes = [event.getSender() === client.getUserId() ? 'mine' : 'theirs']
      classes.push(`lvl-${classification.level}`)
      if (classification.level === 'confidentiel') classes.push('confidential')
      if (blurred) classes.push('blurred')
      const meta = eventMeta(event, room)
      // Une instruction n'est reconnue que si son auteur est modérateur du salon.
      const isInstruction =
        type === 'm.room.message' &&
        event.getContent()[INSTRUCTION_KEY] === true &&
        isInstructionAuthority(room.getMember(event.getSender() ?? '')?.powerLevel)
      if (isInstruction) {
        classes.push('instruction')
        if (!blurred) maybeAck(event, room)
      }
      const panel = isInstruction && event.getSender() === client.getUserId() ? instructionPanel(event, room, all) : undefined
      items.push(
        h('li', { class: classes.join(' '), 'data-watermark': watermark, ...(blurred ? { 'aria-hidden': 'true' } : {}) },
          h('span', { class: 'sender' }, room.getMember(event.getSender() ?? '')?.name ?? event.getSender() ?? ''),
          ...(isInstruction ? [h('span', { class: 'level level-instruction' }, S.instruction)] : []),
          eventNode(event),
          ...(meta ? [meta] : []),
          ...(panel ? [panel] : []),
        ),
      )
    }
    timelineList.replaceChildren(...items)
    if (forceBottom || atBottom) timelineList.scrollTop = timelineList.scrollHeight
  }
  function composerFor(roomId: string): HTMLElement {
    const cached = composers.get(roomId)
    if (cached) return cached
    const input = h('textarea', { id: `message-${roomId}`, rows: '2', required: true, placeholder: S.messageLabel })
    const level = h('select', { id: `level-${roomId}` }, ...LEVELS.map((l) => h('option', { value: l }, S.levels[l])))
    const hint = h('p', { class: 'hint' })
    const error = h('p', { class: 'error', role: 'alert' })
    const instruction = h('input', { id: `instruction-${roomId}`, type: 'checkbox' })
    // Le `select` reste la source de vérité (lecteurs d'écran, logique d'envoi); les cartes le pilotent.
    level.classList.add('sr-only')
    const expiry = h('select', { id: `expiry-${roomId}`, 'aria-label': S.expiry }, ...S.expiryOptions.map((o) => h('option', { value: o.value }, o.label)))
    const expiryField = h('label', { class: 'field expiry', for: `expiry-${roomId}` }, S.expiry, expiry)
    const cardText: Record<Level, string> = { normal: t('levelCardNormal'), restreinte: t('levelCardRestreinte'), confidentiel: t('levelCardConfidentiel') }
    const cards = LEVELS.map((l) => h('button', {
      type: 'button', role: 'radio', class: `level-card level-card-${l}`, 'data-level': l,
      click: () => { level.value = l; level.dispatchEvent(new Event('change')) },
    }, icon('shield', 22), h('strong', {}, S.levels[l]), h('span', { class: 'level-card-sub' }, cardText[l])))
    // Règles imposées par le niveau: affichées, non modifiables (c'est le niveau qui décide, jamais l'expéditeur).
    const ruleRow = (label: string) => {
      const sw = h('span', { class: 'switch', 'aria-hidden': 'true' })
      const state = h('span', { class: 'rule-state' }, sw, h('span', { class: 'rule-tag' }, t('rule.imposed')))
      return { row: h('div', { class: 'rule' }, h('span', {}, label), state), set: (on: boolean) => { sw.classList.toggle('on', on); state.classList.toggle('inactive', !on) } }
    }
    const ruleForward = ruleRow(t('rule.noForward'))
    const ruleBlur = ruleRow(t('rule.blur'))
    const levelNote = h('p', { class: 'level-note' }, S.levelNote)
    const levelChip = h('span', { class: 'chip chip-normal' })
    const describe = () => {
      const chosen = level.value as Level
      hint.textContent = S.levelHelps[chosen]
      levelChip.textContent = S.levels[chosen]
      levelChip.className = `chip chip-${chosen}`
      ruleForward.set(policyFor(chosen).noForward)
      ruleBlur.set(chosen === 'confidentiel')
      levelNote.classList.toggle('hidden', chosen === 'normal') // la note ne concerne que les niveaux à règles
      for (const card of cards) card.setAttribute('aria-checked', String(card.dataset.level === chosen))
      expiryField.classList.toggle('hidden', chosen === 'normal')
      if (chosen === 'normal') expiry.value = ''
    }
    level.addEventListener('change', describe)
    describe()
    const send = async () => {
      try {
        const chosen = level.value as Level
        if (instruction.checked) {
          // Réservé aux modérateurs du salon: les autres clients ne reconnaîtraient pas le message comme instruction.
          if (!isInstructionAuthority(client.getRoom(roomId)?.getMember(client.getUserId() ?? '')?.powerLevel)) throw new Error('NOT_AUTHORITY')
          await sendInstruction(client, roomId, input.value, chosen)
        } else if (chosen === 'normal') await sendText(client, roomId, input.value)
        else await sendClassified(client, roomId, input.value, chosen, expiry.value ? Number(expiry.value) : undefined)
        input.value = ''
        instruction.checked = false // une instruction de service est un acte délibéré: jamais reconduite au message suivant
        error.textContent = ''
      } catch (e) {
        error.textContent = e instanceof Error && e.message === 'EMPTY_MESSAGE' ? '' : errorText(e)
      }
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        void send()
      }
    })
    const file = h('input', { id: `file-${roomId}`, type: 'file' })
    file.addEventListener('change', () => {
      const chosen = file.files?.[0]
      if (!chosen) return
      sendFile(client, roomId, chosen, chosen.name)
        .then(() => { error.textContent = '' })
        .catch((e) => { error.textContent = errorText(e) })
        .finally(() => { file.value = '' })
    })
    const mic = h('button', { type: 'button' }, S.voiceRecord)
    const micStatus = h('span', { role: 'status', class: 'lock' })
    let recording: { stop(): Promise<Blob> } | undefined
    let startedAt = 0
    mic.addEventListener('click', () => {
      if (!recording) {
        startRecording()
          .then((r) => { recording = r; startedAt = Date.now(); mic.textContent = S.voiceStop; micStatus.textContent = S.voiceRecording; error.textContent = '' })
          .catch(() => { error.textContent = S.errors.MIC_DENIED })
        return
      }
      const finished = recording
      recording = undefined
      mic.textContent = S.voiceRecord
      micStatus.textContent = ''
      void finished.stop()
        .then((blob) => sendVoice(client, roomId, blob, Date.now() - startedAt))
        .catch((e) => { error.textContent = errorText(e) })
    })
    window.addEventListener('pagehide', () => {
      if (recording) void recording.stop().catch(() => undefined) // relâche le micro; l'enregistrement est abandonné
    })
    mic.classList.add('secondary')
    const form = h('form', { class: 'composer', submit: (e) => { e.preventDefault(); void send() } },
      h('label', { for: `message-${roomId}` }, S.messageLabel),
      h('div', { class: 'compose-row' }, input, h('button', { type: 'submit', class: 'send' }, S.send)),
      h('details', { class: 'levels' },
        h('summary', {}, h('span', { class: 'levels-title', id: `levels-${roomId}` }, S.level), levelChip),
        h('div', { class: 'level-cards', role: 'radiogroup', 'aria-labelledby': `levels-${roomId}` }, ...cards),
        level,
        h('div', { class: 'rules' }, ruleForward.row, ruleBlur.row, expiryField),
        hint,
        levelNote,
      ),
      h('div', { class: 'toolbar' },
        h('label', { class: 'check', for: `instruction-${roomId}` }, instruction, S.instructionLabel),
        h('label', { class: 'tool file', for: `file-${roomId}` }, S.attach, file),
        mic,
      ),
      micStatus,
      error,
    )
    composers.set(roomId, form)
    return form
  }

  function drawNewRoomForm(): HTMLDetailsElement {
    const name = h('input', { id: 'room-name', required: true })
    const invitees = h('input', { id: 'room-invitees' })
    const error = h('p', { class: 'error', role: 'alert' })
    const box = h('details', { class: 'new-room-box' })
    const form = h('form', { class: 'new-room', submit: (e) => {
      e.preventDefault()
      const invite = invitees.value.split(',').map((s) => s.trim()).filter(Boolean)
      createEncryptedRoom(client, { name: name.value, invite })
        .then((id) => { selected = id; name.value = ''; invitees.value = ''; error.textContent = ''; box.open = false; refresh() })
        .catch((err) => { error.textContent = errorText(err) })
    } },
      h('label', { for: 'room-name' }, S.roomName), name,
      h('label', { for: 'room-invitees' }, S.invitees), invitees,
      h('button', { type: 'submit' }, S.create),
      error,
    )
    box.append(h('summary', {}, S.newRoom), form)
    return box
  }

  function setView(next: View) {
    view = next
    shownRoom = undefined
    lastTimelineSignature = ''
    listsSignature = ''
    viewUpdate = undefined
    if (next === 'security') void showSecurity()
    else if (next === 'directory') showDirectory()
    else if (next === 'channels') showChannels()
    else if (next === 'settings') showSettings()
    refresh()
  }

  /** Annuaire: contacts des salons communs au départ, puis recherche dans l'annuaire du serveur; « Contacter » ouvre un échange chiffré. */
  function showDirectory() {
    const me = client.getUserId()
    const results = h('ul', { class: 'agent-list' })
    const heading = h('h2', {}, t('dir.contacts'))
    const input = h('input', { type: 'search', placeholder: t('dir.search'), 'aria-label': t('dir.search') })
    type Person = { user_id: string; display_name?: string }
    const contact = (u: Person) =>
      void createEncryptedRoom(client, { name: u.display_name || u.user_id, invite: [u.user_id] })
        .then((id) => { selected = id; setView('messages') })
        .catch(() => undefined)
    const render = (people: Person[]) => results.replaceChildren(...(people.length === 0 ? [h('li', { class: 'muted' }, t('dir.empty'))] : people.map((u) =>
      h('li', {}, avatar(u.display_name || u.user_id), h('div', { class: 'group-main' }, h('strong', {}, u.display_name || u.user_id), h('span', { class: 'muted' }, u.user_id)),
        h('button', { type: 'button', class: 'secondary', click: () => contact(u) }, t('dir.contact'))))))
    const shared = (): Person[] => {
      const seen = new Map<string, Person>()
      for (const r of client.getRooms()) if (r.getMyMembership() === 'join') for (const m of r.getJoinedMembers()) if (m.userId !== me) seen.set(m.userId, { user_id: m.userId, display_name: m.name })
      return [...seen.values()]
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      const term = input.value.trim()
      heading.textContent = term ? t('dir.results') : t('dir.contacts')
      if (!term) return render(shared())
      clearTimeout(timer)
      timer = setTimeout(() => {
        client.searchUserDirectory({ term, limit: 30 }).then((r) => { if (input.value.trim() === term) render(r.results.filter((u) => u.user_id !== me)) }).catch(() => render([]))
      }, 250)
    }
    input.addEventListener('input', run)
    render(shared())
    content.replaceChildren(h('section', { class: 'panel' }, h('h1', {}, t('dir.title')), h('div', { class: 'searchbox flat' }, input), heading, results))
  }

  const isChannel = (r: Room) => Number(r.currentState.getStateEvents('m.room.power_levels', '')?.getContent().events_default ?? 0) >= 50

  /** Canaux institutionnels: salons où seuls les modérateurs écrivent (diffusion officielle). */
  function showChannels() {
    const name = h('input', { id: 'channel-name', placeholder: t('channels.name'), required: true })
    const invitees = h('input', { id: 'channel-invitees', placeholder: S.invitees })
    const error = h('p', { class: 'error', role: 'alert' })
    const list = h('ul', { class: 'group-grid' })
    const form = h('form', { class: 'channel-form', submit: (e) => {
      e.preventDefault()
      createEncryptedRoom(client, { name: name.value, invite: invitees.value.split(',').map((s) => s.trim()).filter(Boolean), broadcast: true })
        .then((id) => { name.value = ''; invitees.value = ''; error.textContent = ''; selected = id; setView('messages') })
        .catch((err) => { error.textContent = errorText(err) })
    } }, name, invitees, h('button', { type: 'submit' }, t('channels.create')), error)
    viewUpdate = () => {
      const channels = client.getRooms().filter((r) => r.getMyMembership() === 'join' && isChannel(r))
      list.replaceChildren(...(channels.length === 0 ? [h('li', { class: 'muted' }, t('channels.empty'))] : channels.map((r) =>
        h('li', {}, avatar(r.name), h('div', { class: 'group-main' }, h('strong', {}, r.name), h('span', { class: 'muted' }, `${t('channels.badge')} · ${S.agentsCount(r.getJoinedMemberCount())}`)),
          h('button', { type: 'button', class: 'secondary', click: () => { selected = r.roomId; setView('messages') } }, t('groups.open'))))))
    }
    viewUpdate()
    content.replaceChildren(h('section', { class: 'panel' }, h('h1', {}, t('channels.title')), h('p', { class: 'muted' }, t('channels.help')), form, list))
  }

  /** Documents: tous les fichiers reçus ou envoyés dans vos salons, téléchargeables (déchiffrés dans le navigateur). */
  function drawDocuments() {
    const docs: Array<{ room: Room; event: MatrixEvent }> = []
    for (const r of client.getRooms()) {
      if (r.getMyMembership() !== 'join') continue
      for (const e of visibleEvents(r.getLiveTimeline().getEvents(), Date.now())) {
        const c = e.getContent()
        if (e.getType() === 'm.room.message' && c.msgtype === 'm.file' && c.file) docs.push({ room: r, event: e })
      }
    }
    docs.sort((a, b) => b.event.getTs() - a.event.getTs())
    content.replaceChildren(h('section', { class: 'panel' }, h('h1', {}, t('docs.title')),
      docs.length === 0 ? h('p', { class: 'muted' }, t('docs.empty')) : h('ul', { class: 'group-grid' }, ...docs.map(({ room, event }) => {
        const c = event.getContent()
        const name = String(c.filename ?? c.body ?? 'fichier')
        const size = typeof c.info?.size === 'number' ? ` · ${formatSize(c.info.size)}` : ''
        return h('li', {}, icon('documents', 26),
          h('div', { class: 'group-main' }, h('strong', {}, name), h('span', { class: 'muted' }, `${room.getMember(event.getSender() ?? '')?.name ?? event.getSender()} ${t('docs.in')} ${room.name}${size} · ${formatDate(event.getTs())}`)),
          h('button', { type: 'button', class: 'secondary', click: () => void downloadFile(client, event).then((blob) => saveBlob(blob, name)).catch(() => undefined) }, S.download))
      }))))
  }

  function showSettings() {
    const id = client.getUserId() ?? ''
    const verifyResult = h('p', { role: 'status' })
    const verifyInput = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': t('settings.verifyArchive'), change: () => {
      const file = verifyInput.files?.[0]
      if (!file) return
      void file.text()
        .then((text) => verifyRoomArchive(JSON.parse(text) as unknown))
        .catch((): ArchiveCheck => 'invalid')
        .then((result) => { verifyResult.textContent = t(`settings.verify.${result}`); verifyResult.className = result === 'intact' ? 'pill-ok' : 'error' })
    } })
    content.replaceChildren(h('section', { class: 'panel' }, h('h1', {}, t('settings.title')),
      h('div', { class: 'cards' },
        h('article', { class: 'card' }, h('h2', {}, t('settings.account')), h('p', {}, id), h('p', { class: 'muted' }, `${t('settings.server')} : ${id.split(':')[1] ?? ''}`)),
        h('article', { class: 'card' }, h('h2', {}, t('settings.device')), h('p', {}, 'DÎYOY Web'), h('p', { class: 'muted' }, client.getDeviceId() ?? '')),
        h('article', { class: 'card' }, h('h2', {}, S.language), languageSelect()),
        h('article', { class: 'card' }, h('h2', {}, t('settings.archives')), h('p', { class: 'muted' }, t('settings.archivesHelp')), verifyInput, verifyResult))))
  }

  /** Centre de sécurité: appareils réellement connectés au compte, second facteur, chiffrement, déconnexion de tous les appareils. */
  async function showSecurity() {
    content.replaceChildren(h('section', { class: 'panel security' }, h('h1', {}, t('sec.title'))))
    let devices: Array<{ device_id: string; display_name?: string; last_seen_ts?: number }> = []
    try { devices = (await client.getDevices()).devices } catch { /* liste indisponible: on affiche le reste */ }
    if (view !== 'security') return
    let armed = false
    const logoutAll = h('button', { type: 'button', class: 'danger', click: () => {
      if (!armed) {
        armed = true
        logoutAll.textContent = t('sec.logoutAllConfirm')
        setTimeout(() => { armed = false; logoutAll.textContent = t('sec.logoutAll') }, 4000)
        return
      }
      void client.http.authedRequest(Method.Post, '/logout/all', undefined, {})
        .catch(() => undefined)
        .finally(() => void logout(client).then(() => location.assign(identityLogoutUrl())))
    } }, t('sec.logoutAll'))
    const deviceList = h('ul', { class: 'device-list' }, ...devices.map((d) =>
      h('li', {}, h('strong', {}, d.display_name || t('sec.noName')),
        h('span', { class: 'muted' }, `${d.device_id === client.getDeviceId() ? `${t('sec.thisDevice')} · ` : ''}${t('sec.lastSeen')} ${d.last_seen_ts ? formatDate(d.last_seen_ts) : '—'}`))))
    content.replaceChildren(h('section', { class: 'panel security' },
      h('h1', {}, t('sec.title')),
      h('div', { class: 'cards' },
        h('article', { class: 'card' }, h('h2', {}, `${t('sec.devices')} (${devices.length})`), deviceList, logoutAll),
        h('article', { class: 'card' }, h('h2', {}, t('sec.twoFactor')), h('p', { class: 'pill-ok' }, `✓ ${t('rule.imposed')}`), h('p', {}, t('sec.twoFactorOn'))),
        h('article', { class: 'card' }, h('h2', {}, t('sec.e2e')), h('p', {}, t('sec.e2eText'))))))
  }

  function drawGroups() {
    const groups = client.getRooms().filter((r) => r.getMyMembership() === 'join')
    content.replaceChildren(h('section', { class: 'panel' },
      h('div', { class: 'panel-head' },
        h('h1', {}, t('groups.title')),
        h('button', { type: 'button', click: () => { setView('messages'); newRoomForm.open = true } }, t('groups.create'))),
      groups.length
        ? h('ul', { class: 'group-grid' }, ...groups.map((r) =>
          h('li', {}, avatar(r.name),
            h('div', { class: 'group-main' }, h('strong', {}, r.name), h('span', { class: 'muted' }, S.agentsCount(r.getJoinedMemberCount()))),
            h('button', { type: 'button', class: 'secondary', click: () => { selected = r.roomId; setView('messages') } }, t('groups.open')))))
        : h('p', { class: 'muted' }, t('groups.empty'))))
  }

  /** Dernier message visible d'un salon, pour la liste: aperçu masqué pour un message confidentiel, jamais de clair expiré. */
  const lastPreview = (r: Room): { text: string; ts: number; level: Level; unread: number } => {
    const unread = r.getUnreadNotificationCount()
    const events = visibleEvents(r.getLiveTimeline().getEvents(), Date.now()).filter((e) => e.getType() === 'm.room.message' || e.getType() === 'm.room.encrypted')
    const e = events[events.length - 1]
    if (!e) return { text: t('previewEmpty'), ts: 0, level: 'normal', unread }
    if (e.isDecryptionFailure()) return { text: S.undecryptable, ts: e.getTs(), level: 'normal', unread }
    if (e.getType() === 'm.room.encrypted') return { text: S.decrypting, ts: e.getTs(), level: 'normal', unread }
    const content = e.getContent()
    const level = readClassification(content).level
    let text = typeof content.body === 'string' ? content.body : ''
    if (content.msgtype === 'm.file') text = t('previewFile')
    else if (content.msgtype === 'm.audio') text = t('previewVoice')
    else if (content[INSTRUCTION_KEY] === true) text = `${t('previewInstruction')} · ${text}`
    if (level === 'confidentiel') text = t('previewHidden')
    return { text: text.slice(0, 70), ts: e.getTs(), level, unread }
  }
  const rowTime = (ts: number) => {
    if (!ts) return ''
    const d = new Date(ts)
    return d.toDateString() === new Date().toDateString()
      ? new Intl.DateTimeFormat('fr', { hour: '2-digit', minute: '2-digit' }).format(d)
      : new Intl.DateTimeFormat('fr', { day: '2-digit', month: '2-digit' }).format(d)
  }

  function updateInfo(room: Room) {
    infoHead.replaceChildren(avatar(room.name), h('strong', {}, room.name), h('span', { class: 'muted' }, S.agentsCount(room.getJoinedMemberCount())))
    infoMembers.replaceChildren(...room.getJoinedMembers().slice(0, 8).map((m) => h('li', {}, avatar(m.name, true), h('span', {}, m.name))))
  }

  function draw() {
    for (const b of navButtons) b.setAttribute('aria-current', String(b.dataset.view === view))
    for (const b of tabButtons) b.setAttribute('aria-selected', String(b.dataset.tab === tab))
    layout.classList.toggle('chat-open', view === 'messages' && selected !== undefined)
    listCol.classList.toggle('hidden', view !== 'messages')
    if (view !== 'messages') {
      infoCol.classList.add('hidden')
      if (view === 'groups') drawGroups()
      else if (view === 'documents') drawDocuments()
      else viewUpdate?.()
      return
    }

    const rooms = client.getRooms()
    const invites = rooms.filter((r) => r.getMyMembership() === 'invite')
    const joined = rooms.filter((r) => r.getMyMembership() === 'join')
    const rows = joined
      .filter((r) => (tab === 'groups' ? r.getJoinedMemberCount() >= 3 : true) && (query === '' || r.name.toLowerCase().includes(query)))
      .map((r) => ({ r, p: lastPreview(r) }))
      .sort((a, b) => b.p.ts - a.p.ts)

    // Les listes ne sont redessinées que si elles ont changé (le clavier garde le focus sur un bouton de la liste).
    const signature = JSON.stringify([selected, tab, query, invites.map((r) => [r.roomId, r.name]), rows.map(({ r, p }) => [r.roomId, r.name, p.text, p.ts, p.unread, p.level])])
    if (signature !== listsSignature) {
      listsSignature = signature
      lists.replaceChildren(
        ...(invites.length ? [h('h2', {}, S.invitations), h('ul', { class: 'invites' }, ...invites.map((r) =>
          h('li', {}, h('span', {}, r.name), h('button', { type: 'button', click: () => void client.joinRoom(r.roomId).then(() => { selected = r.roomId; refresh() }) }, S.join))))] : []),
        h('ul', { class: 'rooms' }, ...rows.map(({ r, p }) =>
          h('li', {}, h('button', { type: 'button', class: r.roomId === selected ? 'room active' : 'room', 'aria-current': String(r.roomId === selected), click: () => { selected = r.roomId; refresh() } },
            avatar(r.name),
            h('span', { class: 'row-main' },
              h('span', { class: 'row-top' }, h('strong', { class: 'room-name' }, r.name), h('span', { class: 'row-time' }, rowTime(p.ts))),
              h('span', { class: p.level === 'confidentiel' ? 'row-preview is-conf' : 'row-preview' }, p.text)),
            p.unread > 0 ? h('span', { class: 'count' }, String(p.unread)) : '')))),
      )
    }

    const room = selected ? client.getRoom(selected) : null
    infoCol.classList.toggle('hidden', !room)
    if (!room) {
      if (shownRoom !== undefined || content.querySelector('.panel')) content.replaceChildren(h('p', { class: 'status' }, S.noRoom))
      shownRoom = undefined
      return
    }
    const switched = shownRoom !== room.roomId
    if (switched) {
      content.replaceChildren(roomHeader, timelineList, composerFor(room.roomId))
      shownRoom = room.roomId
      lastTimelineSignature = ''
    }
    roomHeader.replaceChildren(
      h('button', { type: 'button', class: 'back', 'aria-label': t('back'), click: () => { selected = undefined; refresh() } }, '‹'),
      avatar(room.name),
      h('div', { class: 'room-title' }, h('h2', {}, room.name), h('span', { class: 'members' }, S.agentsCount(room.getJoinedMemberCount()))),
      h('span', { class: room.hasEncryptionStateEvent() ? 'badge ok' : 'badge warn' }, room.hasEncryptionStateEvent() ? S.encrypted : S.notEncrypted))
    updateInfo(room)
    fillTimeline(room, switched)
  }
  draw()
}