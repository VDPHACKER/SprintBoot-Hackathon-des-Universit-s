import { describe, expect, it, vi } from 'vitest'
import { downloadFile, sendFile } from '../../src/matrix/files.ts'

const fakeClient = (maxUpload: number) => ({
  getMediaConfig: vi.fn(async () => ({ 'm.upload.size': maxUpload })),
  uploadContent: vi.fn(),
  sendMessage: vi.fn(),
})

describe('sendFile', () => {
  it('emptyFileIsRejected', async () => {
    const c = fakeClient(1000)
    await expect(sendFile(c as never, '!r:chat.localhost', new Blob([]), 'vide.pdf')).rejects.toThrow('EMPTY_FILE')
    expect(c.uploadContent).not.toHaveBeenCalled()
  })

  it('oversizedFileIsRejectedBeforeAnyUpload', async () => {
    const c = fakeClient(10)
    await expect(sendFile(c as never, '!r:chat.localhost', new Blob([new Uint8Array(11)]), 'gros.bin')).rejects.toThrow(
      'FILE_TOO_LARGE',
    )
    expect(c.uploadContent).not.toHaveBeenCalled()
    expect(c.sendMessage).not.toHaveBeenCalled()
  })
})

describe('downloadFile', () => {
  it('nonFileEventIsRejected', async () => {
    const event = { getContent: () => ({ msgtype: 'm.text', body: 'bonjour' }) }
    await expect(downloadFile({} as never, event as never)).rejects.toThrow('NOT_A_FILE')
  })
})