import { mkdtemp, open, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LocalMediaStorage } from '@/server/storage/local-storage'

describe('LocalMediaStorage', () => {
  it('creates a server-owned dated path and writes exclusively', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-weekly-media-'))
    const storage = new LocalMediaStorage({
      root,
      now: () => new Date('2026-07-17T00:00:00.000Z'),
    })
    const id = '7d9b0c17-b4cb-4c80-aa83-743b47ec7108'

    const stored = await storage.put({
      id,
      bytes: new Uint8Array([1, 2, 3]),
      extension: 'png',
    })

    expect(stored.url).toBe(`/uploads/2026/07/${id}.png`)
    expect(stored.path).toBe(join(root, '2026', '07', `${id}.png`))
    await expect(readFile(stored.path)).resolves.toEqual(Buffer.from([1, 2, 3]))
    await expect(
      storage.put({ id, bytes: new Uint8Array([4]), extension: 'png' }),
    ).rejects.toMatchObject({ code: 'EEXIST' })
  })

  it.each([
    ['caller path', '../escape'],
    ['non UUID id', 'media-1'],
    ['unapproved extension', '7d9b0c17-b4cb-4c80-aa83-743b47ec7108.exe'],
  ])('rejects %s', async (_label, id) => {
    const root = await mkdtemp(join(tmpdir(), 'design-weekly-media-'))
    const storage = new LocalMediaStorage({ root })
    await expect(
      storage.put({ id, bytes: new Uint8Array(), extension: 'png' }),
    ).rejects.toThrow('Invalid media storage key')
  })

  it('only deletes paths created inside its root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-weekly-media-'))
    const storage = new LocalMediaStorage({ root })
    await expect(storage.delete(join(root, '..', 'outside.png'))).rejects.toThrow(
      'Invalid media storage path',
    )
  })

  it('removes its temporary file when writing fails before publication', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-weekly-media-'))
    const storage = new LocalMediaStorage({
      root,
      now: () => new Date('2026-07-17T00:00:00.000Z'),
      operations: {
        open: async (path, flags) => {
          const handle = await open(path, flags)
          return {
            close: () => handle.close(),
            sync: () => handle.sync(),
            writeFile: async () => {
              throw new Error('simulated write failure')
            },
          }
        },
      },
    })

    await expect(
      storage.put({
        id: '7d9b0c17-b4cb-4c80-aa83-743b47ec7108',
        bytes: new Uint8Array([1, 2, 3]),
        extension: 'png',
      }),
    ).rejects.toThrow('simulated write failure')
    await expect(readdir(join(root, '2026', '07'))).resolves.toEqual([])
  })

  it('removes the complete temp and never exposes a final file when rename fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-weekly-media-'))
    const storage = new LocalMediaStorage({
      root,
      now: () => new Date('2026-07-17T00:00:00.000Z'),
      operations: {
        rename: async () => {
          throw new Error('simulated rename failure')
        },
      },
    })

    await expect(
      storage.put({
        id: '7d9b0c17-b4cb-4c80-aa83-743b47ec7108',
        bytes: new Uint8Array([1, 2, 3]),
        extension: 'png',
      }),
    ).rejects.toThrow('simulated rename failure')
    await expect(readdir(join(root, '2026', '07'))).resolves.toEqual([])
  })
})
