import type { MatrixClient } from 'matrix-js-sdk'
import { sendFile } from '../matrix/files.ts'

const EXTENSIONS: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3' }

/** Extension d'après le type enregistré (Safari produit de l'audio/mp4); `webm` par défaut. */
const extensionFor = (type: string): string => EXTENSIONS[type.split(';')[0].trim().toLowerCase()] ?? 'webm'

/** Enregistre le micro. `stop()` libère le micro et renvoie l'enregistrement. Le navigateur demande l'autorisation. */
export async function startRecording(): Promise<{ stop(): Promise<Blob> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const preferred = 'audio/webm;codecs=opus'
  const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported(preferred) ? { mimeType: preferred } : undefined)
  const chunks: Blob[] = []
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  })
  recorder.start()
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.addEventListener('stop', () => {
          stream.getTracks().forEach((track) => track.stop())
          resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
        })
        recorder.stop()
      }),
  }
}

/**
 * Envoie un message vocal: un fichier audio chiffré de bout en bout (même chemin que les pièces jointes, donc le serveur
 * ne reçoit ni le son ni le nom du fichier), de type `m.audio` avec sa durée.
 */
export async function sendVoice(
  client: Pick<MatrixClient, 'getMediaConfig' | 'uploadContent' | 'sendMessage'>,
  roomId: string,
  recording: Blob,
  durationMs: number,
): Promise<string> {
  if (recording.size === 0) throw new Error('EMPTY_FILE')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return sendFile(client, roomId, recording, `message-vocal-${stamp}.${extensionFor(recording.type)}`, {
    msgtype: 'm.audio',
    durationMs: Math.round(durationMs),
  })
}