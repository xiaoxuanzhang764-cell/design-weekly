import { describe, expect, it } from 'vitest'

import {
  MediaValidationError,
  validateMediaContent,
  validateMedia,
} from '@/features/media/validation'

const MB = 1024 * 1024

describe('validateMedia', () => {
  it.each([
    ['image/jpeg', 20 * MB, 'image', 'jpg'],
    ['image/png', 1, 'image', 'png'],
    ['image/webp', 1, 'image', 'webp'],
    ['image/gif', 1, 'image', 'gif'],
    ['video/mp4', 250 * MB, 'video', 'mp4'],
    ['video/webm', 1, 'video', 'webm'],
  ] as const)('accepts %s at its limit', (type, size, kind, extension) => {
    expect(validateMedia({ type, size })).toEqual({ kind, extension })
  })

  it('rejects oversized images with a typed Chinese error', () => {
    expect(() => validateMedia({ type: 'image/png', size: 20 * MB + 1 })).toThrow(
      expect.objectContaining<Partial<MediaValidationError>>({
        code: 'IMAGE_TOO_LARGE',
        message: '图片不能超过 20 MB',
      }),
    )
  })

  it('rejects oversized videos with a typed Chinese error', () => {
    expect(() => validateMedia({ type: 'video/webm', size: 250 * MB + 1 })).toThrow(
      expect.objectContaining<Partial<MediaValidationError>>({
        code: 'VIDEO_TOO_LARGE',
        message: '视频不能超过 250 MB',
      }),
    )
  })

  it('rejects unsupported video without trusting its filename extension', () => {
    expect(() =>
      validateMedia({ type: 'video/quicktime', size: 1, name: 'pretend.mp4' }),
    ).toThrow(
      expect.objectContaining<Partial<MediaValidationError>>({
        code: 'UNSUPPORTED_VIDEO',
        message: '仅支持 MP4 或 WebM 视频',
      }),
    )
  })

  it('rejects unsupported images with a typed Chinese error', () => {
    expect(() => validateMedia({ type: 'image/svg+xml', size: 1 })).toThrow(
      expect.objectContaining<Partial<MediaValidationError>>({
        code: 'UNSUPPORTED_IMAGE',
        message: '仅支持 JPEG、PNG、WebP 或 GIF 图片',
      }),
    )
  })
})

describe('validateMediaContent', () => {
  it.each([
    ['image/jpeg', [0xff, 0xd8, 0xff]],
    ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ['image/gif', Array.from(new TextEncoder().encode('GIF89a'))],
    [
      'image/webp',
      Array.from(new TextEncoder().encode('RIFF0000WEBP')),
    ],
    [
      'video/mp4',
      [0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0],
    ],
    ['video/webm', [0x1a, 0x45, 0xdf, 0xa3]],
  ])('accepts a valid %s signature', (mimeType, bytes) => {
    expect(() => validateMediaContent(Uint8Array.from(bytes), mimeType)).not.toThrow()
  })

  it.each([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
  ])('rejects corrupt or disguised %s bytes', (mimeType) => {
    expect(() => validateMediaContent(new Uint8Array([0, 1, 2, 3]), mimeType)).toThrow(
      expect.objectContaining<Partial<MediaValidationError>>({
        code: 'INVALID_MEDIA_CONTENT',
        message: '文件内容与媒体格式不符',
      }),
    )
  })

  it('rejects a JPEG disguised with a PNG declaration', () => {
    expect(() =>
      validateMediaContent(new Uint8Array([0xff, 0xd8, 0xff]), 'image/png'),
    ).toThrow(expect.objectContaining({ code: 'INVALID_MEDIA_CONTENT' }))
  })
})
