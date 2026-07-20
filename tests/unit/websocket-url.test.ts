import { describe, expect, it } from 'vitest'
import { resolveCollaborationWebSocketUrl } from '@/features/collaboration/websocket-url'

describe('resolveCollaborationWebSocketUrl', () => {
  it.each([
    ['https:', 'weekly.up.railway.app', 'wss://weekly.up.railway.app/collaboration'],
    ['http:', '127.0.0.1:3000', 'ws://127.0.0.1:3000/collaboration'],
  ])('derives a same-origin URL for %s', (protocol, host, expected) => {
    expect(resolveCollaborationWebSocketUrl(undefined, { protocol, host })).toBe(expected)
  })

  it('preserves an explicit URL', () => {
    expect(resolveCollaborationWebSocketUrl('wss://collab.example.com', {
      protocol: 'https:',
      host: 'weekly.example.com',
    })).toBe('wss://collab.example.com')
  })
})
