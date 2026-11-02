import type { MatrixClient, Visibility } from 'matrix-js-sdk'
import { SERVER_NAME } from './config.ts'

/** Même règle que le service d'administration: 3 à 32 caractères parmi a-z 0-9 . _ - */
const LOCALPART = /^[a-z0-9._-]{3,32}$/

/** « awa.ouedraogo » ou « @awa.ouedraogo:chat.localhost » → identifiant Matrix complet; tout autre serveur est refusé. */
export function toMxid(input: string): string {
  const value = input.trim()
  const full = /^@([^:]+):(.+)$/.exec(value)
  const [localpart, server] = full ? [full[1], full[2]] : [value, SERVER_NAME]
  if (server !== SERVER_NAME || !LOCALPART.test(localpart)) throw new Error('INVALID_USER')
  return `@${localpart}:${SERVER_NAME}`
}

/** Salon privé, chiffré dès sa création (le serveur l'impose aussi), avec les agents invités. */
export async function createEncryptedRoom(
  client: Pick<MatrixClient, 'createRoom'>,
  options: { name: string; invite: string[]; broadcast?: boolean },
): Promise<string> {
  const name = options.name.trim()
  if (name === '') throw new Error('EMPTY_ROOM_NAME')
  const invite = options.invite.map(toMxid)
  const { room_id } = await client.createRoom({
    name,
    invite,
    visibility: 'private' as unknown as Visibility,
    // Canal de diffusion: seuls les modérateurs (niveau 50) peuvent écrire, les autres membres lisent.
    ...(options.broadcast ? { power_level_content_override: { events_default: 50 } } : {}),
    initial_state: [
      { type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } },
    ],
  })
  return room_id
}

/** Envoie un message texte tel quel (le chiffrement est fait par le client). Renvoie l'identifiant de l'événement. */
export async function sendText(client: Pick<MatrixClient, 'sendTextMessage'>, roomId: string, body: string): Promise<string> {
  if (body.trim() === '') throw new Error('EMPTY_MESSAGE')
  const { event_id } = await client.sendTextMessage(roomId, body)
  return event_id
}