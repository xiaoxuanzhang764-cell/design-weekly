import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'

const UUID_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpg|png|webp|gif|mp4|webm)$/i
const CONTENT_TYPES: Record<string, string> = {
  gif: 'image/gif',
  jpg: 'image/jpeg',
  mp4: 'video/mp4',
  png: 'image/png',
  webm: 'video/webm',
  webp: 'image/webp',
}

interface UploadRouteContext {
  params: Promise<{ path: string[] }>
}

function notFound() {
  return new Response('Not Found', { status: 404 })
}

function parseRange(value: string, size: number): { end: number; start: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || size === 0) return null
  const [, startValue, endValue] = match
  if (!startValue && !endValue) return null

  if (!startValue) {
    const suffixLength = Number(endValue)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(startValue)
  const requestedEnd = endValue ? Number(endValue) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start >= size ||
    requestedEnd < start
  ) {
    return null
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}

export function createUploadGetHandler(
  configuredRoot = process.env.MEDIA_ROOT ?? './storage/uploads',
) {
  const root = resolve(configuredRoot)

  return async function get(
    request: Request,
    context: UploadRouteContext,
  ): Promise<Response> {
    const { path: segments } = await context.params
    if (
      segments.length !== 3 ||
      !/^\d{4}$/.test(segments[0]) ||
      !/^(0[1-9]|1[0-2])$/.test(segments[1]) ||
      !UUID_FILE.test(segments[2])
    ) {
      return notFound()
    }

    const path = join(root, ...segments)
    if (!path.startsWith(`${root}/`)) return notFound()

    try {
      const file = await stat(path)
      if (!file.isFile()) return notFound()
      const extension = segments[2].slice(segments[2].lastIndexOf('.') + 1).toLowerCase()
      const rangeHeader = request.headers.get('range')
      const range = rangeHeader ? parseRange(rangeHeader, file.size) : undefined
      if (rangeHeader && !range) {
        return new Response(null, {
          status: 416,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes */${file.size}`,
          },
        })
      }

      const start = range?.start ?? 0
      const end = range?.end ?? Math.max(0, file.size - 1)
      const contentLength = range ? end - start + 1 : file.size
      const nodeStream = createReadStream(path, range ? { start, end } : undefined)
      const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>
      return new Response(body, {
        status: range ? 206 : 200,
        headers: {
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Length': String(contentLength),
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${file.size}` } : {}),
          'Content-Type': CONTENT_TYPES[extension],
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch {
      return notFound()
    }
  }
}

export const dynamic = 'force-dynamic'
export const GET = createUploadGetHandler()
