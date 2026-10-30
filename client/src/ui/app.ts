import { ClientEvent, MatrixEventEvent, RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { ACK_TYPE, INSTRUCTION_KEY, contentSha256, isInstructionAuthority, sendAck, sendInstruction, tallyAcks } from '../lib/ack.ts'
import { LEVELS, forwardMessage, policyFor, readClassification, sendClassified, type Level } from '../lib/classification.ts'
import { scheduleExpiry, visibleEvents } from '../lib/expiry.ts'
import { buildProof, type ProofReport } from '../lib/proof.ts'
import { LOCALES, getLocale, persistLocale, type Locale } from '../i18n/index.ts'
import { sendVoice, startRecording } from '../lib/voice.ts'
import { downloadFile, sendFile } from '../matrix/files.ts'
import { createEncryptedRoom, sendText } from '../matrix/rooms.ts'
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
      h('h1', {}, S.appTitle),
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
  const proofPrint = h('section', { id: 'proof-print' })
  document.body.append(proofPrint)
  let expiryTimer: ReturnType<typeof setTimeout> | undefined
  // Éléments persistants: les champs de saisie ne sont JAMAIS reconstruits, sinon un message en cours de frappe
  // disparaîtrait à chaque événement de synchronisation.
  const lists = h('div')
  const newRoomForm = drawNewRoomForm()
  const sidebar = h('aside', { 'aria-label': S.rooms },
    h('header', {}, h('strong', {}, client.getUserId() ?? ''), languageSelect(), h('button', { type: 'button', click: () => void logout(client).then(() => location.assign('/')) }, S.logout)),
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
    if (event.getType() === 'm.room.encrypted') {
      void client.decryptEventIfNeeded(event)
      return event.isDecryptionFailure() ? S.undecryptable : S.decrypting
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
            const audio = h('audio', { controls: true, src: URL.createObjectURL(blob) })
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
    const key = `bf.ack.${id}`
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
      .map((e) => ({ sender: e.getSender() ?? '', deviceId: String(e.getWireContent().device_id ?? ''), content: e.getContent() as Record<string, unknown> }))
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
    const signature = JSON.stringify([
      room.roomId,
      shown.map((e) => [e.getId(), e.getType(), e.isDecryptionFailure()]),
      shield.windowFocused && shield.tabVisible,
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
    const input = h('textarea', { id: `message-${roomId}`, rows: '2', required: true })
    const level = h('select', { id: `level-${roomId}` }, ...LEVELS.map((l) => h('option', { value: l }, S.levels[l])))
    const hint = h('p', { class: 'hint' })
    const error = h('p', { class: 'error', role: 'alert' })
    const instruction = h('input', { id: `instruction-${roomId}`, type: 'checkbox' })
    const describe = () => {
      const policy = policyFor(level.value as Level)
      hint.textContent = [policy.noForward ? S.noForward : '', policy.defaultTtlMs ? S.expiresIn(Math.round(policy.defaultTtlMs / 3_600_000)) : ''].filter(Boolean).join(' ')
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
        else await sendClassified(client, roomId, input.value, chosen)
        input.value = ''
        error.textContent = ''
      } catch (e) {
        error.textContent = e instanceof Error && e.message === 'EMPTY_MESSAGE' ? '' : errorText(e)
      }
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
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
    const form = h('form', { class: 'composer', submit: (e) => { e.preventDefault(); void send() } },
      h('label', { for: `message-${roomId}` }, S.messageLabel),
      input,
      h('label', { for: `level-${roomId}` }, S.level),
      level,
      hint,
      h('label', { class: 'check', for: `instruction-${roomId}` }, instruction, S.instructionLabel),
      h('button', { type: 'submit' }, S.send),
      h('label', { for: `file-${roomId}` }, S.attach),
      file,
      mic,
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
    return h('form', { class: 'new-room', submit: (e) => {
      e.preventDefault()
      const invite = invitees.value.split(',').map((s) => s.trim()).filter(Boolean)
      createEncryptedRoom(client, { name: name.value, invite })
        .then((id) => { selected = id; name.value = ''; invitees.value = ''; error.textContent = ''; refresh() })
        .catch((err) => { error.textContent = errorText(err) })
    } },
      h('h2', {}, S.newRoom),
      h('label', { for: 'room-name' }, S.roomName), name,
      h('label', { for: 'room-invitees' }, S.invitees), invitees,
      h('button', { type: 'submit' }, S.create),
      error,
    )
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
          h('li', {}, h('button', { type: 'button', class: r.roomId === selected ? 'active' : '', 'aria-current': String(r.roomId === selected), click: () => { selected = r.roomId; refresh() } }, r.name)))),
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
    roomHeader.replaceChildren(h('h2', {}, room.name), h('span', { class: room.hasEncryptionStateEvent() ? 'badge ok' : 'badge warn' }, room.hasEncryptionStateEvent() ? S.encrypted : S.notEncrypted))
    fillTimeline(room, switched)
  }
  draw()
}