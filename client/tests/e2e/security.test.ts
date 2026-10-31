import { randomBytes } from 'node:crypto'
import type { MatrixClient } from 'matrix-js-sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ACK_TYPE, INSTRUCTION_KEY, sendAck, sendInstruction } from '../../src/lib/ack.ts'
import { CLASSIFICATION_KEY, sendClassified } from '../../src/lib/classification.ts'
import { sendVoice } from '../../src/lib/voice.ts'
import { sendFile } from '../../src/matrix/files.ts'
import { createEncryptedRoom, sendText } from '../../src/matrix/rooms.ts'
import {
  BASE,
  api,
  dumpDb,
  mediaStoreFileCount,
  mediaStoreFilesContaining,
  registerAgent,
  serviceLogs,
  sql,
  startTestClient,
  waitForEvent,
  waitForMessage,
} from './helpers'

const tag = () => randomBytes(5).toString('hex')

describe('SÉCURITÉ: le serveur ne lit rien', () => {
  let alice: MatrixClient
  let bob: MatrixClient
  let roomId: string
  const ROOM_NAME = `Salon-visible-${tag()}`
  const TEXT = `texte secret ${tag()}`
  const CLASSIFIED = `message confidentiel ${tag()}`
  const INSTRUCTION = `instruction de service ${tag()}`
  const FILE_NAME = `nom-de-fichier-secret-${tag()}.pdf`
  const FILE_MARKER = `FILEMARK-${tag()}`
  const VOICE_MARKER = `VOICEMARK-${tag()}`
  let instructionId: string

  beforeAll(async () => {
    const [a, b] = await Promise.all([registerAgent('awa'), registerAgent('moussa')])
    ;[alice, bob] = await Promise.all([startTestClient(a), startTestClient(b)])
    roomId = await createEncryptedRoom(alice, { name: ROOM_NAME, invite: [b.userId] })
    await bob.joinRoom(roomId)

    // Scénario complet: texte, message classifié, instruction + accusé, fichier, message vocal.
    await sendText(alice, roomId, TEXT)
    await sendClassified(alice, roomId, CLASSIFIED, 'confidentiel')
    instructionId = await sendInstruction(alice, roomId, INSTRUCTION)
    const file = new Uint8Array(20_000).fill(1)
    file.set(Buffer.from(FILE_MARKER))
    await sendFile(alice, roomId, new Blob([file], { type: 'application/pdf' }), FILE_NAME)
    const voice = new Uint8Array(15_000).fill(2)
    voice.set(Buffer.from(VOICE_MARKER))
    await sendVoice(alice, roomId, new Blob([voice], { type: 'audio/webm' }), 3000)

    for (const body of [TEXT, CLASSIFIED, INSTRUCTION]) await waitForMessage(bob, roomId, body)
    await waitForEvent(bob, roomId, (e) => e.getContent().msgtype === 'm.audio')
    await sendAck(bob, roomId, { eventId: instructionId, body: INSTRUCTION })
    await waitForEvent(alice, roomId, () => true, 30_000, ACK_TYPE)
  })

  afterAll(() => {
    alice?.stopClient()
    bob?.stopClient()
  })

  it('nothingReadableOnServer', () => {
    const dump = dumpDb()
    const logs = serviceLogs('caddy', 'synapse')
    expect(dump, 'la base exportée doit contenir ce salon').toContain(roomId)
    expect(mediaStoreFileCount(), 'le magasin de médias doit contenir les fichiers chiffrés').toBeGreaterThanOrEqual(2)

    const mustStayHidden = [TEXT, CLASSIFIED, INSTRUCTION, FILE_NAME, FILE_MARKER, VOICE_MARKER, CLASSIFICATION_KEY, INSTRUCTION_KEY, ACK_TYPE]
    for (const secret of mustStayHidden) {
      expect(dump, `base de données: ${secret}`).not.toContain(secret)
      expect(logs, `journaux: ${secret}`).not.toContain(secret)
    }
    for (const marker of [FILE_MARKER, VOICE_MARKER]) {
      expect(mediaStoreFilesContaining(marker), `magasin de médias: ${marker}`).toEqual([])
    }
  })

  it('onlyEncryptedMessageEventsAreStored', () => {
    const rows = sql(`SELECT type, count(*) FROM events WHERE room_id = '${roomId}' GROUP BY type ORDER BY type`)
    const counts = Object.fromEntries(rows.map((r) => r.split('|')).map(([type, n]) => [type, Number(n)]))
    expect(counts['m.room.message'], 'aucun message en clair dans le salon').toBeUndefined()
    expect(Object.keys(counts).filter((t) => t.startsWith('bf.')), 'aucun type d’événement applicatif visible').toEqual([])
    expect(counts['m.room.encrypted'], 'texte, classifié, instruction, fichier, vocal, accusé').toBeGreaterThanOrEqual(6)
    expect(counts['m.room.encryption'], 'le salon est déclaré chiffré').toBe(1)
  })

  it('knownLimit_roomNameAndMembershipAreVisibleToTheServer', () => {
    // Les événements d'état Matrix (nom du salon, membres, droits) ne sont PAS chiffrés de bout en bout.
    // Ce test fige cette limite: elle est documentée dans la note de sécurité, et un changement doit être décidé, pas subi.
    expect(dumpDb()).toContain(ROOM_NAME)
  })

  it('unauthenticatedMediaDownloadIsRefused', async () => {
    const fileEvent = await waitForEvent(bob, roomId, (e) => e.getContent().msgtype === 'm.file')
    const mediaId = String(fileEvent.getContent().file.url).split('/').pop()
    const authenticated = await fetch(`${BASE}/_matrix/client/v1/media/download/chat.localhost/${mediaId}`)
    const legacy = await fetch(`${BASE}/_matrix/media/v3/download/chat.localhost/${mediaId}`)
    expect(authenticated.status, 'sans jeton').toBe(401)
    expect(legacy.status, 'ancien point d’accès sans authentification').not.toBe(200)
  })
})

describe('SÉCURITÉ: un intrus ne peut pas entrer', () => {
  it('registrationIsRefused', async () => {
    const res = await fetch(`${BASE}/_matrix/client/v3/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: `intrus-${tag()}`, password: 'x'.repeat(16), auth: { type: 'm.login.dummy' } }),
    })
    expect(res.status).toBe(403)
  })

  it('guestAccessIsRefused', async () => {
    const res = await fetch(`${BASE}/_matrix/client/v3/register?kind=guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(403)
  })

  it('forgedTokenIsRefused', async () => {
    const res = await api('/_matrix/client/v3/account/whoami', `syt_${tag()}_${tag()}_${tag()}`)
    expect(res.status).toBe(401)
    expect(((await res.json()) as { errcode: string }).errcode).toBe('M_UNKNOWN_TOKEN')
  })

  it('passwordLoginIsRefused', async () => {
    const res = await fetch(`${BASE}/_matrix/client/v3/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'm.login.password', identifier: { type: 'm.id.user', user: 'awa.ouedraogo' }, password: 'Demo-Burkina-2026!' }),
    })
    expect(res.status, 'même avec le bon mot de passe du compte de démonstration').not.toBe(200)
    expect(JSON.stringify(await res.json())).not.toContain('access_token')
  })

  it('anAccountThatWasNotInvitedCannotJoinAPrivateRoom', async () => {
    const owner = await registerAgent('chef')
    const stranger = await registerAgent('intrus')
    const ownerClient = await startTestClient(owner)
    try {
      const roomId = await createEncryptedRoom(ownerClient, { name: 'Privé', invite: [] })
      const res = await api(`/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, stranger.accessToken, { method: 'POST', body: '{}' })
      expect(res.status).toBe(403)
    } finally {
      ownerClient.stopClient()
    }
  })

  it('adminApisAreNotReachableFromOutside', async () => {
    for (const path of ['/_synapse/admin/v1/server_version', '/_synapse/admin/v2/users', '/_matrix/federation/v1/version']) {
      expect([403, 404], path).toContain((await fetch(`${BASE}${path}`)).status)
    }
    expect((await fetch(`${BASE}/admin-api/agents`)).status, 'API d’administration sans jeton').toBe(401)
    expect((await fetch('http://localhost:8081/admin/realms/bf/users')).status, 'API d’administration de Keycloak').toBe(404)
  })
})
describe('SÉCURITÉ: le serveur refuse tout contenu en clair', () => {
  // Un client modifié (ou ancien) pourrait poster du texte lisible. Le serveur ne doit jamais le stocker:
  // c'est lui qui fait respecter la règle, pas seulement notre client.
  let owner: Awaited<ReturnType<typeof registerAgent>>
  let client: MatrixClient
  let roomId: string
  const send = (type: string, body: unknown) =>
    api(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${type}/txn-${tag()}`, owner.accessToken, { method: 'PUT', body: JSON.stringify(body) })

  beforeAll(async () => {
    owner = await registerAgent('rogue')
    client = await startTestClient(owner)
    roomId = await createEncryptedRoom(client, { name: 'Contrôle', invite: [] })
  })

  afterAll(() => client?.stopClient())

  it('serverRefusesAPlaintextMessageEvenFromAModifiedClient', async () => {
    const marker = `EN-CLAIR-${tag()}`
    const res = await send('m.room.message', { msgtype: 'm.text', body: marker })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { errcode: string }).errcode).toBe('M_FORBIDDEN')
    expect(dumpDb()).not.toContain(marker)
    expect(sql(`SELECT count(*) FROM events WHERE room_id = '${roomId}' AND type = 'm.room.message'`)).toEqual(['0'])
  })

  it('serverRefusesOtherPlaintextEventTypesToo', async () => {
    for (const type of ['m.sticker', 'm.reaction', 'm.notice', 'bf.gov.ack', 'com.example.nimporte-quoi']) {
      expect((await send(type, { texte: `clair ${tag()}` })).status, type).toBe(403)
    }
  })

  it('serverStillAcceptsEncryptedEventsRedactionsAndStateChanges', async () => {
    // Rien de légitime n'est bloqué: événements chiffrés, suppressions et changements d'état (le nom du salon, par exemple).
    const encrypted = await send('m.room.encrypted', {
      algorithm: 'm.megolm.v1.aes-sha2',
      sender_key: 'cle',
      session_id: 'session',
      device_id: owner.deviceId,
      ciphertext: 'AwgAEnAEnAEnAEnAEnAEnA',
    })
    expect(encrypted.status).toBe(200)
    const eventId = ((await encrypted.json()) as { event_id: string }).event_id

    const redaction = await api(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/txn-${tag()}`,
      owner.accessToken,
      { method: 'PUT', body: '{}' },
    )
    expect(redaction.status).toBe(200)

    const state = await api(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.topic`, owner.accessToken, {
      method: 'PUT',
      body: JSON.stringify({ topic: 'sujet' }),
    })
    expect(state.status).toBe(200)
  })
})
describe('SÉCURITÉ: le serveur refuse les chemins détournés vers le clair', () => {
  // Relecture indépendante: refuser les types de message ne suffit pas, un client modifié peut essayer un état
  // personnalisé, le motif d'une suppression ou une « enveloppe chiffrée » qui contient du texte.
  let owner: Awaited<ReturnType<typeof registerAgent>>
  let client: MatrixClient
  let roomId: string
  const room = () => encodeURIComponent(roomId)
  const put = (path: string, body: unknown) => api(`/_matrix/client/v3/rooms/${room()}/${path}`, owner.accessToken, { method: 'PUT', body: JSON.stringify(body) })
  const megolm = { algorithm: 'm.megolm.v1.aes-sha2', sender_key: 'cle', session_id: 'session', ciphertext: 'AwgAEnAEnAEnAEnAEnAEnA' }

  beforeAll(async () => {
    owner = await registerAgent('rogue')
    client = await startTestClient(owner)
    roomId = await createEncryptedRoom(client, { name: 'Détours', invite: [] })
  })

  afterAll(() => client?.stopClient())

  it('serverRefusesCustomStateEventTypes', async () => {
    const marker = `ETAT-${tag()}`
    expect((await put(`state/com.example.secret/cle`, { texte: marker })).status).toBe(403)
    expect(dumpDb()).not.toContain(marker)
  })

  it('serverRefusesARedactionCarryingAReason', async () => {
    const sent = await put(`send/m.room.encrypted/txn-${tag()}`, { ...megolm, device_id: owner.deviceId })
    const eventId = ((await sent.json()) as { event_id: string }).event_id
    const marker = `MOTIF-${tag()}`
    const refused = await put(`redact/${encodeURIComponent(eventId)}/txn-${tag()}`, { reason: marker })
    expect(refused.status).toBe(403)
    expect(dumpDb()).not.toContain(marker)
    const accepted = await put(`redact/${encodeURIComponent(eventId)}/txn-${tag()}`, {})
    expect(accepted.status, 'une suppression sans motif reste possible (c’est ce qu’envoie le client)').toBe(200)
  })

  it('serverRefusesAnEncryptedEnvelopeThatCarriesPlaintext', async () => {
    const marker = `ENVELOPPE-${tag()}`
    const forged: Array<[string, unknown]> = [
      ['champ body à côté du chiffré', { ...megolm, body: marker }],
      ['champ msgtype', { ...megolm, msgtype: 'm.text' }],
      ['texte lisible à la place du chiffré', { ...megolm, ciphertext: `ceci est du texte lisible ${marker}` }],
      ['algorithme inconnu', { ...megolm, algorithm: 'com.example.clair' }],
      ['chiffré absent', { algorithm: megolm.algorithm }],
    ]
    for (const [label, content] of forged) {
      expect((await put(`send/m.room.encrypted/txn-${tag()}`, content)).status, label).toBe(403)
    }
    expect(dumpDb()).not.toContain(marker)
  })

  it('theStateFieldsMatrixLeavesInTheClearStayAcceptedByDesign', async () => {
    // Nom, sujet et noms affichés sont des champs d'état Matrix: lisibles du serveur. Limite documentée, pas masquée.
    expect((await put('state/m.room.topic', { topic: 'sujet lisible du serveur' })).status).toBe(200)
  })
})