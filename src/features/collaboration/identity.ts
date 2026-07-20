export interface AnonymousIdentity {
  id: string
  name: string
  color: string
}

const STORAGE_KEY = 'design-weekly-identity'
export const ANONYMOUS_COLORS = [
  '#2447a8',
  '#8f3228',
  '#176058',
  '#5c388f',
  '#74430a',
] as const
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const VISITOR_NAME_PATTERN = /^访客 \d{3}$/

type IdentityStorage = Pick<Storage, 'getItem' | 'setItem'>
const sessionIdentities = new WeakMap<IdentityStorage, AnonymousIdentity>()

function isAnonymousIdentity(value: unknown): value is AnonymousIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    UUID_PATTERN.test(candidate.id) &&
    typeof candidate.name === 'string' &&
    VISITOR_NAME_PATTERN.test(candidate.name) &&
    typeof candidate.color === 'string' &&
    ANONYMOUS_COLORS.includes(candidate.color as (typeof ANONYMOUS_COLORS)[number])
  )
}

function readIdentity(storage: IdentityStorage): AnonymousIdentity | null {
  try {
    const serialized = storage.getItem(STORAGE_KEY)
    if (!serialized) return null
    const parsed: unknown = JSON.parse(serialized)
    return isAnonymousIdentity(parsed) ? parsed : null
  } catch {
    return null
  }
}

function randomBytes(getByte: () => number) {
  return Uint8Array.from({ length: 16 }, getByte)
}

function uuidFromBytes(bytes: Uint8Array) {
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function createIdentityId() {
  const cryptoApi = globalThis.crypto

  if (typeof cryptoApi?.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID()
    } catch {
      // Continue to the byte-based fallback.
    }
  }

  if (typeof cryptoApi?.getRandomValues === 'function') {
    try {
      return uuidFromBytes(cryptoApi.getRandomValues(new Uint8Array(16)))
    } catch {
      // Browsers can expose crypto while denying access in constrained contexts.
    }
  }

  return uuidFromBytes(randomBytes(() => Math.floor(Math.random() * 256)))
}

export function getAnonymousIdentity(storage: IdentityStorage): AnonymousIdentity {
  const existing = readIdentity(storage)
  if (existing) {
    sessionIdentities.set(storage, existing)
    return existing
  }

  const sessionIdentity = sessionIdentities.get(storage)
  if (sessionIdentity) return sessionIdentity

  const number = Math.floor(Math.random() * 900) + 100
  const identity: AnonymousIdentity = {
    id: createIdentityId(),
    name: `访客 ${number}`,
    color: ANONYMOUS_COLORS[number % ANONYMOUS_COLORS.length],
  }
  sessionIdentities.set(storage, identity)
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(identity))
  } catch {
    // Identity remains stable for this browser session through the WeakMap.
  }
  return identity
}
