import type { MatrixClient } from 'matrix-js-sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEncryptedRoom, sendText } from '../../src/matrix/rooms.ts'
import { registerAgent, startTestClient, waitForMessage } from './helpers'

// Les lettres du mooré (ɛ ɩ ʋ ã ĩ...) doivent traverser le chiffrement, le serveur et le déchiffrement sans la moindre
// altération: pas de normalisation Unicode, pas de perte de caractère.
const PHRASES = [
  'ɛ ɩ ʋ ã ĩ',
  'a\u0303 e\u0303 i\u0303 (même lettres, forme décomposée NFD)',
  'N kẽ tõkr pʋgẽ · N tʋm koɛɛgã · Yãmb koɛɛgã tʋmame tɩ kẽnge',
  'Ouédraogo — Kaboré — Sawadogo ✓ « guillemets » œ',
]

describe('SÉCURITÉ: caractères du mooré', () => {
  let alice: MatrixClient
  let bob: MatrixClient
  let roomId: string

  beforeAll(async () => {
    const [a, b] = await Promise.all([registerAgent('awa'), registerAgent('moussa')])
    ;[alice, bob] = await Promise.all([startTestClient(a), startTestClient(b)])
    roomId = await createEncryptedRoom(alice, { name: 'Langues', invite: [b.userId] })
    await bob.joinRoom(roomId)
  })

  afterAll(() => {
    alice?.stopClient()
    bob?.stopClient()
  })

  it('unicodeSurvivesRoundtrip', async () => {
    for (const phrase of PHRASES) {
      await sendText(alice, roomId, phrase)
      const received = await waitForMessage(bob, roomId, phrase)
      const body = received.getContent().body as string
      expect(body).toBe(phrase) // égalité stricte
      expect([...body].length, 'aucun caractère perdu ni fusionné').toBe([...phrase].length)
    }
  })
})