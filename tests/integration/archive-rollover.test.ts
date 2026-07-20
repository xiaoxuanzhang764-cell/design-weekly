// @vitest-environment node

import Database from 'better-sqlite3'
import * as Y from 'yjs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCollaborationServer } from '../../server/collaboration-server'
import {
  createCollaborationArchiveCoordinator,
  createPersistenceArchiveCoordinator,
  IssueLifecycleService,
} from '@/features/issues/lifecycle'
import { DocumentRepository } from '@/server/db/documents-repository'
import { IssueRepository } from '@/server/db/issues-repository'
import { migrate } from '@/server/db/schema'
import { SnapshotRepository } from '@/server/db/snapshots-repository'

const CURRENT_TIME = new Date('2026-07-16T00:00:00.000Z')
const NEXT_WEEK = new Date('2026-07-20T00:00:00.000Z')
const CURRENT_ISSUE = 'issue-2026-07-13'
const NEXT_ISSUE = 'issue-2026-07-20'

describe('automatic archive rollover', () => {
  const cleanups: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  })

  it('flushes pending state, creates a final snapshot, broadcasts the next issue, and is idempotent', async () => {
    const db = new Database(':memory:')
    migrate(db)
    const issues = new IssueRepository(db)
    const documents = new DocumentRepository(db)
    const snapshots = new SnapshotRepository(db)
    issues.ensureCurrent(CURRENT_TIME)
    const server = createCollaborationServer({ db, port: 0, now: () => NEXT_WEEK })
    const live = await server.hocuspocus.openDirectConnection(CURRENT_ISSUE)
    cleanups.push(async () => live.disconnect(), () => {
      db.close()
    })
    await live.transact((document) => {
      document.getText('content').insert(0, '归档前尚未刷新的编辑')
    })
    const broadcast = vi.spyOn(live.document!, 'broadcastStateless')
    const lifecycle = new IssueLifecycleService({
      db,
      documents,
      issues,
      snapshots,
      coordinator: createCollaborationArchiveCoordinator(server),
    })

    const first = await lifecycle.ensureCurrent(NEXT_WEEK)
    const second = await lifecycle.ensureCurrent(NEXT_WEEK)

    expect(first.issue.id).toBe(NEXT_ISSUE)
    expect(first.archivedIssueId).toBe(CURRENT_ISSUE)
    expect(second).toEqual({ issue: first.issue, archivedIssueId: null })
    expect(issues.list().filter(({ status }) => status === 'current')).toHaveLength(1)
    expect(issues.find(CURRENT_ISSUE)?.status).toBe('archived')
    const nextState = documents.load(NEXT_ISSUE)
    expect(nextState).not.toBeNull()
    const nextDocument = new Y.Doc()
    Y.applyUpdate(nextDocument, nextState!)
    expect(nextDocument.getXmlFragment('default').toString()).toContain('视觉设计分享')
    const persisted = documents.load(CURRENT_ISSUE)
    const archive = snapshots.list(CURRENT_ISSUE).filter(({ reason }) => reason === 'archive')
    expect(persisted).not.toBeNull()
    expect(archive).toHaveLength(1)

    const persistedDocument = new Y.Doc()
    Y.applyUpdate(persistedDocument, persisted!)
    expect(persistedDocument.getText('content').toString()).toBe('归档前尚未刷新的编辑')
    const archivedDocument = new Y.Doc()
    Y.applyUpdate(archivedDocument, snapshots.get(archive[0].id)!.state)
    expect(archivedDocument.getText('content').toString()).toBe('归档前尚未刷新的编辑')
    expect(broadcast).toHaveBeenCalledOnce()
    expect(JSON.parse(broadcast.mock.calls[0][0])).toEqual({
      type: 'archived',
      nextIssueId: NEXT_ISSUE,
    })
  })

  it('reconciles an archived issue whose final snapshot and notification were interrupted', async () => {
    const db = new Database(':memory:')
    migrate(db)
    const issues = new IssueRepository(db)
    const documents = new DocumentRepository(db)
    const snapshots = new SnapshotRepository(db)
    issues.ensureCurrent(CURRENT_TIME)
    const server = createCollaborationServer({ db, port: 0, now: () => NEXT_WEEK })
    const live = await server.hocuspocus.openDirectConnection(CURRENT_ISSUE)
    const broadcast = vi.spyOn(live.document!, 'broadcastStateless')
    const document = new Y.Doc()
    document.getText('content').insert(0, '已保存内容')
    documents.save(CURRENT_ISSUE, Y.encodeStateAsUpdate(document))
    issues.ensureCurrent(NEXT_WEEK)
    cleanups.push(async () => live.disconnect(), async () => server.destroy(), () => {
      db.close()
    })

    const result = await new IssueLifecycleService({
      coordinator: createCollaborationArchiveCoordinator(server),
      db,
      documents,
      issues,
      snapshots,
    }).ensureCurrent(NEXT_WEEK)

    expect(result.issue.id).toBe(NEXT_ISSUE)
    expect(snapshots.list(CURRENT_ISSUE)).toEqual([
      expect.objectContaining({ reason: 'archive' }),
    ])
    expect(broadcast).toHaveBeenCalledWith(JSON.stringify({
      type: 'archived',
      nextIssueId: NEXT_ISSUE,
    }))
  })

  it('lets a web request roll over from persisted state and leaves notification for collaboration recovery', async () => {
    const db = new Database(':memory:')
    migrate(db)
    const issues = new IssueRepository(db)
    const documents = new DocumentRepository(db)
    const snapshots = new SnapshotRepository(db)
    issues.ensureCurrent(CURRENT_TIME)
    const state = new Y.Doc()
    state.getText('content').insert(0, '网页访问前已保存')
    documents.save(CURRENT_ISSUE, Y.encodeStateAsUpdate(state))
    cleanups.push(() => db.close())

    const result = await new IssueLifecycleService({
      coordinator: createPersistenceArchiveCoordinator(documents),
      db,
      documents,
      issues,
      snapshots,
    }).ensureCurrent(NEXT_WEEK)

    expect(result.issue.id).toBe(NEXT_ISSUE)
    expect(issues.find(CURRENT_ISSUE)?.status).toBe('archived')
    expect(snapshots.findArchive(CURRENT_ISSUE)).not.toBeNull()
    expect(
      db.prepare('SELECT 1 FROM archive_notifications WHERE issue_id = ?').get(CURRENT_ISSUE),
    ).toBeUndefined()
  })
})
