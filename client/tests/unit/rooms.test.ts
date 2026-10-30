import { describe, expect, it, vi } from 'vitest'
import { createEncryptedRoom, sendText, toMxid } from '../../src/matrix/rooms.ts'

const fakeClient = () => ({
  sendTextMessage: vi.fn(async () => ({ event_id: '$evt:chat.localhost' })),
  createRoom: vi.fn(async (_options: unknown) => ({ room_id: '!room:chat.localhost' })),
})

describe('sendText', () => {
  it('emptyMessageIsRejected', async () => {
    const c = fakeClient()
    await expect(sendText(c as never, '!r:chat.localhost', '   ')).rejects.toThrow('EMPTY_MESSAGE')
    await expect(sendText(c as never, '!r:chat.localhost', '')).rejects.toThrow('EMPTY_MESSAGE')
    expect(c.sendTextMessage).not.toHaveBeenCalled()
  })

  it('sendsBodyVerbatimAndReturnsEventId', async () => {
    const c = fakeClient()
    const id = await sendText(c as never, '!r:chat.localhost', '  bonjour ministère  ')
    expect(id).toBe('$evt:chat.localhost')
    expect(c.sendTextMessage).toHaveBeenCalledWith('!r:chat.localhost', '  bonjour ministère  ')
  })
})

describe('toMxid', () => {
  it('acceptsLocalpartAndFullIdOfTheLocalServer', () => {
    expect(toMxid('awa.ouedraogo')).toBe('@awa.ouedraogo:chat.localhost')
    expect(toMxid('@awa.ouedraogo:chat.localhost')).toBe('@awa.ouedraogo:chat.localhost')
    expect(toMxid('  moussa.sawadogo ')).toBe('@moussa.sawadogo:chat.localhost')
  })

  it('rejectsOtherServersAndMalformedInput', () => {
    for (const bad of ['@x:evil.org', 'a/b', 'Awa Ouedraogo', '', '@:chat.localhost', 'a'.repeat(33)]) {
      expect(() => toMxid(bad), bad).toThrow('INVALID_USER')
    }
  })
})

describe('createEncryptedRoom', () => {
  it('createsPrivateRoomWithEncryptionInInitialStateAndInvites', async () => {
    const c = fakeClient()
    const id = await createEncryptedRoom(c as never, { name: 'Cabinet', invite: ['moussa.sawadogo'] })
    expect(id).toBe('!room:chat.localhost')
    const opts = c.createRoom.mock.calls[0][0] as {
      name: string
      invite: string[]
      visibility: string
      initial_state: Array<{ type: string; content: { algorithm: string } }>
    }
    expect(opts.name).toBe('Cabinet')
    expect(opts.invite).toEqual(['@moussa.sawadogo:chat.localhost'])
    expect(opts.visibility).toBe('private')
    expect(opts.initial_state).toContainEqual({
      type: 'm.room.encryption',
      state_key: '',
      content: { algorithm: 'm.megolm.v1.aes-sha2' },
    })
  })

  it('rejectsEmptyNameAndBadInviteWithoutCallingTheServer', async () => {
    const c = fakeClient()
    await expect(createEncryptedRoom(c as never, { name: ' ', invite: [] })).rejects.toThrow('EMPTY_ROOM_NAME')
    await expect(createEncryptedRoom(c as never, { name: 'X', invite: ['@x:evil.org'] })).rejects.toThrow('INVALID_USER')
    expect(c.createRoom).not.toHaveBeenCalled()
  })
})