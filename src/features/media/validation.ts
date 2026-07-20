export type MediaKind = 'image' | 'video'

export type MediaValidationCode =
  | 'IMAGE_TOO_LARGE'
  | 'INVALID_MEDIA_CONTENT'
  | 'VIDEO_TOO_LARGE'
  | 'UNSUPPORTED_IMAGE'
  | 'UNSUPPORTED_VIDEO'

export class MediaValidationError extends Error {
  constructor(
    public readonly code: MediaValidationCode,
    message: string,
  ) {
    super(message)
    this.name = 'MediaValidationError'
  }
}

const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const

const VIDEO_TYPES = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
} as const

const IMAGE_LIMIT = 20 * 1024 * 1024
const VIDEO_LIMIT = 250 * 1024 * 1024

export interface MediaFileMetadata {
  name?: string
  size: number
  type: string
}

export function validateMedia(file: MediaFileMetadata): {
  kind: MediaKind
  extension: string
} {
  const imageExtension = IMAGE_TYPES[file.type as keyof typeof IMAGE_TYPES]
  if (imageExtension) {
    if (file.size > IMAGE_LIMIT) {
      throw new MediaValidationError('IMAGE_TOO_LARGE', '图片不能超过 20 MB')
    }
    return { kind: 'image', extension: imageExtension }
  }

  const videoExtension = VIDEO_TYPES[file.type as keyof typeof VIDEO_TYPES]
  if (videoExtension) {
    if (file.size > VIDEO_LIMIT) {
      throw new MediaValidationError('VIDEO_TOO_LARGE', '视频不能超过 250 MB')
    }
    return { kind: 'video', extension: videoExtension }
  }

  if (file.type.startsWith('video/')) {
    throw new MediaValidationError('UNSUPPORTED_VIDEO', '仅支持 MP4 或 WebM 视频')
  }

  throw new MediaValidationError(
    'UNSUPPORTED_IMAGE',
    '仅支持 JPEG、PNG、WebP 或 GIF 图片',
  )
}

function bytesEqual(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value)
}

function hasMp4FileTypeBox(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 4, 68)
  for (let typeOffset = 4; typeOffset <= limit; typeOffset += 1) {
    if (!bytesEqual(bytes, typeOffset, [0x66, 0x74, 0x79, 0x70])) continue
    const boxOffset = typeOffset - 4
    const boxSize =
      bytes[boxOffset] * 2 ** 24 +
      bytes[boxOffset + 1] * 2 ** 16 +
      bytes[boxOffset + 2] * 2 ** 8 +
      bytes[boxOffset + 3]
    if (boxSize >= 8 && boxOffset + boxSize <= bytes.length) return true
  }
  return false
}

export function validateMediaContent(bytes: Uint8Array, mimeType: string): void {
  const valid =
    (mimeType === 'image/jpeg' && bytesEqual(bytes, 0, [0xff, 0xd8, 0xff])) ||
    (mimeType === 'image/png' &&
      bytesEqual(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (mimeType === 'image/gif' &&
      (bytesEqual(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
        bytesEqual(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))) ||
    (mimeType === 'image/webp' &&
      bytesEqual(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
      bytesEqual(bytes, 8, [0x57, 0x45, 0x42, 0x50])) ||
    (mimeType === 'video/mp4' && hasMp4FileTypeBox(bytes)) ||
    (mimeType === 'video/webm' && bytesEqual(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3]))

  if (!valid) {
    throw new MediaValidationError(
      'INVALID_MEDIA_CONTENT',
      '文件内容与媒体格式不符',
    )
  }
}
