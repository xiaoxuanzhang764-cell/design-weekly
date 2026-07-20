import { describe, expect, it, vi } from 'vitest'

import {
  LinkUrlValidationError,
  resolvePublicHttpUrl,
  validatePublicHttpUrl,
} from '@/server/link-preview/validate-url'

describe('validatePublicHttpUrl', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/file',
    'https://user:secret@example.com/',
    'http://localhost/a',
    'http://localhost./a',
    'http://intranet/a',
    'http://127.0.0.1/a',
    'http://127.1/a',
    'http://2130706433/a',
    'http://017700000001/a',
    'http://0x7f000001/a',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.1/a',
    'http://100.64.0.1/a',
    'http://172.16.0.1/a',
    'http://192.0.2.1/a',
    'http://192.168.0.1/a',
    'http://198.18.0.1/a',
    'http://198.51.100.1/a',
    'http://203.0.113.1/a',
    'http://0.0.0.0/a',
    'http://224.0.0.1/a',
    'http://240.0.0.1/a',
    'http://[::]/a',
    'http://[::1]/a',
    'http://[::8.8.8.8]/a',
    'http://[::ffff:127.0.0.1]/a',
    'http://[fc00::1]/a',
    'http://[fe80::1]/a',
    'http://[fec0::1]/a',
    'http://[ff02::1]/a',
    'http://[2001:db8::1]/a',
    'http://[3fff::1]/a',
    'http://[4000::1]/a',
  ])('rejects non-public URL %s', (value) => {
    expect(() => validatePublicHttpUrl(value)).toThrow(LinkUrlValidationError)
  })

  it('accepts and normalizes a public HTTPS URL', () => {
    expect(validatePublicHttpUrl('https://Example.COM/a').href).toBe(
      'https://example.com/a',
    )
  })

  it('rejects input URLs longer than 2048 characters', () => {
    const value = `https://example.com/${'a'.repeat(2048)}`
    expect(() => validatePublicHttpUrl(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_LINK_URL' }),
    )
  })
})

describe('resolvePublicHttpUrl', () => {
  it('resolves all records once and returns a pinned public address', async () => {
    const lookup = vi.fn(async () => [
      { address: '93.184.216.34', family: 4 as const },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 as const },
    ])

    await expect(resolvePublicHttpUrl('https://example.com/a', lookup)).resolves.toEqual({
      url: new URL('https://example.com/a'),
      addresses: [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      ],
    })
    expect(lookup).toHaveBeenCalledOnce()
    expect(lookup).toHaveBeenCalledWith('example.com')
  })

  it('rejects the hostname when any A or AAAA answer is non-public', async () => {
    const lookup = vi.fn(async () => [
      { address: '93.184.216.34', family: 4 as const },
      { address: '127.0.0.1', family: 4 as const },
    ])

    await expect(resolvePublicHttpUrl('https://example.com', lookup)).rejects.toBeInstanceOf(
      LinkUrlValidationError,
    )
  })

  it('rejects failed and empty DNS answers without exposing resolver details', async () => {
    await expect(
      resolvePublicHttpUrl('https://example.com', async () => {
        throw new Error('resolver internal detail')
      }),
    ).rejects.toMatchObject({ code: 'UNSAFE_LINK_URL', message: '链接地址不可访问' })

    await expect(
      resolvePublicHttpUrl('https://example.com', async () => []),
    ).rejects.toMatchObject({ code: 'UNSAFE_LINK_URL', message: '链接地址不可访问' })
  })
})
