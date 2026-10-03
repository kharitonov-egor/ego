import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MediaFileInput, StagedMedia } from '../../../shared/local'
import { persistFiles, transferredFiles } from './files'

function stubApi(fail: (input: MediaFileInput) => boolean): { deleted: string[][] } {
  const deleted: string[][] = []
  vi.stubGlobal('window', {
    api: {
      pathForFile: () => '',
      mediaStage: async (input: MediaFileInput): Promise<StagedMedia> => {
        if (fail(input)) throw new Error('Could not copy')
        return { localUri: `/media/${input.mediaId}`, size: input.data.byteLength }
      },
      mediaDeleteStaged: async (paths: string[]) => { deleted.push(paths) }
    }
  })
  return { deleted }
}

describe('persistFiles', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('stages every file in order', async () => {
    const { deleted } = stubApi(() => false)
    const persisted = await persistFiles([new File(['a'], 'a.txt', { type: 'text/plain' }), new File(['bb'], 'b.pdf', { type: 'application/pdf' })])
    expect(persisted?.map((item) => [item.attachment.fileName, item.attachment.kind, item.attachment.size])).toEqual([
      ['a.txt', 'file', 1], ['b.pdf', 'file', 2]
    ])
    expect(deleted).toEqual([])
  })

  it('deletes the copies that did stage when another file fails', async () => {
    const { deleted } = stubApi((input) => input.fileName === 'folder')
    const persisted = await persistFiles([new File(['a'], 'a.txt', { type: 'text/plain' }), new File([''], 'folder')])
    expect(persisted).toBeNull()
    expect(deleted).toHaveLength(1)
    expect(deleted[0]).toHaveLength(1)
    expect(deleted[0][0]).toMatch(/^\/media\//)
  })
})

describe('transferredFiles', () => {
  it('leaves out folders', () => {
    const photo = new File(['x'], 'photo.png', { type: 'image/png' })
    const item = (file: File, isDirectory: boolean): Pick<DataTransferItem, 'kind' | 'getAsFile'> & { webkitGetAsEntry: () => { isDirectory: boolean } } =>
      ({ kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => ({ isDirectory }) })
    const transfer = { items: [item(photo, false), item(new File([''], 'Projects'), true)] }
    expect(transferredFiles(transfer as unknown as DataTransfer)).toEqual([photo])
  })
})
