import { EventEmitter } from 'node:events'
import { HttpApiEvent } from 'matrix-js-sdk'
import { describe, expect, it, vi } from 'vitest'
import { watchForRevocation } from '../../src/matrix/session.ts'

function fakeClient(clearStores: () => Promise<void> = async () => undefined) {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    stopClient: vi.fn(),
    clearStores: vi.fn(clearStores),
  })
}

function fakeStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    get length() {
      return data.size
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('watchForRevocation', () => {
  it('purgesLocalStoreOnLogout', async () => {
    const client = fakeClient()
    const storage = fakeStorage({ 'bf.session': 'jeton', 'bf.autre': 'x', 'sans-rapport': 'garde' })
    const onRevoked = vi.fn()
    watchForRevocation(client as never, onRevoked, storage)

    client.emit(HttpApiEvent.SessionLoggedOut, { errcode: 'M_UNKNOWN_TOKEN' })
    await flush()

    expect(client.stopClient).toHaveBeenCalledOnce()
    expect(client.clearStores).toHaveBeenCalledOnce()
    expect([...storage.data.keys()]).toEqual(['sans-rapport']) // seules les clés de l'application sont effacées
    expect(onRevoked).toHaveBeenCalledOnce()
  })

  it('callsOnRevokedOnlyOnceEvenIfEventRepeats', async () => {
    const client = fakeClient()
    const onRevoked = vi.fn()
    watchForRevocation(client as never, onRevoked, fakeStorage({}))
    client.emit(HttpApiEvent.SessionLoggedOut, {})
    client.emit(HttpApiEvent.SessionLoggedOut, {})
    await flush()
    expect(onRevoked).toHaveBeenCalledOnce()
    expect(client.clearStores).toHaveBeenCalledOnce()
  })

  it('stillSignsOutWhenClearingTheCryptoStoreFails', async () => {
    const client = fakeClient(async () => {
      throw new Error('IndexedDB indisponible')
    })
    const storage = fakeStorage({ 'bf.session': 'jeton' })
    const onRevoked = vi.fn()
    watchForRevocation(client as never, onRevoked, storage)
    client.emit(HttpApiEvent.SessionLoggedOut, {})
    await flush()
    expect(storage.data.size).toBe(0) // le jeton local est effacé quoi qu'il arrive
    expect(onRevoked).toHaveBeenCalledOnce()
  })
})