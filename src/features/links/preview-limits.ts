export const LINK_PREVIEW_LIMITS = {
  url: 2_048,
  title: 200,
  siteName: 100,
  description: 500,
} as const

export function sanitizePreviewText(value: unknown, limit: number) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null
  let result = ''
  let length = 0
  for (const character of normalized) {
    if (length === limit) break
    result += character
    length += 1
  }
  return result
}

export function sanitizePreviewUrl(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.length > LINK_PREVIEW_LIMITS.url) return null
  try {
    const url = new URL(normalized)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href.length <= LINK_PREVIEW_LIMITS.url ? url.href : null
  } catch {
    return null
  }
}
