import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

import type { Extension } from '@hocuspocus/server'

import type { IssueLifecycleService } from './lifecycle'

function tokenMatches(header: string | undefined, expected: string): boolean {
  const supplied = header?.startsWith('Bearer ') ? header.slice(7) : ''
  return expected.length > 0 && timingSafeEqual(
    createHash('sha256').update(supplied).digest(),
    createHash('sha256').update(expected).digest(),
  )
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

export function createTestRolloverExtension(
  lifecycle: Pick<IssueLifecycleService, 'ensureCurrent'>,
  token: string,
): Extension {
  return {
    extensionName: 'test-rollover-rpc',
    async onRequest({ request, response }) {
      if (request.url !== '/internal/test/rollover' || request.method !== 'POST') return
      if (!tokenMatches(request.headers.authorization, token)) {
        response.writeHead(401).end()
        throw null
      }
      const body = await readJson(request)
      const nowValue = body && typeof body === 'object' ? (body as { now?: unknown }).now : null
      const now = typeof nowValue === 'string' ? new Date(nowValue) : new Date(Number.NaN)
      if (Number.isNaN(now.getTime())) {
        response.writeHead(400).end()
        throw null
      }
      const result = await lifecycle.ensureCurrent(now)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ nextIssueId: result.issue.id }))
      throw null
    },
  }
}
