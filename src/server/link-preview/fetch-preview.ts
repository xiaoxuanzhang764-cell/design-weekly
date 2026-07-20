import { load } from 'cheerio'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'

import {
  LINK_PREVIEW_LIMITS,
  sanitizePreviewText,
} from '@/features/links/preview-limits'

import {
  LinkUrlValidationError,
  resolvePublicHttpUrl,
  type PublicUrlLookup,
} from './validate-url'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
const TIMEOUT_MS = 8_000

export const PREVIEW_REQUEST_HEADERS = {
  accept: 'text/html,application/xhtml+xml',
  'accept-encoding': 'identity',
  'user-agent': 'DesignWeeklyLinkPreview/1.0',
} as const

export interface LinkPreview {
  title: string | null
  description: string | null
  image: string | null
  siteName: string | null
  url: string
}

export class FetchPreviewError extends Error {
  constructor(
    public readonly code:
      | 'UPSTREAM_FAILURE'
      | 'UPSTREAM_STATUS'
      | 'UNSUPPORTED_CONTENT'
      | 'UNSUPPORTED_CONTENT_ENCODING'
      | 'RESPONSE_TOO_LARGE'
      | 'TOO_MANY_REDIRECTS'
      | 'TIMEOUT',
    message = 'Link preview unavailable',
  ) {
    super(message)
    this.name = 'FetchPreviewError'
  }
}

export interface PreviewResponse {
  statusCode: number
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>
  body: AsyncIterable<Uint8Array> & { destroy?: () => void }
}

export type PreviewRequest = (input: {
  url: URL
  address: string
  family: 4 | 6
  signal: AbortSignal
}) => Promise<PreviewResponse>

function requestPinned({
  url,
  address,
  family,
  signal,
}: Parameters<PreviewRequest>[0]): Promise<PreviewResponse> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest
    const outgoing = request(
      url,
      {
        family,
        headers: PREVIEW_REQUEST_HEADERS,
        lookup: (_hostname, _options, callback) => {
          callback(null, address, family)
        },
        signal,
      },
      (incoming: IncomingMessage) => {
        resolve({
          statusCode: incoming.statusCode ?? 0,
          headers: incoming.headers,
          body: incoming,
        })
      },
    )
    outgoing.on('error', reject)
    outgoing.end()
  })
}

function headerValue(
  headers: PreviewResponse['headers'],
  name: string,
) {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

function isRedirect(statusCode: number) {
  return [301, 302, 303, 307, 308].includes(statusCode)
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new FetchPreviewError('TIMEOUT'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(new FetchPreviewError('TIMEOUT'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

async function readBoundedHtml(response: PreviewResponse) {
  const encoding = headerValue(response.headers, 'content-encoding')?.trim().toLowerCase()
  if (encoding && encoding !== 'identity') {
    response.body.destroy?.()
    throw new FetchPreviewError('UNSUPPORTED_CONTENT_ENCODING')
  }
  const type = headerValue(response.headers, 'content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase()
  if (type !== 'text/html' && type !== 'application/xhtml+xml') {
    response.body.destroy?.()
    throw new FetchPreviewError('UNSUPPORTED_CONTENT')
  }

  const declaredLength = Number(headerValue(response.headers, 'content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
    response.body.destroy?.()
    throw new FetchPreviewError('RESPONSE_TOO_LARGE')
  }

  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > MAX_BYTES) {
      response.body.destroy?.()
      throw new FetchPreviewError('RESPONSE_TOO_LARGE')
    }
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function metadataUrlValue(value: string | undefined) {
  const normalized = value?.trim()
  return normalized && normalized.length <= LINK_PREVIEW_LIMITS.url ? normalized : null
}

function parseMetadata(html: string) {
  try {
    const $ = load(html)
    return {
      title: sanitizePreviewText(
        $('meta[property="og:title"]').attr('content') ?? $('title').first().text(),
        LINK_PREVIEW_LIMITS.title,
      ),
      description: sanitizePreviewText(
        $('meta[property="og:description"]').attr('content') ??
          $('meta[name="description"]').attr('content'),
        LINK_PREVIEW_LIMITS.description,
      ),
      image: metadataUrlValue($('meta[property="og:image"]').attr('content')),
      siteName: sanitizePreviewText(
        $('meta[property="og:site_name"]').attr('content'),
        LINK_PREVIEW_LIMITS.siteName,
      ),
    }
  } catch {
    return { title: null, description: null, image: null, siteName: null }
  }
}

async function safeImageUrl(
  image: string | null,
  base: URL,
  lookup: PublicUrlLookup | undefined,
  signal: AbortSignal,
) {
  if (!image) return null
  try {
    const resolved = new URL(image, base)
    if (resolved.href.length > LINK_PREVIEW_LIMITS.url) return null
    await abortable(resolvePublicHttpUrl(resolved, lookup), signal)
    return resolved.href
  } catch (error) {
    if (signal.aborted || (error instanceof FetchPreviewError && error.code === 'TIMEOUT')) {
      throw new FetchPreviewError('TIMEOUT')
    }
    return null
  }
}

export function createLinkPreviewFetcher(dependencies: {
  lookup?: PublicUrlLookup
  request?: PreviewRequest
  timeoutMs?: number
} = {}) {
  const request = dependencies.request ?? requestPinned

  return async function fetchLinkPreview(input: string | URL): Promise<LinkPreview> {
    const original = input instanceof URL ? input.href : input
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? TIMEOUT_MS)
    let current: string | URL = input

    try {
      for (let redirects = 0; ; redirects += 1) {
        const { url, addresses } = await abortable(
          resolvePublicHttpUrl(current, dependencies.lookup),
          controller.signal,
        )
        const pinned = addresses[0]
        let response: PreviewResponse
        try {
          response = await abortable(
            Promise.resolve(
              request({
                url,
                address: pinned.address,
                family: pinned.family,
                signal: controller.signal,
              }),
            ),
            controller.signal,
          )
        } catch (error) {
          if (controller.signal.aborted) throw new FetchPreviewError('TIMEOUT')
          if (error instanceof LinkUrlValidationError) throw error
          throw new FetchPreviewError('UPSTREAM_FAILURE')
        }

        if (isRedirect(response.statusCode)) {
          response.body.destroy?.()
          const location = headerValue(response.headers, 'location')
          if (!location) throw new FetchPreviewError('UPSTREAM_STATUS')
          if (redirects >= MAX_REDIRECTS) {
            throw new FetchPreviewError('TOO_MANY_REDIRECTS')
          }
          try {
            current = new URL(location, url)
          } catch {
            throw new FetchPreviewError('UPSTREAM_STATUS')
          }
          continue
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.body.destroy?.()
          throw new FetchPreviewError('UPSTREAM_STATUS')
        }

        const metadata = parseMetadata(
          await abortable(readBoundedHtml(response), controller.signal),
        )
        return {
          ...metadata,
          image: await safeImageUrl(
            metadata.image,
            url,
            dependencies.lookup,
            controller.signal,
          ),
          url: new URL(original).href,
        }
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

export const fetchLinkPreview = createLinkPreviewFetcher()
