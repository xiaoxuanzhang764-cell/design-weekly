import { randomUUID } from 'node:crypto'

import sharp from 'sharp'

import {
  MediaValidationError,
  validateMediaContent,
  validateMedia,
} from '@/features/media/validation'
import { getRepositories } from '@/server/db/client'
import type {
  CreateMediaInput,
  MediaRepository,
} from '@/server/db/media-repository'
import { IssueReadOnlyError } from '@/server/db/media-repository'
import { LocalMediaStorage } from '@/server/storage/local-storage'
import type { MediaStorage } from '@/server/storage/storage'

interface MediaRouteRepository {
  create(input: CreateMediaInput): void
  isCurrentIssue(issueId: string): boolean
}

export interface MediaRouteDependencies {
  media: MediaRouteRepository
  optimizeImage(bytes: Uint8Array): Promise<Uint8Array>
  storage: MediaStorage
  uuid(): string
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  retryable?: boolean,
) {
  return Response.json(
    { error: { code, message, ...(retryable === undefined ? {} : { retryable }) } },
    { status },
  )
}

function isFile(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value &&
      typeof value !== 'string' &&
      typeof value.arrayBuffer === 'function' &&
      typeof value.size === 'number' &&
      typeof value.type === 'string',
  )
}

async function cleanup(storage: MediaStorage, paths: string[]) {
  await Promise.allSettled(paths.toReversed().map((path) => storage.delete(path)))
}

export function createMediaPostHandler(dependencies: MediaRouteDependencies) {
  return async function post(request: Request): Promise<Response> {
    let body: FormData
    try {
      body = await request.formData()
    } catch {
      return errorResponse(400, 'INVALID_MULTIPART', '上传请求格式不正确')
    }

    const issueId = body.get('issueId')
    const file = body.get('file')
    if (typeof issueId !== 'string' || !issueId) {
      return errorResponse(400, 'ISSUE_REQUIRED', '缺少周刊标识')
    }
    if (!isFile(file)) {
      return errorResponse(400, 'FILE_REQUIRED', '请选择要上传的文件')
    }

    let mediaType: ReturnType<typeof validateMedia>
    try {
      mediaType = validateMedia(file)
    } catch (error) {
      if (error instanceof MediaValidationError) {
        return errorResponse(400, error.code, error.message)
      }
      throw error
    }

    if (!dependencies.media.isCurrentIssue(issueId)) {
      return errorResponse(403, 'ISSUE_READ_ONLY', '历史周刊不能添加媒体')
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    try {
      validateMediaContent(bytes, file.type)
    } catch (error) {
      if (error instanceof MediaValidationError) {
        return errorResponse(400, error.code, error.message)
      }
      throw error
    }
    const id = dependencies.uuid()
    const storedPaths: string[] = []

    try {
      const original = await dependencies.storage.put({
        id,
        bytes,
        extension: mediaType.extension,
      })
      storedPaths.push(original.path)

      let derived: Awaited<ReturnType<MediaStorage['put']>> | null = null
      if (mediaType.kind === 'image' && file.type !== 'image/gif') {
        let derivativeBytes: Uint8Array
        try {
          derivativeBytes = await dependencies.optimizeImage(bytes)
        } catch {
          throw new MediaValidationError(
            'INVALID_MEDIA_CONTENT',
            '文件内容与媒体格式不符',
          )
        }
        derived = await dependencies.storage.put({
          id: dependencies.uuid(),
          bytes: derivativeBytes,
          extension: 'webp',
        })
        storedPaths.push(derived.path)
      }

      dependencies.media.create({
        byteSize: file.size,
        createdAt: new Date().toISOString(),
        derivedUrl: derived?.url ?? null,
        id,
        issueId,
        kind: mediaType.kind,
        mimeType: file.type,
        originalUrl: original.url,
      })

      return Response.json(
        {
          id,
          url: derived?.url ?? original.url,
          kind: mediaType.kind,
          mimeType: file.type,
          byteSize: file.size,
        },
        { status: 201 },
      )
    } catch (error) {
      await cleanup(dependencies.storage, storedPaths)
      if (error instanceof IssueReadOnlyError) {
        return errorResponse(403, 'ISSUE_READ_ONLY', '历史周刊不能添加媒体')
      }
      if (error instanceof MediaValidationError) {
        return errorResponse(400, error.code, error.message)
      }
      return errorResponse(
        503,
        'MEDIA_STORAGE_UNAVAILABLE',
        '媒体暂时无法保存，请稍后重试',
        true,
      )
    }
  }
}

export async function optimizeImage(bytes: Uint8Array): Promise<Uint8Array> {
  return sharp(bytes).rotate().resize({ width: 1280 }).webp().toBuffer()
}

let handler: ReturnType<typeof createMediaPostHandler> | undefined

export async function POST(request: Request): Promise<Response> {
  const repositories = getRepositories()
  handler ??= createMediaPostHandler({
    media: repositories.media as MediaRepository,
    optimizeImage,
    storage: new LocalMediaStorage(),
    uuid: randomUUID,
  })
  return handler(request)
}
