import { ClientEvent, MatrixEventEvent, RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { downloadFile, sendFile } from '../matrix/files.ts'
import { createEncryptedRoom, sendText } from '../matrix/rooms.ts'
import { logout, ssoLoginUrl, startSession } from '../matrix/session.ts'
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

function renderLogin(root: HTMLElement): void {
  root.replaceChildren(
    h('main', { class: 'login' },
      h('h1', {}, S.appTitle),
      h('p', {}, S.loginIntro),
      h('a', { class: 'button', href: ssoLoginUrl() }, S.login),
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

  const sidebar = h('aside', { 'aria-label': S.rooms })
  const content = h('section', { class: 'content' })
  root.replaceChildren(h('div', { class: 'layout' }, sidebar, content))

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
    return h('span', { class: 'body' }, eventBody(event))
  }

  const drawTimeline = (room: Room): HTMLElement => {
    const list = h('ol', { class: 'timeline' })
    for (const event of room.getLiveTimeline().getEvents()) {
      const type = event.getType()
      if (type !== 'm.room.message' && type !== 'm.room.encrypted') continue
      list.append(
        h('li', { class: event.getSender() === client.getUserId() ? 'mine' : 'theirs' },
          h('span', { class: 'sender' }, room.getMember(event.getSender() ?? '')?.name ?? event.getSender() ?? ''),
          eventNode(event),
        ),
      )
    }
    queueMicrotask(() => list.scrollTo({ top: list.scrollHeight }))
    return list
  }

  const drawComposer = (roomId: string): HTMLElement => {
    const input = h('textarea', { id: 'message', rows: '2', required: true })
    const error = h('p', { class: 'error', role: 'alert' })
    const send = async () => {
      try {
        await sendText(client, roomId, input.value)
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
    const file = h('input', { id: 'file', type: 'file' })
    file.addEventListener('change', () => {
      const chosen = file.files?.[0]
      if (!chosen) return
      sendFile(client, roomId, chosen, chosen.name)
        .then(() => { error.textContent = '' })
        .catch((e) => { error.textContent = errorText(e) })
        .finally(() => { file.value = '' })
    })
    return h('form', { class: 'composer', submit: (e) => { e.preventDefault(); void send() } },
      h('label', { for: 'message' }, S.messageLabel),
      input,
      h('button', { type: 'submit' }, S.send),
      h('label', { for: 'file' }, S.attach),
      file,
      error,
    )
  }

  const drawNewRoomForm = (): HTMLElement => {
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

  const draw = () => {
    const rooms = client.getRooms()
    const invites = rooms.filter((r) => r.getMyMembership() === 'invite')
    const joined = rooms.filter((r) => r.getMyMembership() === 'join')

    sidebar.replaceChildren(
      h('header', {}, h('strong', {}, client.getUserId() ?? ''), h('button', { type: 'button', click: () => void logout(client).then(() => location.assign('/')) }, S.logout)),
      drawNewRoomForm(),
      ...(invites.length ? [h('h2', {}, S.invitations), h('ul', {}, ...invites.map((r) =>
        h('li', {}, r.name, h('button', { type: 'button', click: () => void client.joinRoom(r.roomId).then(() => { selected = r.roomId; refresh() }) }, S.join))))] : []),
      h('h2', {}, S.rooms),
      h('ul', { class: 'rooms' }, ...joined.map((r) =>
        h('li', {}, h('button', { type: 'button', class: r.roomId === selected ? 'active' : '', 'aria-current': String(r.roomId === selected), click: () => { selected = r.roomId; refresh() } }, r.name)))),
    )

    const room = selected ? client.getRoom(selected) : null
    if (!room) return content.replaceChildren(h('p', { class: 'status' }, S.noRoom))
    content.replaceChildren(
      h('header', {}, h('h2', {}, room.name), h('span', { class: room.hasEncryptionStateEvent() ? 'badge ok' : 'badge warn' }, room.hasEncryptionStateEvent() ? S.encrypted : S.notEncrypted)),
      drawTimeline(room),
      drawComposer(room.roomId),
    )
  }
  draw()
}