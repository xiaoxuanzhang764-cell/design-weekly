import { describe, expect, it } from 'vitest'

import { requireInternalToken } from '@/features/snapshots/internal-rpc'

describe('requireInternalToken', () => {
  it.each([undefined, '', 'short', 'g'.repeat(64), 'a'.repeat(63), 'A'.repeat(64)])(
    'rejects a missing or malformed token: %s',
    (token) => {
      expect(() => requireInternalToken(token)).toThrow(
        'COLLAB_INTERNAL_TOKEN must be exactly 64 lowercase hexadecimal characters',
      )
    },
  )

  it('accepts exactly 64 lowercase hexadecimal characters', () => {
    const token = '0123456789abcdef'.repeat(4)
    expect(requireInternalToken(token)).toBe(token)
  })
})
