import { describe, expect, it, vi } from 'vitest'
import { sendVoice } from '../../src/lib/voice.ts'

const fakeClient = () => ({
  getMediaConfig: vi.fn(async () => ({ 'm.upload.size': 50_000_000 })),
  uploadContent: vi.fn(async (_file: unknown, _opts: unknown) => ({ content_uri: 'mxc://chat.localhost/abc' })),
  sendMessage: vi.fn(async (_roomId: string, _content: unknown) => ({ event_id: '$voice:chat.localhost' })),
})

describe('sendVoice', () => {
  it('sendVoiceUsesAudioMsgtype', async () => {
    const c = fakeClient()
    const id = await sendVoice(c as never, '!r:chat.localhost', new Blob([new Uint8Array(100).fill(7)], { type: 'audio/webm' }), 4200.4)
    expect(id).toBe('$voice:chat.localhost')

    const content = c.sendMessage.mock.calls[0][1] as { msgtype: string; body: string; info: Record<string, unknown>; file: Record<string, unknown> }
    expect(content.msgtype).toBe('m.audio')
    expect(content.info).toMatchObject({ mimetype: 'audio/webm', duration: 4200, size: 100 })
    expect(content.body).toMatch(/^message-vocal-.*\.webm$/)
    expect(content.file.url).toBe('mxc://chat.localhost/abc')
    expect(content.file.key, 'la clé de déchiffrement voyage dans le message chiffré').toBeDefined()
  })

  it('theMediaStoreOnlyReceivesCiphertextWithoutAFileName', async () => {
    const c = fakeClient()
    const clear = new Uint8Array(100).fill(7)
    await sendVoice(c as never, '!r', new Blob([clear], { type: 'audio/webm' }), 1000)
    const [uploaded, opts] = c.uploadContent.mock.calls[0] as [Blob, { includeFilename: boolean; type: string }]
    expect(opts).toMatchObject({ includeFilename: false, type: 'application/octet-stream' })
    expect(Buffer.from(await uploaded.arrayBuffer()).equals(Buffer.from(clear))).toBe(false)
  })

  it('emptyRecordingIsRejected', async () => {
    const c = fakeClient()
    await expect(sendVoice(c as never, '!r', new Blob([], { type: 'audio/webm' }), 0)).rejects.toThrow('EMPTY_FILE')
    expect(c.uploadContent).not.toHaveBeenCalled()
    expect(c.sendMessage).not.toHaveBeenCalled()
  })

  it('pickTheFileExtensionFromTheRecordedType', async () => {
    const c = fakeClient()
    await sendVoice(c as never, '!r', new Blob([new Uint8Array(10)], { type: 'audio/mp4' }), 500)
    await sendVoice(c as never, '!r', new Blob([new Uint8Array(10)], { type: '' }), 500)
    expect((c.sendMessage.mock.calls[0][1] as { body: string }).body).toMatch(/\.m4a$/)
    expect((c.sendMessage.mock.calls[1][1] as { body: string }).body).toMatch(/\.webm$/)
  })
})