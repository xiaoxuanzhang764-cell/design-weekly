import type { Server } from '@hocuspocus/server'
import type Database from 'better-sqlite3'
import * as Y from 'yjs'

import { getIssueId, getIssueWindow } from '@/features/issues/week'
import { createIssueTemplateState } from '@/features/issues/template'
import { SnapshotService } from '@/features/snapshots/service'
import type { DocumentRepository } from '@/server/db/documents-repository'
import type { IssueRepository } from '@/server/db/issues-repository'
import type { SnapshotRepository } from '@/server/db/snapshots-repository'

interface PreparedArchive {
  state: Uint8Array
  complete(nextIssueId: string): Promise<boolean | void>
  abort(): Promise<void>
}

export interface ArchiveCoordinator {
  prepare(issueId: string): Promise<PreparedArchive>
  notifyArchived(issueId: string, nextIssueId: string): Promise<boolean | void>
}

interface IssueLifecycleOptions {
  coordinator: ArchiveCoordinator
  db: Database.Database
  documents: Pick<DocumentRepository, 'load' | 'save'>
  issues: IssueRepository
  snapshots: SnapshotRepository
}

export class IssueLifecycleService {
  private readonly snapshotService: SnapshotService

  constructor(private readonly options: IssueLifecycleOptions) {
    this.snapshotService = new SnapshotService({
      issues: options.issues,
      snapshots: options.snapshots,
    })
  }

  async ensureCurrent(now: Date) {
    const expectedId = getIssueId(getIssueWindow(now))
    const current = this.options.issues.list().find(({ status }) => status === 'current')
    if (!current) {
      const issue = this.options.issues.ensureCurrent(now)
      this.options.documents.save(issue.id, createIssueTemplateState())
      return { issue, archivedIssueId: null }
    }

    if (current.id === expectedId) {
      const interrupted = this.options.issues.list().find(({ id, status }) =>
        status === 'archived' && !this.wasNotified(id),
      )
      if (interrupted) {
        if (!this.options.snapshots.findArchive(interrupted.id)) {
          const state = this.options.documents.load(interrupted.id) ?? Y.encodeStateAsUpdate(new Y.Doc())
          this.options.db.transaction(() => this.snapshotService.archive(interrupted.id, state, now)).immediate()
        }
        const notified = await this.options.coordinator.notifyArchived(interrupted.id, current.id)
        if (notified !== false) this.markNotified(interrupted.id, current.id, now)
        return { issue: current, archivedIssueId: interrupted.id }
      }
      return { issue: current, archivedIssueId: null }
    }

    let prepared: PreparedArchive | undefined
    try {
      prepared = await this.options.coordinator.prepare(current.id)
      let issue = current
      this.options.db.transaction(() => {
        this.options.documents.save(current.id, prepared!.state)
        issue = this.options.issues.ensureCurrent(now)
        if (!this.options.documents.load(issue.id)) {
          this.options.documents.save(issue.id, createIssueTemplateState())
        }
        this.snapshotService.archive(current.id, prepared!.state, now)
      }).immediate()
      const notified = await prepared.complete(issue.id)
      if (notified !== false) this.markNotified(current.id, issue.id, now)
      return { issue, archivedIssueId: current.id }
    } catch (error) {
      await prepared?.abort().catch(() => undefined)
      throw error
    }
  }

  private wasNotified(issueId: string): boolean {
    return Boolean(
      this.options.db.prepare('SELECT 1 FROM archive_notifications WHERE issue_id = ?').get(issueId),
    )
  }

  private markNotified(issueId: string, nextIssueId: string, now: Date): void {
    this.options.db.prepare(
      `INSERT OR REPLACE INTO archive_notifications(issue_id, next_issue_id, notified_at)
       VALUES(?, ?, ?)`,
    ).run(issueId, nextIssueId, now.toISOString())
  }
}

export function createPersistenceArchiveCoordinator(
  documents: Pick<DocumentRepository, 'load'>,
): ArchiveCoordinator {
  return {
    async prepare(issueId) {
      const state = documents.load(issueId) ?? Y.encodeStateAsUpdate(new Y.Doc())
      return {
        state,
        async complete() {
          // The collaboration process will reconcile the unnotified archive,
          // broadcast the next issue, and close any surviving old connections.
          return false
        },
        async abort() {},
      }
    },
    async notifyArchived() {
      return false
    },
  }
}

export function createCollaborationArchiveCoordinator(server: Server): ArchiveCoordinator {
  const coordinator: ArchiveCoordinator = {
    async prepare(issueId) {
      let connection: Awaited<ReturnType<Server['hocuspocus']['openDirectConnection']>> | undefined
      let document = server.hocuspocus.documents.get(issueId)
      if (!document) {
        connection = await server.hocuspocus.openDirectConnection(issueId)
        document = connection.document ?? undefined
      }
      if (!document) throw new Error(`Failed to load current issue: ${issueId}`)
      freezeIssue(server, issueId)
      let closed = false
      const abort = async () => {
        if (closed) return
        closed = true
        unfreezeIssue(server, issueId)
        await connection?.disconnect()
      }
      return {
        state: Y.encodeStateAsUpdate(document),
        async complete(nextIssueId) {
          await coordinator.notifyArchived(issueId, nextIssueId)
          await abort()
          return true
        },
        abort,
      }
    },
    async notifyArchived(issueId, nextIssueId) {
      const document = server.hocuspocus.documents.get(issueId)
      document?.broadcastStateless(JSON.stringify({ type: 'archived', nextIssueId }))
      server.hocuspocus.closeConnections(issueId)
      unfreezeIssue(server, issueId)
      return true
    },
  }
  return coordinator
}

const frozenByServer = new WeakMap<Server, Set<string>>()

export function registerFrozenIssues(server: Server, frozen: Set<string>): void {
  frozenByServer.set(server, frozen)
}

function freezeIssue(server: Server, issueId: string): void {
  frozenByServer.get(server)?.add(issueId)
}

function unfreezeIssue(server: Server, issueId: string): void {
  frozenByServer.get(server)?.delete(issueId)
}
