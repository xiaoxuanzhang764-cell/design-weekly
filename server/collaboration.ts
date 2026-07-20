import { createRepositories } from '@/server/db/client'
import { createIssueTemplateState } from '@/features/issues/template'
import { createInternalEnsureCurrentExtension } from '@/features/issues/internal-lifecycle-rpc'
import {
  createCollaborationArchiveCoordinator,
  IssueLifecycleService,
} from '@/features/issues/lifecycle'
import { createTestRolloverExtension } from '@/features/issues/test-rollover-rpc'
import { requireInternalToken } from '@/features/snapshots/internal-rpc'

import { createCollaborationServer } from './collaboration-server'
import { getCollaborationPort } from './config'

async function main() {
  const repositories = createRepositories()
  const internalToken = requireInternalToken()
  const initialIssue = repositories.issues.ensureCurrent(new Date())
  if (!repositories.documents.load(initialIssue.id)) {
    repositories.documents.save(initialIssue.id, createIssueTemplateState())
  }
  const server = createCollaborationServer({
    db: repositories.db,
    internalToken,
    port: getCollaborationPort(),
  })
  const lifecycle = new IssueLifecycleService({
    coordinator: createCollaborationArchiveCoordinator(server),
    db: repositories.db,
    documents: repositories.documents,
    issues: repositories.issues,
    snapshots: repositories.snapshots,
  })
  server.hocuspocus.configuration.extensions.unshift(
    createInternalEnsureCurrentExtension(lifecycle, internalToken),
  )
  if (process.env.COLLAB_TEST_ROLLOVER === '1') {
    server.hocuspocus.configuration.extensions.unshift(
      createTestRolloverExtension(lifecycle, internalToken),
    )
  }

  const rolloverTimer = setInterval(() => {
    void lifecycle.ensureCurrent(new Date()).catch((error) => {
      console.error('Issue rollover failed; it will be retried on the next check.', error)
    })
  }, 60_000)

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    clearInterval(rolloverTimer)
    await server.destroy()
    repositories.db.close()
  }

  for (const signal of ['SIGINT', 'SIGQUIT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown().finally(() => process.exit(0))
    })
  }

  try {
    await server.listen()
  } catch (error) {
    clearInterval(rolloverTimer)
    repositories.db.close()
    throw error
  }
}

void main().catch((error) => {
  console.error('Collaboration server failed to start.', error)
  process.exitCode = 1
})
