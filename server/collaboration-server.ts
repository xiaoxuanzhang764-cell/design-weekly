import { Database as HocuspocusDatabase } from '@hocuspocus/extension-database'
import { Server, type Extension } from '@hocuspocus/server'
import type BetterSqlite3 from 'better-sqlite3'
import * as Y from 'yjs'

import { SnapshotPolicy } from '@/features/snapshots/policy'
import { registerFrozenIssues } from '@/features/issues/lifecycle'
import {
  createInternalRestoreExtension,
  createInternalRestoreOperation,
} from '@/features/snapshots/internal-rpc'
import { SnapshotService } from '@/features/snapshots/service'
import { DocumentRepository } from '@/server/db/documents-repository'
import { IssueRepository } from '@/server/db/issues-repository'
import { SnapshotRepository } from '@/server/db/snapshots-repository'

export interface CollaborationServerOptions {
  db: BetterSqlite3.Database
  address?: string
  port?: number
  now?: () => Date
  snapshotPolicy?: SnapshotPolicy
  internalToken?: string
}

export function createCollaborationServer(options: CollaborationServerOptions): Server
export function createCollaborationServer(db: BetterSqlite3.Database, port?: number): Server
export function createCollaborationServer(
  optionsOrDatabase: CollaborationServerOptions | BetterSqlite3.Database,
  legacyPort = 1234,
): Server {
  const options = normalizeOptions(optionsOrDatabase, legacyPort)
  const documents = new DocumentRepository(options.db)
  const issues = new IssueRepository(options.db)
  const snapshots = new SnapshotRepository(options.db)
  const policy = options.snapshotPolicy ?? new SnapshotPolicy()
  const now = options.now ?? (() => new Date())
  const frozenIssues = new Set<string>()

  const assertCurrentIssue = (documentName: string): void => {
    if (frozenIssues.has(documentName) || issues.find(documentName)?.status !== 'current') {
      throw new Error(`Only the current issue can be edited: ${documentName}`)
    }
  }

  const currentIssueGuard: Extension = {
    extensionName: 'current-issue-guard',
    priority: 1_000,
    async onConnect({ documentName }) {
      assertCurrentIssue(documentName)
    },
    async onLoadDocument({ documentName }) {
      assertCurrentIssue(documentName)
    },
    async beforeHandleMessage({ documentName }) {
      assertCurrentIssue(documentName)
    },
  }

  const snapshotExtension: Extension = {
    extensionName: 'snapshot-policy',
    async onChange({ document, documentName }) {
      const timestamp = now()
      const decision = policy.recordUpdate(documentName, timestamp)
      if (!decision.shouldSnapshot || !decision.reason) return

      snapshots.create({
        issueId: documentName,
        state: Y.encodeStateAsUpdate(document),
        reason: decision.reason,
        updateCount: decision.updateCount,
        createdAt: timestamp,
      })
      policy.markSnapshotted(documentName, timestamp)
    },
  }

  const server = new Server({
    name: 'design-weekly-collaboration',
    address: options.address ?? '127.0.0.1',
    port: options.port ?? 1234,
    stopOnSignals: false,
    timeout: 60_000,
    debounce: 2_000,
    maxDebounce: 10_000,
    quiet: true,
    websocketOptions: { maxPayload: 1_048_576 },
    extensions: [
      currentIssueGuard,
      new HocuspocusDatabase({
        fetch: async ({ documentName }) => {
          assertCurrentIssue(documentName)
          return documents.load(documentName)
        },
        store: async ({ documentName, state }) => {
          // A document can become historical while an accepted update is waiting for
          // the store debounce. Connection/load/message guards prevent new historical
          // writes; the already-loaded document must still be allowed to flush safely.
          documents.save(documentName, state)
        },
      }),
      snapshotExtension,
    ],
  })
  registerFrozenIssues(server, frozenIssues)
  if (options.internalToken) {
    const service = new SnapshotService({
      db: options.db,
      documents,
      issues,
      snapshots,
    })
    server.hocuspocus.configuration.extensions.unshift(
      createInternalRestoreExtension(
        createInternalRestoreOperation({
          provider: server.hocuspocus,
          service,
          snapshots,
          token: options.internalToken,
        }),
      ),
    )
  }
  return server
}

function normalizeOptions(
  optionsOrDatabase: CollaborationServerOptions | BetterSqlite3.Database,
  legacyPort: number,
): CollaborationServerOptions {
  if ('db' in optionsOrDatabase) return optionsOrDatabase
  return { db: optionsOrDatabase, port: legacyPort }
}
