import Database from 'better-sqlite3'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createMediaPostHandler,
  optimizeImage,
} from '@/app/api/media/route'
import { createUploadGetHandler } from '@/app/uploads/[...path]/route'
import { MediaRepository } from '@/server/db/media-repository'
import { migrate } from '@/server/db/schema'
import type { MediaStorage } from '@/server/storage/storage'

const ISSUE_ID = 'issue-2026-07-13'
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

function requestFor(
  file: File,
  issueId = ISSUE_ID,
): Request {
  const body = new FormData()
  body.set('issueId', issueId)
  body.set('file', file)
  // jsdom's File/FormData constructors are intentionally used by this suite;
  // Node's Request parser rejects those cross-realm values before the handler.
  return { formData: async () => body } as Request
}

function createDatabase(status: 'current' | 'archived' = 'current') {
  const db = new Database(':memory:')
  migrate(db)
  db.prepare(`
    INSERT INTO issues(id, title, starts_at, ends_at, status)
    VALUES (?, '测试周刊', '2026-07-12T16:00:00.000Z', '2026-07-19T16:00:00.000Z', ?)
  `).run(ISSUE_ID, status)
  return db
}

function createStorage() {
  const paths: string[] = []
  const storage: MediaStorage = {
    put: vi.fn(async ({ id, extension }) => {
      const path = `/safe-root/${id}.${extension}`
      paths.push(path)
      return { path, url: `/uploads/2026/07/${id}.${extension}` }
    }),
    delete: vi.fn(async () => undefined),
  }
  return { paths, storage }
}

describe('POST /api/media', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('stores a PNG and its 1280 WebP derivative before inserting a ready row', async () => {
    const db = createDatabase()
    const media = new MediaRepository(db)
    const { storage } = createStorage()
    const optimized = new Uint8Array([0x52, 0x49, 0x46, 0x46])
    const handler = createMediaPostHandler({
      media,
      optimizeImage: vi.fn(async () => optimized),
      storage,
      uuid: vi
        .fn()
        .mockReturnValueOnce('7d9b0c17-b4cb-4c80-aa83-743b47ec7108')
        .mockReturnValueOnce('bc0da045-af3d-4993-b987-e218ff4f0563'),
    })
    const file = new File([PNG_BYTES], '../../client-name.exe', { type: 'image/png' })

    const response = await handler(requestFor(file))

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      id: '7d9b0c17-b4cb-4c80-aa83-743b47ec7108',
      url: '/uploads/2026/07/bc0da045-af3d-4993-b987-e218ff4f0563.webp',
      kind: 'image',
      mimeType: 'image/png',
      byteSize: PNG_BYTES.byteLength,
    })
    expect(storage.put).toHaveBeenNthCalledWith(1, {
      id: '7d9b0c17-b4cb-4c80-aa83-743b47ec7108',
      bytes: PNG_BYTES,
      extension: 'png',
    })
    expect(storage.put).toHaveBeenNthCalledWith(2, {
      id: 'bc0da045-af3d-4993-b987-e218ff4f0563',
      bytes: optimized,
      extension: 'webp',
    })
    expect(db.prepare('SELECT * FROM media').get()).toMatchObject({
      id: '7d9b0c17-b4cb-4c80-aa83-743b47ec7108',
      issue_id: ISSUE_ID,
      kind: 'image',
      original_url: '/uploads/2026/07/7d9b0c17-b4cb-4c80-aa83-743b47ec7108.png',
      derived_url: '/uploads/2026/07/bc0da045-af3d-4993-b987-e218ff4f0563.webp',
      status: 'ready',
    })
  })

  it('keeps animated GIFs and does not create a derivative', async () => {
    const db = createDatabase()
    const { storage } = createStorage()
    const optimize = vi.fn()
    const handler = createMediaPostHandler({
      media: new MediaRepository(db),
      optimizeImage: optimize,
      storage,
      uuid: () => '7d9b0c17-b4cb-4c80-aa83-743b47ec7108',
    })
    const gif = new File([new TextEncoder().encode('GIF89a')], 'moving.gif', {
      type: 'image/gif',
    })

    const response = await handler(requestFor(gif))

    expect(response.status).toBe(201)
    expect(optimize).not.toHaveBeenCalled()
    expect(storage.put).toHaveBeenCalledOnce()
    expect((await response.json()).url).toMatch(/\.gif$/)
  })

  it('rejects uploads bound to a historical issue', async () => {
    const { storage } = createStorage()
    const handler = createMediaPostHandler({
      media: new MediaRepository(createDatabase('archived')),
      optimizeImage: vi.fn(),
      storage,
      uuid: () => crypto.randomUUID(),
    })

    const response = await handler(
      requestFor(new File([PNG_BYTES], 'image.png', { type: 'image/png' })),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: { code: 'ISSUE_READ_ONLY', message: '历史周刊不能添加媒体' },
    })
    expect(storage.put).not.toHaveBeenCalled()
  })

  it('cleans storage if the issue becomes historical during upload', async () => {
    const db = createDatabase()
    const { storage } = createStorage()
    vi.mocked(storage.put).mockImplementationOnce(async ({ id, extension }) => {
      db.prepare("UPDATE issues SET status = 'archived' WHERE id = ?").run(ISSUE_ID)
      return {
        path: `/safe-root/${id}.${extension}`,
        url: `/uploads/2026/07/${id}.${extension}`,
      }
    })
    const handler = createMediaPostHandler({
      media: new MediaRepository(db),
      optimizeImage: vi.fn(async () => new Uint8Array([1])),
      storage,
      uuid: vi
        .fn()
        .mockReturnValueOnce('7d9b0c17-b4cb-4c80-aa83-743b47ec7108')
        .mockReturnValueOnce('bc0da045-af3d-4993-b987-e218ff4f0563'),
    })

    const response = await handler(
      requestFor(new File([PNG_BYTES], 'image.png', { type: 'image/png' })),
    )

    expect(response.status).toBe(403)
    expect(storage.delete).toHaveBeenCalledTimes(2)
    expect(db.prepare('SELECT COUNT(*) count FROM media').get()).toEqual({ count: 0 })
  })

  it('returns a structured 400 typed Chinese validation error', async () => {
    const { storage } = createStorage()
    const handler = createMediaPostHandler({
      media: new MediaRepository(createDatabase()),
      optimizeImage: vi.fn(),
      storage,
      uuid: crypto.randomUUID,
    })

    const response = await handler(
      requestFor(new File(['bad'], 'movie.mov', { type: 'video/quicktime' })),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: {
        code: 'UNSUPPORTED_VIDEO',
        message: '仅支持 MP4 或 WebM 视频',
      },
    })
  })

  it('rejects declared PNG content with a JPEG signature before storage', async () => {
    const { storage } = createStorage()
    const handler = createMediaPostHandler({
      media: new MediaRepository(createDatabase()),
      optimizeImage: vi.fn(),
      storage,
      uuid: crypto.randomUUID,
    })

    const response = await handler(
      requestFor(
        new File([new Uint8Array([0xff, 0xd8, 0xff])], 'disguised.png', {
          type: 'image/png',
        }),
      ),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: {
        code: 'INVALID_MEDIA_CONTENT',
        message: '文件内容与媒体格式不符',
      },
    })
    expect(storage.put).not.toHaveBeenCalled()
  })

  it('maps Sharp decode failure to content 400 and removes the stored original', async () => {
    const db = createDatabase()
    const { storage } = createStorage()
    const handler = createMediaPostHandler({
      media: new MediaRepository(db),
      optimizeImage: vi.fn(async () => {
        throw new Error('Input buffer has corrupt header')
      }),
      storage,
      uuid: () => '7d9b0c17-b4cb-4c80-aa83-743b47ec7108',
    })

    const response = await handler(
      requestFor(new File([PNG_BYTES], 'corrupt.png', { type: 'image/png' })),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: {
        code: 'INVALID_MEDIA_CONTENT',
        message: '文件内容与媒体格式不符',
      },
    })
    expect(storage.delete).toHaveBeenCalledOnce()
    expect(db.prepare('SELECT COUNT(*) count FROM media').get()).toEqual({ count: 0 })
  })

  it('returns retryable 503 and leaves no row when storage fails', async () => {
    const db = createDatabase()
    const { storage } = createStorage()
    vi.mocked(storage.put).mockRejectedValueOnce(new Error('disk full'))
    const handler = createMediaPostHandler({
      media: new MediaRepository(db),
      optimizeImage: vi.fn(),
      storage,
      uuid: () => '7d9b0c17-b4cb-4c80-aa83-743b47ec7108',
    })

    const response = await handler(
      requestFor(new File([PNG_BYTES], 'image.png', { type: 'image/png' })),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: {
        code: 'MEDIA_STORAGE_UNAVAILABLE',
        message: '媒体暂时无法保存，请稍后重试',
        retryable: true,
      },
    })
    expect(db.prepare('SELECT COUNT(*) count FROM media').get()).toEqual({ count: 0 })
  })

  it('removes every stored object if the database insert fails', async () => {
    const db = createDatabase()
    db.exec(`
      CREATE TRIGGER reject_media BEFORE INSERT ON media
      BEGIN SELECT RAISE(FAIL, 'database unavailable'); END;
    `)
    const { paths, storage } = createStorage()
    const handler = createMediaPostHandler({
      media: new MediaRepository(db),
      optimizeImage: vi.fn(async () => new Uint8Array([1])),
      storage,
      uuid: vi
        .fn()
        .mockReturnValueOnce('7d9b0c17-b4cb-4c80-aa83-743b47ec7108')
        .mockReturnValueOnce('bc0da045-af3d-4993-b987-e218ff4f0563'),
    })

    const response = await handler(
      requestFor(new File([PNG_BYTES], 'image.png', { type: 'image/png' })),
    )

    expect(response.status).toBe(503)
    expect(storage.delete).toHaveBeenCalledTimes(2)
    expect(vi.mocked(storage.delete).mock.calls.map(([path]) => path)).toEqual(
      paths.toReversed(),
    )
    expect(db.prepare('SELECT COUNT(*) count FROM media').get()).toEqual({ count: 0 })
  })
})

it('creates an actual 1280-pixel WebP derivative', async () => {
  const input = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: '#2447a8' },
  })
    .png()
    .toBuffer()

  const result = await optimizeImage(input)
  const metadata = await sharp(result).metadata()

  expect(metadata).toMatchObject({ format: 'webp', width: 1280, height: 720 })
})

describe('GET /uploads/[...path]', () => {
  it('serves a generated media URL from non-public storage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-weekly-serve-'))
    const directory = join(root, '2026', '07')
    const filename = '7d9b0c17-b4cb-4c80-aa83-743b47ec7108.png'
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, filename), PNG_BYTES)
    const get = createUploadGetHandler(root)

    const response = await get(new Request('http://localhost/uploads/test'), {
      params: Promise.resolve({ path: ['2026', '07', filename] }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES)
  })

  it.each([
    ['closed', 'bytes=2-5', [2, 3, 4, 5], 'bytes 2-5/10'],
    ['open', 'bytes=6-', [6, 7, 8, 9], 'bytes 6-9/10'],
    ['suffix', 'bytes=-3', [7, 8, 9], 'bytes 7-9/10'],
  ])('streams a valid %s byte range', async (_label, range, expected, contentRange) => {
    const root = await mkdtemp(join(tmpdir(), 'design-weekly-range-'))
    const directory = join(root, '2026', '07')
    const filename = '7d9b0c17-b4cb-4c80-aa83-743b47ec7108.mp4'
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, filename), Uint8Array.from({ length: 10 }, (_, i) => i))
    const get = createUploadGetHandler(root)

    const response = await get(
      new Request('http://localhost/uploads/test', { headers: { range } }),
      { params: Promise.resolve({ path: ['2026', '07', filename] }) },
    )

    expect(response.status).toBe(206)
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-range')).toBe(contentRange)
    expect(response.headers.get('content-length')).toBe(String(expected.length))
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(expected)
  })

  it.each(['bytes=10-20', 'bytes=7-2', 'bytes=0-1,3-4', 'items=0-1']) (
    'rejects invalid or multiple range %s',
    async (range) => {
      const root = await mkdtemp(join(tmpdir(), 'design-weekly-range-'))
      const directory = join(root, '2026', '07')
      const filename = '7d9b0c17-b4cb-4c80-aa83-743b47ec7108.mp4'
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, filename), new Uint8Array(10))
      const get = createUploadGetHandler(root)

      const response = await get(
        new Request('http://localhost/uploads/test', { headers: { range } }),
        { params: Promise.resolve({ path: ['2026', '07', filename] }) },
      )

      expect(response.status).toBe(416)
      expect(response.headers.get('content-range')).toBe('bytes */10')
    },
  )

  it('uses a file stream instead of buffering uploads with readFile', async () => {
    const source = await readFile(
      join(process.cwd(), 'src/app/uploads/[...path]/route.ts'),
      'utf8',
    )
    expect(source).toContain('createReadStream')
    expect(source).not.toMatch(/\bawait readFile\(/)
  })

  it.each([
    ['parent traversal', ['..', 'outside.png']],
    ['unexpected nesting', ['2026', '07', 'extra', 'media.png']],
    ['non-server filename', ['2026', '07', 'client.png']],
  ])('rejects %s', async (_label, path) => {
    const root = await mkdtemp(join(tmpdir(), 'design-weekly-serve-'))
    const get = createUploadGetHandler(root)
    const response = await get(new Request('http://localhost/uploads/test'), {
      params: Promise.resolve({ path }),
    })
    expect(response.status).toBe(404)
  })
})
