// @vitest-environment node

import { HocuspocusProvider } from '@hocuspocus/provider'
import Database from 'better-sqlite3'
import * as Y from 'yjs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCollaborationServer } from '../../server/collaboration-server'
import { DocumentRepository } from '@/server/db/documents-repository'
import { IssueRepository } from '@/server/db/issues-repository'
import { migrate } from '@/server/db/schema'
import { SnapshotRepository } from '@/server/db/snapshots-repository'
import { createInternalRestoreOperation } from '@/features/snapshots/internal-rpc'
import { SnapshotService } from '@/features/snapshots/service'

const NOW = new Date('2026-07-16T00:00:00.000Z')
const CURRENT_ISSUE = 'issue-2026-07-13'

describe('collaboration server without a network listener', () => {
  it('binds to loopback by default', () => {
    const db = new Database(':memory:')
    migrate(db)
    const server = createCollaborationServer(db)

    expect(server.hocuspocus.configuration.address).toBe('127.0.0.1')
    db.close()
  })

  it('accepts only the current issue document and persists its Yjs state', async () => {
    const db = new Database(':memory:')
    migrate(db)
    new IssueRepository(db).ensureCurrent(NOW)
    const server = createCollaborationServer({ db, port: 0, now: () => NOW })

    try {
      const current = await server.hocuspocus.openDirectConnection(CURRENT_ISSUE)
      await current.transact((document) => {
        document.getText('content').insert(0, '共同编辑')
      })
      await current.disconnect()

      const saved = new DocumentRepository(db).load(CURRENT_ISSUE)
      expect(saved).not.toBeNull()
      const restored = new Y.Doc()
      Y.applyUpdate(restored, saved!)
      expect(restored.getText('content').toString()).toBe('共同编辑')

      await expect(server.hocuspocus.openDirectConnection('issue-2026-07-06')).rejects.toThrow(
        /current issue/i,
      )
    } finally {
      db.close()
    }
  })

  it('stores an isolated full snapshot at 200 updates and resets the policy', async () => {
    const db = new Database(':memory:')
    migrate(db)
    new IssueRepository(db).ensureCurrent(NOW)
    const server = createCollaborationServer({ db, port: 0, now: () => NOW })
    const connection = await server.hocuspocus.openDirectConnection(CURRENT_ISSUE)

    try {
      for (let update = 0; update < 200; update += 1) {
        await connection.transact((document) => {
          document.getText('content').insert(update, 'x')
        })
      }

      const snapshots = new SnapshotRepository(db)
      await vi.waitFor(() => {
        expect(snapshots.list(CURRENT_ISSUE)).toEqual([
          expect.objectContaining({ reason: 'volume', updateCount: 200 }),
        ])
      })

      const snapshot = snapshots.get(snapshots.list(CURRENT_ISSUE)[0].id)!
      const restored = new Y.Doc()
      Y.applyUpdate(restored, snapshot.state)
      expect(restored.getText('content').toString()).toHaveLength(200)

      await connection.transact((document) => {
        document.getText('content').insert(200, 'y')
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(snapshots.list(CURRENT_ISSUE)).toHaveLength(1)
      expect(snapshots.list('issue-other')).toEqual([])
    } finally {
      await connection.disconnect()
      db.close()
    }
  })

  it('rejects inbound changes after a connected issue becomes historical', async () => {
    const db = new Database(':memory:')
    migrate(db)
    const issues = new IssueRepository(db)
    issues.ensureCurrent(NOW)
    const server = createCollaborationServer({ db, port: 0, now: () => NOW })
    const guard = server.hocuspocus.configuration.extensions.find(
      (extension) => extension.extensionName === 'current-issue-guard',
    )

    try {
      expect(guard?.beforeHandleMessage).toBeTypeOf('function')
      issues.ensureCurrent(new Date('2026-07-20T00:00:00.000Z'))

      await expect(
        guard!.beforeHandleMessage!({ documentName: CURRENT_ISSUE } as never),
      ).rejects.toThrow(/current issue/i)
    } finally {
      db.close()
    }
  })

  it('flushes an accepted current-issue update after rollover archives it', async () => {
    const db = new Database(':memory:')
    migrate(db)
    const issues = new IssueRepository(db)
    issues.ensureCurrent(NOW)
    const server = createCollaborationServer({ db, port: 0, now: () => NOW })
    const connection = await server.hocuspocus.openDirectConnection(CURRENT_ISSUE)

    try {
      await connection.transact((document) => {
        document.getText('content').insert(0, '归档前最后编辑')
      })
      issues.ensureCurrent(new Date('2026-07-20T00:00:00.000Z'))
      await connection.disconnect()

      const saved = new DocumentRepository(db).load(CURRENT_ISSUE)
      expect(saved).not.toBeNull()
      const restored = new Y.Doc()
      Y.applyUpdate(restored, saved!)
      expect(restored.getText('content').toString()).toBe('归档前最后编辑')
    } finally {
      await connection.disconnect()
      db.close()
    }
  })
})

describe('authoritative restore RPC', () => {
  it('restores the live document in the collaboration process and later stores cannot overwrite it', async () => {
    const db = new Database(':memory:')
    migrate(db)
    const issues = new IssueRepository(db)
    const snapshots = new SnapshotRepository(db)
    const documents = new DocumentRepository(db)
    issues.ensureCurrent(NOW)
    const selected = new Y.Doc()
    selected.getText('content').insert(0, '选中的历史内容')
    const snapshotId = snapshots.create({
      issueId: CURRENT_ISSUE,
      state: Y.encodeStateAsUpdate(selected),
      reason: 'interval',
      updateCount: 4,
      createdAt: NOW,
    })
    const server = createCollaborationServer({ db, port: 0, now: () => NOW })
    const live = await server.hocuspocus.openDirectConnection(CURRENT_ISSUE)
    const restore = createInternalRestoreOperation({
      provider: server.hocuspocus,
      service: new SnapshotService({ db, documents, issues, snapshots }),
      snapshots,
      token: 'test-internal-token',
    })

    try {
      await live.transact((document) => {
        document.getText('content').insert(0, '稍后可能覆盖的现场内容')
      })
      const response = await restore('Bearer test-internal-token', {
        issueId: CURRENT_ISSUE,
        snapshotId,
      })

      expect(response.status).toBe(201)
      expect(live.document!.getText('content').toString()).toBe('选中的历史内容')
      expect(snapshots.list(CURRENT_ISSUE)[0]).toMatchObject({ reason: 'manual' })
      await live.disconnect()
      const persisted = new Y.Doc()
      Y.applyUpdate(persisted, documents.load(CURRENT_ISSUE)!)
      expect(persisted.getText('content').toString()).toBe('选中的历史内容')
    } finally {
      await live.disconnect()
      await server.destroy()
      db.close()
    }
  })

  it('rejects missing or incorrect internal tokens without changing state', async () => {
    const db = new Database(':memory:')
    migrate(db)
    new IssueRepository(db).ensureCurrent(NOW)
    const issues = new IssueRepository(db)
    const snapshots = new SnapshotRepository(db)
    const documents = new DocumentRepository(db)
    issues.ensureCurrent(NOW)
    const server = createCollaborationServer({ db, port: 0 })
    const restore = createInternalRestoreOperation({
      provider: server.hocuspocus,
      service: new SnapshotService({ db, documents, issues, snapshots }),
      snapshots,
      token: 'correct-token',
    })
    try {
      const response = await restore('Bearer wrong-token', {
        issueId: CURRENT_ISSUE,
        snapshotId: 1,
      })
      expect(response.status).toBe(401)
    } finally {
      await server.destroy()
      db.close()
    }
  })
})

describe('collaboration server websocket integration', () => {
  const providers: HocuspocusProvider[] = []
  const databases: Database.Database[] = []
  const servers: ReturnType<typeof createCollaborationServer>[] = []

  afterEach(async () => {
    providers.splice(0).forEach((provider) => provider.destroy())
    await Promise.all(servers.splice(0).map((server) => server.destroy()))
    databases.splice(0).forEach((db) => db.close())
  })

  it('converges two providers editing the current issue', async () => {
    const db = new Database(':memory:')
    databases.push(db)
    migrate(db)
    new IssueRepository(db).ensureCurrent(NOW)

    const server = createCollaborationServer({ db, port: 0, now: () => NOW })
    servers.push(server)
    await server.listen()

    const url = `ws://127.0.0.1:${server.address.port}`
    const firstDocument = new Y.Doc()
    const secondDocument = new Y.Doc()
    const first = new HocuspocusProvider({ name: CURRENT_ISSUE, url, document: firstDocument })
    const second = new HocuspocusProvider({ name: CURRENT_ISSUE, url, document: secondDocument })
    providers.push(first, second)

    await Promise.all([waitUntilSynced(first), waitUntilSynced(second)])
    firstDocument.getText('content').insert(0, '共同编辑')

    await vi.waitFor(() => {
      expect(secondDocument.getText('content').toString()).toBe('共同编辑')
    })
  })

  it('flushes the last accepted provider update when rollover closes the archived issue', async () => {
    const db = new Database(':memory:')
    databases.push(db)
    migrate(db)
    const issues = new IssueRepository(db)
    issues.ensureCurrent(NOW)

    const server = createCollaborationServer({ db, port: 0, now: () => NOW })
    servers.push(server)
    await server.listen()

    const document = new Y.Doc()
    const provider = new HocuspocusProvider({
      name: CURRENT_ISSUE,
      url: `ws://127.0.0.1:${server.address.port}`,
      document,
    })
    providers.push(provider)
    await waitUntilSynced(provider)

    document.getText('content').insert(0, '归档前最后编辑')
    await vi.waitFor(() => {
      expect(provider.hasUnsyncedChanges).toBe(false)
    })
    issues.ensureCurrent(new Date('2026-07-20T00:00:00.000Z'))
    server.hocuspocus.closeConnections(CURRENT_ISSUE)

    const documents = new DocumentRepository(db)
    await vi.waitFor(() => {
      const saved = documents.load(CURRENT_ISSUE)
      expect(saved).not.toBeNull()
      const restored = new Y.Doc()
      Y.applyUpdate(restored, saved!)
      expect(restored.getText('content').toString()).toBe('归档前最后编辑')
    })

    await expect(withTimeout(server.destroy(), 2_000)).resolves.toBeUndefined()
    servers.splice(servers.indexOf(server), 1)
  })
})

function waitUntilSynced(provider: HocuspocusProvider): Promise<void> {
  if (provider.synced) return Promise.resolve()

  return new Promise((resolve) => {
    const handleSynced = ({ state }: { state: boolean }) => {
      if (!state) return
      provider.off('synced', handleSynced)
      resolve()
    }
    provider.on('synced', handleSynced)
  })
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const rejection = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`Timed out after ${milliseconds}ms`)),
      milliseconds,
    )
  })

  return Promise.race([promise, rejection]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}
