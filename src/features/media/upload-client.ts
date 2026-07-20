import type { MediaKind } from './validation'

export interface UploadedMedia {
  byteSize: number
  id: string
  kind: MediaKind
  mimeType: string
  url: string
}

export class MediaUploadError extends Error {
  constructor(
    message: string,
    public readonly code = 'MEDIA_UPLOAD_FAILED',
    public readonly retryable = false,
  ) {
    super(message)
    this.name = 'MediaUploadError'
  }
}

export async function uploadMedia(
  file: File,
  issueId: string,
): Promise<UploadedMedia> {
  const body = new FormData()
  body.set('issueId', issueId)
  body.set('file', file)

  const response = await fetch('/api/media', { method: 'POST', body })
  const result = (await response.json().catch(() => null)) as
    | UploadedMedia
    | { error?: { code?: string; message?: string; retryable?: boolean } }
    | null
  if (!response.ok) {
    const error = result && 'error' in result ? result.error : undefined
    throw new MediaUploadError(
      error?.message ?? '媒体上传失败，请稍后重试',
      error?.code,
      error?.retryable,
    )
  }
  return result as UploadedMedia
}
