import { createHash, timingSafeEqual } from 'node:crypto'

import type { Extension } from '@hocuspocus/server'

import type { IssueLifecycleService } from './lifecycle'

function tokenMatches(header: string | undefined, expected: string): boolean {
  const supplied = header?.startsWith('Bearer ') ? header.slice(7) : ''
  return expected.length > 0 && timingSafeEqual(
    createHash('sha256').update(supplied).digest(),
    createHash('sha256').update(expected).digest(),
  )
}

export function createInternalEnsureCurrentExtension(
  lifecycle: Pick<IssueLifecycleService, 'ensureCurrent'>,
  token: string,
): Extension {
  return {
    extensionName: 'internal-ensure-current-rpc',
    async onRequest({ request, response }) {
      if (request.url !== '/internal/ensure-current' || request.method !== 'POST') return
      if (!tokenMatches(request.headers.authorization, token)) {
        response.writeHead(401).end()
        throw null
      }
      const result = await lifecycle.ensureCurrent(new Date())
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(result))
      throw null
    },
  }
}
