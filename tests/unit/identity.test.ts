import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ANONYMOUS_COLORS,
  getAnonymousIdentity,
} from '@/features/collaboration/identity'

function memoryStorage(initial?: string) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set('design-weekly-identity', initial)

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  }
}

describe('getAnonymousIdentity', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('persists the same anonymous identity in browser storage', () => {
    const storage = memoryStorage()

    expect(getAnonymousIdentity(storage)).toEqual(getAnonymousIdentity(storage))
  })

  it.each([
    ['malformed JSON', '{not-json'],
    [
      'an invalid or injected shape',
      JSON.stringify({
        id: '<script>alert(1)</script>',
        name: { toString: '访客 123' },
        color: 'url(javascript:alert(1))',
      }),
    ],
  ])('replaces %s instead of throwing', (_label, existing) => {
    const storage = memoryStorage(existing)
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '11111111-1111-4111-8111-111111111111',
    )

    const identity = getAnonymousIdentity(storage)

    expect(identity).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      name: expect.stringMatching(/^访客 \d{3}$/),
      color: expect.stringMatching(/^#[0-9a-f]{6}$/),
    })
    expect(JSON.parse(storage.values.get('design-weekly-identity') ?? '')).toEqual(identity)
  })

  it('keeps a session identity when storage reads throw', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new DOMException('blocked', 'SecurityError')
      }),
      setItem: vi.fn(),
    }

    const first = getAnonymousIdentity(storage)

    expect(getAnonymousIdentity(storage)).toEqual(first)
    expect(storage.setItem).toHaveBeenCalledOnce()
  })

  it('keeps a session identity when storage writes throw', () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException('full', 'QuotaExceededError')
      }),
    }

    const first = getAnonymousIdentity(storage)

    expect(getAnonymousIdentity(storage)).toEqual(first)
    expect(storage.setItem).toHaveBeenCalledOnce()
  })

  it('uses getRandomValues when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: vi.fn((bytes: Uint8Array) => {
        bytes.fill(7)
        return bytes
      }),
    })

    expect(getAnonymousIdentity(memoryStorage()).id).toBe(
      '07070707-0707-4707-8707-070707070707',
    )
  })

  it('uses a stable non-secure session fallback when crypto and storage are unavailable', () => {
    vi.stubGlobal('crypto', undefined)
    const storage = {
      getItem: vi.fn(() => {
        throw new DOMException('blocked', 'SecurityError')
      }),
      setItem: vi.fn(() => {
        throw new DOMException('blocked', 'SecurityError')
      }),
    }

    const first = getAnonymousIdentity(storage)

    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(getAnonymousIdentity(storage)).toEqual(first)
  })
})

describe('anonymous presence colors', () => {
  it('uses the reviewed dark palette', () => {
    expect(ANONYMOUS_COLORS).toEqual([
      '#2447a8',
      '#8f3228',
      '#176058',
      '#5c388f',
      '#74430a',
    ])
  })

  it.each(ANONYMOUS_COLORS)('%s has at least 4.5:1 contrast with caret label text', (color) => {
    expect(contrastRatio(color, '#f7f7f7')).toBeGreaterThanOrEqual(4.5)
  })
})

function contrastRatio(first: string, second: string) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => b - a,
  )
  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
  if (!channels || channels.length !== 3) throw new Error(`Invalid test color: ${hex}`)

  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}
