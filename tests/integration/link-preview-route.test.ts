import { Readable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { createLinkPreviewPostHandler } from '@/app/api/link-preview/route'
import {
  createLinkPreviewFetcher,
  FetchPreviewError,
  PREVIEW_REQUEST_HEADERS,
} from '@/server/link-preview/fetch-preview'

const publicLookup = vi.fn(async () => [
  { address: '93.184.216.34', family: 4 as const },
])

function response(statusCode: number, body = '', headers: Record<string, string> = {}) {
  return {
    statusCode,
    headers,
    body: Readable.from([Buffer.from(body)]),
  }
}

describe('fetchLinkPreview', () => {
  it('requests identity transfer encoding and rejects compressed response bytes', async () => {
    expect(PREVIEW_REQUEST_HEADERS).toMatchObject({
      accept: 'text/html,application/xhtml+xml',
      'accept-encoding': 'identity',
    })
    const fetchPreview = createLinkPreviewFetcher({
      lookup: publicLookup,
      request: async () =>
        response(200, 'compressed bytes', {
          'content-type': 'text/html',
          'content-encoding': 'gzip',
        }),
    })

    await expect(fetchPreview('https://example.com')).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT_ENCODING',
    })
  })

  it('pins each validated redirect hop and parses bounded HTML metadata', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        response(302, '', { location: 'https://www.example.com/article' }),
      )
      .mockResolvedValueOnce(
        response(
          200,
          '<html><head><title>Fallback</title><meta property="og:title" content="Article"><meta name="description" content="Summary"><meta property="og:site_name" content="Example"><meta property="og:image" content="/cover.jpg"></head></html>',
          { 'content-type': 'text/html; charset=utf-8' },
        ),
      )
    const lookup = vi
      .fn()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '93.184.216.35', family: 4 }])
      .mockResolvedValueOnce([{ address: '93.184.216.35', family: 4 }])
    const fetchPreview = createLinkPreviewFetcher({ lookup, request })

    await expect(fetchPreview('https://example.com/start')).resolves.toEqual({
      title: 'Article',
      description: 'Summary',
      image: 'https://www.example.com/cover.jpg',
      siteName: 'Example',
      url: 'https://example.com/start',
    })
    expect(request.mock.calls.map(([call]) => call.address)).toEqual([
      '93.184.216.34',
      '93.184.216.35',
    ])
    expect(request.mock.calls.map(([call]) => call.url.href)).toEqual([
      'https://example.com/start',
      'https://www.example.com/article',
    ])
  })

  it('validates redirects and allows no more than three hops', async () => {
    const unsafeRequest = vi.fn().mockResolvedValue(
      response(302, '', { location: 'http://127.0.0.1/admin' }),
    )
    await expect(
      createLinkPreviewFetcher({ lookup: publicLookup, request: unsafeRequest })(
        'https://example.com',
      ),
    ).rejects.toMatchObject({ code: 'UNSAFE_LINK_URL' })
    expect(unsafeRequest).toHaveBeenCalledOnce()

    const loopingRequest = vi.fn().mockImplementation(({ url }) =>
      response(302, '', { location: new URL(`/next-${loopingRequest.mock.calls.length}`, url).href }),
    )
    await expect(
      createLinkPreviewFetcher({ lookup: publicLookup, request: loopingRequest })(
        'https://example.com',
      ),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REDIRECTS' })
    expect(loopingRequest).toHaveBeenCalledTimes(4)
  })

  it('rejects non-HTML and streams larger than 2 MB', async () => {
    const binary = createLinkPreviewFetcher({
      lookup: publicLookup,
      request: async () => response(200, 'not html', { 'content-type': 'image/png' }),
    })
    await expect(binary('https://example.com/file')).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    })

    const oversized = createLinkPreviewFetcher({
      lookup: publicLookup,
      request: async () => ({
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: Readable.from([
          Buffer.alloc(1024 * 1024),
          Buffer.alloc(1024 * 1024),
          Buffer.from('x'),
        ]),
      }),
    })
    await expect(oversized('https://example.com/large')).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    })
  })

  it('bounds metadata attrs from an HTML response close to 2 MB', async () => {
    const title = 't'.repeat(700_000)
    const description = 'd'.repeat(700_000)
    const siteName = 's'.repeat(500_000)
    const image = `https://example.com/${'i'.repeat(3_000)}`
    const html = `<meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:site_name" content="${siteName}"><meta property="og:image" content="${image}">`
    expect(Buffer.byteLength(html)).toBeLessThan(2 * 1024 * 1024)
    const fetchPreview = createLinkPreviewFetcher({
      lookup: publicLookup,
      request: async () => response(200, html, { 'content-type': 'text/html' }),
    })

    const preview = await fetchPreview('https://example.com/article')

    expect(preview.title).toHaveLength(200)
    expect(preview.description).toHaveLength(500)
    expect(preview.siteName).toHaveLength(100)
    expect(preview.image).toBeNull()
    expect(preview.url.length).toBeLessThanOrEqual(2048)
  })

  it('drops unsafe or non-HTTP preview images', async () => {
    const fetchWithImage = (image: string) =>
      createLinkPreviewFetcher({
        lookup: publicLookup,
        request: async () =>
          response(
            200,
            `<meta property="og:image" content="${image}"><title>Safe title</title>`,
            { 'content-type': 'text/html' },
          ),
      })('https://example.com')

    await expect(fetchWithImage('file:///etc/passwd')).resolves.toMatchObject({ image: null })
    await expect(fetchWithImage('http://127.0.0.1/secret')).resolves.toMatchObject({
      image: null,
    })
  })

  it('applies the abort deadline while DNS resolution is still pending', async () => {
    vi.useFakeTimers()
    try {
      const fetchPreview = createLinkPreviewFetcher({
        lookup: () => new Promise(() => undefined),
        request: vi.fn(),
        timeoutMs: 8_000,
      })
      const pending = fetchPreview('https://example.com')
      const rejection = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })

      await vi.advanceTimersByTimeAsync(8_000)

      await rejection
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('POST /api/link-preview', () => {
  it('returns structured 400 responses for malformed and unsafe input', async () => {
    const fetchPreview = vi.fn()
    const post = createLinkPreviewPostHandler({ fetchPreview })

    const malformed = await post(
      new Request('http://localhost/api/link-preview', {
        method: 'POST',
        body: '{',
      }),
    )
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({
      error: { code: 'INVALID_LINK_URL', message: '请输入有效的网页链接' },
    })

    const unsafe = await post(
      new Request('http://localhost/api/link-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'http://127.0.0.1' }),
      }),
    )
    expect(unsafe.status).toBe(400)
    expect(await unsafe.json()).toEqual({
      error: { code: 'UNSAFE_LINK_URL', message: '链接地址不可访问' },
    })
    expect(fetchPreview).not.toHaveBeenCalled()
  })

  it('returns preview JSON and maps upstream failures to a detail-free 502', async () => {
    const preview = {
      title: 'Article',
      description: null,
      image: null,
      siteName: 'Example',
      url: 'https://example.com',
    }
    const success = createLinkPreviewPostHandler({ fetchPreview: vi.fn(async () => preview) })
    const successResponse = await success(
      new Request('http://localhost/api/link-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: preview.url }),
      }),
    )
    expect(successResponse.status).toBe(200)
    expect(await successResponse.json()).toEqual(preview)

    const failure = createLinkPreviewPostHandler({
      fetchPreview: vi.fn(async () => {
        throw new FetchPreviewError('UPSTREAM_FAILURE', 'socket 10.0.0.2 refused')
      }),
    })
    const failureResponse = await failure(
      new Request('http://localhost/api/link-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: preview.url }),
      }),
    )
    expect(failureResponse.status).toBe(502)
    expect(await failureResponse.json()).toEqual({
      error: { code: 'LINK_PREVIEW_UNAVAILABLE', message: '链接预览暂时不可用' },
    })
  })
})
