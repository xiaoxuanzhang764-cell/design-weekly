import { getRepositories } from '@/server/db/client'

import { createPersistenceArchiveCoordinator, IssueLifecycleService } from './lifecycle'

export async function ensureCurrentIssue(now = new Date()) {
  const repositories = getRepositories()
  const internalToken = process.env.COLLAB_INTERNAL_TOKEN
  if (internalToken) {
    const restoreUrl = process.env.COLLAB_INTERNAL_URL
      ?? `http://127.0.0.1:${process.env.COLLABORATION_PORT ?? '1234'}/internal/restore`
    const lifecycleUrl = new URL('/internal/ensure-current', restoreUrl)
    let response: Response
    try {
      response = await fetch(lifecycleUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${internalToken}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(1_500),
      })
    } catch {
      return ensureFromPersistence(repositories, now)
    }
    if (!response.ok) {
      throw new Error(`Collaboration lifecycle RPC failed: ${response.status}`)
    }
    return (await response.json()) as Awaited<ReturnType<IssueLifecycleService['ensureCurrent']>>
  }
  return ensureFromPersistence(repositories, now)
}

function ensureFromPersistence(
  repositories: ReturnType<typeof getRepositories>,
  now: Date,
) {
  return new IssueLifecycleService({
    coordinator: createPersistenceArchiveCoordinator(repositories.documents),
    db: repositories.db,
    documents: repositories.documents,
    issues: repositories.issues,
    snapshots: repositories.snapshots,
  }).ensureCurrent(now)
}
