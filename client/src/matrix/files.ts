import { Attachment, EncryptedAttachment, initAsync } from '@matrix-org/matrix-sdk-crypto-wasm'
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk'

const DEFAULT_MIME = 'application/octet-stream'
const MIME = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i

/**
 * Chiffre le fichier dans le navigateur (bibliothèque Matrix officielle, aucune cryptographie maison), envoie
 * seulement le texte chiffré au serveur de médias, sans nom de fichier, puis envoie dans le salon (donc chiffré
 * de bout en bout) le message qui porte le nom, le type, la clé et l'empreinte. Renvoie l'identifiant de l'événement.
 */
export async function sendFile(
  client: Pick<MatrixClient, 'getMediaConfig' | 'uploadContent' | 'sendMessage'>,
  roomId: string,
  file: Blob,
  name: string,
  options: { msgtype?: 'm.file' | 'm.audio'; durationMs?: number } = {},
): Promise<string> {
  if (file.size === 0) throw new Error('EMPTY_FILE')
  const max = await client.getMediaConfig(true).then((c) => c['m.upload.size'], () => undefined)
  if (max !== undefined && file.size > max) throw new Error('FILE_TOO_LARGE')

  await initAsync()
  const encrypted = Attachment.encrypt(new Uint8Array(await file.arrayBuffer()))
  try {
    const info = JSON.parse(encrypted.mediaEncryptionInfo ?? '{}') as Record<string, unknown>
    const { content_uri } = await client
      .uploadContent(new Blob([encrypted.encryptedData as Uint8Array<ArrayBuffer>]), { type: DEFAULT_MIME, includeFilename: false })
      .catch((e: { httpStatus?: number }) => {
        throw e.httpStatus === 413 ? new Error('FILE_TOO_LARGE') : e
      })
    const { event_id } = await client.sendMessage(roomId, {
      msgtype: options.msgtype ?? 'm.file',
      body: name,
      filename: name,
      info: {
        size: file.size,
        mimetype: file.type || DEFAULT_MIME,
        ...(options.durationMs === undefined ? {} : { duration: options.durationMs }),
      },
      file: { ...info, url: content_uri },
    } as never)
    return event_id
  } finally {
    encrypted.free()
  }
}

/** Télécharge le fichier chiffré (média authentifié), le déchiffre et vérifie son empreinte; lève une erreur si elle ne correspond pas. */
export async function downloadFile(
  client: Pick<MatrixClient, 'mxcUrlToHttp' | 'getAccessToken'>,
  event: MatrixEvent,
): Promise<Blob> {
  const content = event.getContent()
  const { url, ...info } = (content.file ?? {}) as { url?: unknown } & Record<string, unknown>
  if (typeof url !== 'string') throw new Error('NOT_A_FILE')

  const httpUrl = client.mxcUrlToHttp(url, undefined, undefined, undefined, false, true, true)
  if (!httpUrl) throw new Error('INVALID_MEDIA_URL')
  const res = await fetch(httpUrl, { headers: { authorization: `Bearer ${client.getAccessToken()}` } })
  if (!res.ok) throw new Error('DOWNLOAD_FAILED')

  await initAsync()
  const attachment = new EncryptedAttachment(new Uint8Array(await res.arrayBuffer()), JSON.stringify(info))
  try {
    const plain = Attachment.decrypt(attachment)
    const mimetype = typeof content.info?.mimetype === 'string' && MIME.test(content.info.mimetype) ? content.info.mimetype : DEFAULT_MIME
    return new Blob([plain as Uint8Array<ArrayBuffer>], { type: mimetype })
  } finally {
    attachment.free()
  }
}