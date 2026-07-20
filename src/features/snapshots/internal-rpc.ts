import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

import type { Extension, Server } from '@hocuspocus/server'

import { SnapshotService } from '@/features/snapshots/service'
import type { SnapshotRepository } from '@/server/db/snapshots-repository'

interface InternalRestoreDependencies {
  provider: Server['hocuspocus']
  service: SnapshotService
  snapshots: Pick<SnapshotRepository, 'get'>
  token: string
}

export function requireInternalToken(value = process.env.COLLAB_INTERNAL_TOKEN): string {
  const token = value ?? ''
  if (!/^[0-9a-f]{64}$/.test(token)) {
    throw new Error(
      'COLLAB_INTERNAL_TOKEN must be exactly 64 lowercase hexadecimal characters',
    )
  }
  return token
}

function tokenMatches(header: string | undefined, expected: string): boolean {
  const supplied = header?.startsWith('Bearer ') ? header.slice(7) : ''
  const suppliedDigest = createHash('sha256').update(supplied).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return expected.length > 0 && timingSafeEqual(suppliedDigest, expectedDigest)
}

export function createInternalRestoreOperation(dependencies: InternalRestoreDependencies) {
  return async (authorization: string | undefined, body: unknown) => {
    if (!tokenMatches(authorization, dependencies.token)) {
      return { status: 401, body: { error: { code: 'UNAUTHORIZED' } } }
    }
    if (!body || typeof body !== 'object') {
      return { status: 400, body: { error: { code: 'INVALID_REQUEST' } } }
    }
    const { issueId, snapshotId } = body as { issueId?: unknown; snapshotId?: unknown }
    if (typeof issueId !== 'string' || !Number.isInteger(snapshotId)) {
      return { status: 400, body: { error: { code: 'INVALID_REQUEST' } } }
    }
    try {
      const id = await dependencies.service.restore(
        issueId,
        Number(snapshotId),
        new Date(),
        dependencies.provider,
      )
      return { status: 201, body: { snapshot: dependencies.snapshots.get(id) } }
    } catch {
      return { status: 409, body: { error: { code: 'RESTORE_REJECTED' } } }
    }
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

export function createInternalRestoreExtension(
  operation: ReturnType<typeof createInternalRestoreOperation>,
): Extension {
  return {
    extensionName: 'internal-restore-rpc',
    async onRequest({ request, response }) {
      if (request.url !== '/internal/restore' || request.method !== 'POST') return
      const result = await operation(request.headers.authorization, await readJson(request))
      response.writeHead(result.status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(result.body))
      throw null
    },
  }
}
