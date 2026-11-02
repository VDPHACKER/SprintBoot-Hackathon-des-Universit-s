import { ClientEvent, MatrixEventEvent, RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { ACK_TYPE, INSTRUCTION_KEY, ackMarkerKey, contentSha256, isInstructionAuthority, sendAck, sendInstruction, tallyAcks } from '../lib/ack.ts'
import { LEVELS, forwardMessage, policyFor, readClassification, sendClassified, type Level } from '../lib/classification.ts'
import { scheduleExpiry, visibleEvents } from '../lib/expiry.ts'
import { buildProof, type ProofReport } from '../lib/proof.ts'
import { LOCALES, getLocale, persistLocale, type Locale } from '../i18n/index.ts'
import { sendVoice, startRecording } from '../lib/voice.ts'
import { downloadFile, sendFile } from '../matrix/files.ts'
import { createEncryptedRoom, sendText } from '../matrix/rooms.ts'
import { IDENTITY_LOGOUT_URL } from '../matrix/config.ts'
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
const TINTS: ReadonlyArray<[string, string]> = [['#E3F0E8', '#0F2A1F'], ['#F9E0DC', '#6B1F18'], ['#FBEFC8', '#5C4300'], ['#E8E0F3', '#3A2A63'], ['#DDE8F5', '#1F3A5C'], ['#F1E4D8', '#5A3A1E']]
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
    mk('rect', { width: '64', height: '64', rx: '16', fill: '#0B6B45' }),
    mk('path', { d: 'M18 15h28a6 6 0 0 1 6 6v17a6 6 0 0 1-6 6H33l-9 8v-8h-6a6 6 0 0 1-6-6V21a6 6 0 0 1 6-6z', fill: '#FFFFFF' }),
    mk('circle', { cx: '32', cy: '26.5', r: '4.2', fill: '#0B6B45' }),
    mk('path', { d: 'M30.4 29h3.2l1.1 8h-5.4z', fill: '#0B6B45' }),
  )
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
      logo(56),
      h('h1', {}, S.appTitle),
      h('p', { class: 'tagline' }, S.tagline),
      h('p', { class: 'subtitle' }, S.appSubtitle),
      ...(new URL(window.location.href).searchParams.has('revoked') ? [h('p', { class: 'error', role: 'alert' }, S.revoked)] : []),
      h('p', {}, S.loginIntro),
      h('a', { class: 'button', href: ssoLoginUrl() }, S.login),
      languageSelect(),
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
  const lists = h('div')
  const newRoomForm = drawNewRoomForm()
  const sidebar = h('aside', { 'aria-label': S.rooms },
    h('header', {},
      h('div', { class: 'brand' }, logo(36), h('span', { class: 'brand-name' }, S.appTitle)),
      h('p', { class: 'status-line' },
        h('span', { class: 'line' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), S.serverStatus),
        h('span', { class: 'line' }, S.encrypted)),
      h('div', { class: 'me' },
        avatar((client.getUserId() ?? '').replace(/^@/, '')),
        h('span', { class: 'who', title: client.getUserId() ?? '' },
          h('strong', { class: 'identity' }, (client.getUserId() ?? '').replace(/^@/, '').split(':')[0]),
          h('span', { class: 'server' }, (client.getUserId() ?? '').split(':')[1] ?? ''))),
      languageSelect(),
      h('button', { type: 'button', class: 'secondary', click: () => void logout(client).then(() => location.assign(IDENTITY_LOGOUT_URL)) }, S.logout)),
    newRoomForm,
    lists,
  )
  const roomHeader = h('header')
  const timelineList = h('ol', { class: 'timeline' })
  const content = h('section', { class: 'content' }, h('p', { class: 'status' }, S.noRoom))
  root.replaceChildren(h('div', { class: 'layout' }, sidebar, content))

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
    const cards = LEVELS.map((l) => h('button', {
      type: 'button', role: 'radio', class: `level-card level-card-${l}`, 'data-level': l,
      click: () => { level.value = l; level.dispatchEvent(new Event('change')) },
    }, h('strong', {}, S.levels[l])))
    const levelNote = h('p', { class: 'level-note' }, S.levelNote)
    const describe = () => {
      const chosen = level.value as Level
      hint.textContent = S.levelHelps[chosen]
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
      h('div', { class: 'levels' },
        h('span', { class: 'levels-title', id: `levels-${roomId}` }, S.level),
        h('div', { class: 'level-cards', role: 'radiogroup', 'aria-labelledby': `levels-${roomId}` }, ...cards),
        level,
        expiryField,
      ),
      hint,
      levelNote,
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

  function drawNewRoomForm(): HTMLElement {
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

  function draw() {
    const rooms = client.getRooms()
    const invites = rooms.filter((r) => r.getMyMembership() === 'invite')
    const joined = rooms.filter((r) => r.getMyMembership() === 'join')

    // Les listes ne sont redessinées que si elles ont changé (le clavier garde le focus sur un bouton de la liste).
    const signature = JSON.stringify([selected, invites.map((r) => [r.roomId, r.name]), joined.map((r) => [r.roomId, r.name])])
    if (signature !== listsSignature) {
      listsSignature = signature
      lists.replaceChildren(
        ...(invites.length ? [h('h2', {}, S.invitations), h('ul', {}, ...invites.map((r) =>
          h('li', {}, r.name, h('button', { type: 'button', click: () => void client.joinRoom(r.roomId).then(() => { selected = r.roomId; refresh() }) }, S.join))))] : []),
        h('h2', {}, S.rooms),
        h('ul', { class: 'rooms' }, ...joined.map((r) =>
          h('li', {}, h('button', { type: 'button', class: r.roomId === selected ? 'room active' : 'room', 'aria-current': String(r.roomId === selected), click: () => { selected = r.roomId; refresh() } }, avatar(r.name, true), h('span', { class: 'room-name' }, r.name))))),
      )
    }

    const room = selected ? client.getRoom(selected) : null
    if (!room) {
      if (shownRoom !== undefined) content.replaceChildren(h('p', { class: 'status' }, S.noRoom))
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
      avatar(room.name),
      h('div', { class: 'room-title' }, h('h2', {}, room.name), h('span', { class: 'members' }, S.agentsCount(room.getJoinedMemberCount()))),
      h('span', { class: room.hasEncryptionStateEvent() ? 'badge ok' : 'badge warn' }, room.hasEncryptionStateEvent() ? S.encrypted : S.notEncrypted))
    fillTimeline(room, switched)
  }
  draw()
}