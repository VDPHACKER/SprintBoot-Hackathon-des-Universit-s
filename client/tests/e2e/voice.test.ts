import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { MatrixClient } from 'matrix-js-sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sendVoice } from '../../src/lib/voice.ts'
import { downloadFile } from '../../src/matrix/files.ts'
import { createEncryptedRoom } from '../../src/matrix/rooms.ts'
import { COMPOSE, ROOT, dumpDb, registerAgent, startTestClient, waitForEvent } from './helpers'

const MARKER = 'SECRET-VOICE-MARKER'

describe('SÉCURITÉ: messages vocaux chiffrés', () => {
  let alice: MatrixClient
  let bob: MatrixClient
  let roomId: string
  const audio = new Uint8Array(40_000)

  beforeAll(async () => {
    audio.set(Buffer.from(MARKER))
    audio.set(randomBytes(audio.length - MARKER.length), MARKER.length)
    const [a, b] = await Promise.all([registerAgent('awa'), registerAgent('moussa')])
    ;[alice, bob] = await Promise.all([startTestClient(a), startTestClient(b)])
    roomId = await createEncryptedRoom(alice, { name: 'Vocal', invite: [b.userId] })
    await bob.joinRoom(roomId)
    await sendVoice(alice, roomId, new Blob([audio], { type: 'audio/webm;codecs=opus' }), 4200)
  })

  afterAll(() => {
    alice?.stopClient()
    bob?.stopClient()
  })

  it('voiceMessageArrivesIntactWithItsDuration', async () => {
    const event = await waitForEvent(bob, roomId, (e) => e.getContent().msgtype === 'm.audio')
    expect(event.getContent().info).toMatchObject({ duration: 4200, mimetype: 'audio/webm;codecs=opus', size: audio.length })
    const blob = await downloadFile(bob, event)
    // MediaRecorder annonce « audio/webm;codecs=opus »: le paramètre ne doit pas faire retomber le type en binaire générique,
    // sinon le lecteur audio du navigateur ne reconnaît plus le fichier.
    expect(blob.type).toBe('audio/webm;codecs=opus')
    expect(Buffer.from(await blob.arrayBuffer()).equals(Buffer.from(audio))).toBe(true)
  })

  it('serverNeverHearsTheVoiceMessage', () => {
    const grep = execFileSync('docker', [...COMPOSE, 'exec', '-T', 'synapse', 'sh', '-c', `grep -rl ${MARKER} /data/media_store || true`], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
    expect(grep).toBe('')
    const dump = dumpDb()
    expect(dump).toContain(roomId)
    expect(dump).not.toContain(MARKER)
    expect(dump).not.toContain('message-vocal') // le nom du fichier vocal n'est visible que dans le message chiffré
  })
})