import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { LINK_PREVIEW_LIMITS } from '@/features/links/preview-limits'

export type LinkUrlErrorCode = 'INVALID_LINK_URL' | 'UNSAFE_LINK_URL'

export class LinkUrlValidationError extends Error {
  constructor(
    public readonly code: LinkUrlErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'LinkUrlValidationError'
  }
}

export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

export type PublicUrlLookup = (hostname: string) => Promise<ResolvedAddress[]>

const unsafe = () =>
  new LinkUrlValidationError('UNSAFE_LINK_URL', '链接地址不可访问')

function parseIpv4(address: string): number | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map(Number)
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null
  }
  return (
    ((octets[0] << 24) >>> 0) +
    (octets[1] << 16) +
    (octets[2] << 8) +
    octets[3]
  ) >>> 0
}

function ipv4InCidr(value: number, base: number, bits: number) {
  if (bits === 0) return true
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return (value & mask) === (base & mask)
}

function isPublicIpv4(address: string) {
  const value = parseIpv4(address)
  if (value === null) return false

  const excluded: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ]

  return !excluded.some(([base, bits]) =>
    ipv4InCidr(value, parseIpv4(base)!, bits),
  )
}

function parseIpv6(address: string): bigint | null {
  const normalized = address.toLowerCase().split('%')[0]
  if (normalized.includes('.')) return null
  const halves = normalized.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const omitted = 8 - left.length - right.length
  if ((halves.length === 1 && omitted !== 0) || omitted < 0) return null
  const groups = [...left, ...Array.from({ length: omitted }, () => '0'), ...right]
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null
  }
  return groups.reduce(
    (value, group) => (value << BigInt(16)) | BigInt(`0x${group}`),
    BigInt(0),
  )
}

function ipv6InCidr(value: bigint, base: bigint, bits: number) {
  if (bits === 0) return true
  const shift = BigInt(128 - bits)
  return value >> shift === base >> shift
}

function isPublicIpv6(address: string) {
  const value = parseIpv6(address)
  if (value === null) return false

  const mappedPrefix = BigInt(0xffff) << BigInt(32)
  if (value >> BigInt(32) === mappedPrefix >> BigInt(32)) {
    const ipv4 = Number(value & BigInt(0xffffffff))
    const dotted = [24, 16, 8, 0]
      .map((shift) => String((ipv4 >>> shift) & 0xff))
      .join('.')
    return isPublicIpv4(dotted)
  }

  // Currently allocated global-unicast space is 2000::/3. Treat every other
  // non-mapped range as reserved instead of trying to enumerate future blocks.
  if (!ipv6InCidr(value, parseIpv6('2000::')!, 3)) return false

  const excluded: Array<[string, number]> = [
    ['::', 128],
    ['::1', 128],
    ['64:ff9b:1::', 48],
    ['100::', 64],
    ['2001::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['3fff::', 20],
    ['fc00::', 7],
    ['fe80::', 10],
    ['fec0::', 10],
    ['ff00::', 8],
  ]

  return !excluded.some(([base, bits]) => ipv6InCidr(value, parseIpv6(base)!, bits))
}

export function isPublicIpAddress(address: string) {
  const family = isIP(address)
  if (family === 4) return isPublicIpv4(address)
  if (family === 6) return isPublicIpv6(address)
  return false
}

export function validatePublicHttpUrl(input: string | URL) {
  const raw = input instanceof URL ? input.href : input
  if (raw.length > LINK_PREVIEW_LIMITS.url) {
    throw new LinkUrlValidationError('INVALID_LINK_URL', '请输入有效的网页链接')
  }
  let url: URL
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input)
  } catch {
    throw new LinkUrlValidationError('INVALID_LINK_URL', '请输入有效的网页链接')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LinkUrlValidationError('INVALID_LINK_URL', '请输入有效的网页链接')
  }
  if (url.href.length > LINK_PREVIEW_LIMITS.url) {
    throw new LinkUrlValidationError('INVALID_LINK_URL', '请输入有效的网页链接')
  }
  if (url.username || url.password) throw unsafe()

  const hostname = url.hostname.toLowerCase()
  if (!hostname || hostname.endsWith('.')) throw unsafe()
  const unwrapped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
  const family = isIP(unwrapped)
  if (family > 0) {
    if (!isPublicIpAddress(unwrapped)) throw unsafe()
  } else if (!hostname.includes('.') || hostname === 'localhost') {
    throw unsafe()
  }

  return url
}

const defaultLookup: PublicUrlLookup = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true })
  return answers
    .filter((answer): answer is ResolvedAddress => answer.family === 4 || answer.family === 6)
    .map(({ address, family }) => ({ address, family }))
}

export async function resolvePublicHttpUrl(
  input: string | URL,
  lookup: PublicUrlLookup = defaultLookup,
) {
  const url = validatePublicHttpUrl(input)
  const hostname = url.hostname.startsWith('[')
    ? url.hostname.slice(1, -1)
    : url.hostname
  const family = isIP(hostname)
  let addresses: ResolvedAddress[]

  if (family === 4 || family === 6) {
    addresses = [{ address: hostname, family }]
  } else {
    try {
      addresses = await lookup(hostname)
    } catch {
      throw unsafe()
    }
  }

  if (
    addresses.length === 0 ||
    addresses.some(
      ({ address, family: addressFamily }) =>
        isIP(address) !== addressFamily || !isPublicIpAddress(address),
    )
  ) {
    throw unsafe()
  }

  return { url, addresses }
}
