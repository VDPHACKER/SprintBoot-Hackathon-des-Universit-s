import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { MatrixClient } from 'matrix-js-sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEncryptedRoom } from '../../src/matrix/rooms.ts'
import { downloadFile, sendFile } from '../../src/matrix/files.ts'
import { COMPOSE, ROOT, dumpDb, registerAgent, startTestClient, waitForEvent } from './helpers'

const NAME = 'décret-№1.pdf'
const MARKER = 'SECRET-MARKER-PDF'

describe('SÉCURITÉ: fichiers chiffrés de bout en bout', () => {
  let alice: MatrixClient
  let bob: MatrixClient
  let roomId: string
  let content: Uint8Array<ArrayBuffer>

  beforeAll(async () => {
    const [a, b] = await Promise.all([registerAgent('awa'), registerAgent('moussa')])
    ;[alice, bob] = await Promise.all([startTestClient(a), startTestClient(b)])
    roomId = await createEncryptedRoom(alice, { name: 'Dossiers', invite: [b.userId] })
    await bob.joinRoom(roomId)
    // 1 Mo aléatoire précédé d'un marqueur reconnaissable dans les octets en clair.
    content = new Uint8Array(1024 * 1024)
    content.set(Buffer.from(MARKER))
    content.set(randomBytes(content.length - MARKER.length), MARKER.length)
    await sendFile(alice, roomId, new Blob([content], { type: 'application/pdf' }), NAME)
  })

  afterAll(() => {
    alice?.stopClient()
    bob?.stopClient()
  })

  const receiveFile = () => waitForEvent(bob, roomId, (e) => e.getContent().msgtype === 'm.file' && e.getContent().body === NAME)

  it('fileRoundtripKeepsBytesAndName', async () => {
    const event = await receiveFile()
    expect(event.getContent().filename ?? event.getContent().body).toBe(NAME)
    const blob = await downloadFile(bob, event)
    expect(blob.type).toBe('application/pdf')
    expect(Buffer.from(await blob.arrayBuffer()).equals(Buffer.from(content))).toBe(true)
  })

  it('serverNeverSeesFileContentOrName', () => {
    const run = (cmd: string) =>
      execFileSync('docker', [...COMPOSE, 'exec', '-T', 'synapse', 'sh', '-c', cmd], { cwd: ROOT, encoding: 'utf8' }).trim()
    expect(Number(run('find /data/media_store -type f | wc -l')), 'le fichier chiffré doit bien être stocké par le serveur').toBeGreaterThan(0)
    expect(run(`grep -rl ${MARKER} /data/media_store || true`), 'le marqueur ne doit apparaître dans aucun fichier du serveur').toBe('')

    const dump = dumpDb()
    expect(dump).toContain(roomId)
    expect(dump).not.toContain(MARKER)
    expect(dump).not.toContain('décret-№1')
  })

  it('downloadRejectsFileWhoseHashDoesNotMatch', async () => {
    const original = (await receiveFile()).getContent()
    const forgedHash = randomBytes(32).toString('base64').replace(/=+$/, '') // base64 valide mais sans rapport avec le fichier
    const forgedName = `falsifié-${randomBytes(3).toString('hex')}.pdf`
    await alice.sendMessage(roomId, {
      ...original,
      body: forgedName,
      file: { ...original.file, hashes: { sha256: forgedHash } },
    } as never)
    const forged = await waitForEvent(bob, roomId, (e) => e.getContent().body === forgedName)
    await expect(downloadFile(bob, forged)).rejects.toThrow(/hash|digest|mismatch/i)
  })
})