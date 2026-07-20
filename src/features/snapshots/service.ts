import * as Y from 'yjs'
import type Database from 'better-sqlite3'

import { SnapshotPolicy } from '@/features/snapshots/policy'
import type { IssueRepository } from '@/server/db/issues-repository'
import type { SnapshotRepository } from '@/server/db/snapshots-repository'
import type { DocumentRepository } from '@/server/db/documents-repository'

type SharedType = Y.XmlFragment | Y.Text | Y.Array<unknown> | Y.Map<unknown>

interface DirectConnection {
  transact(transaction: (document: Y.Doc) => void): Promise<void>
  disconnect(): Promise<void>
}

export interface DirectConnectionProvider {
  openDirectConnection(issueId: string): Promise<DirectConnection>
}

interface SnapshotServiceOptions {
  db?: Database.Database
  documents?: Pick<DocumentRepository, 'save'>
  issues: IssueRepository
  snapshots: SnapshotRepository
  policy?: SnapshotPolicy
}

const RETENTION_WINDOW_MS = 24 * 60 * 60 * 1_000

export class SnapshotService {
  private readonly policy: SnapshotPolicy

  constructor(private readonly options: SnapshotServiceOptions) {
    this.policy = options.policy ?? new SnapshotPolicy()
  }

  onUpdate(issueId: string, state: Uint8Array, now: Date): number | null {
    const decision = this.policy.recordUpdate(issueId, now)
    if (!decision.shouldSnapshot || !decision.reason) return null

    const id = this.options.snapshots.create({
      issueId,
      state,
      reason: decision.reason,
      updateCount: decision.updateCount,
      createdAt: now,
    })
    this.policy.markSnapshotted(issueId, now)
    return id
  }

  archive(issueId: string, state: Uint8Array, now: Date): number {
    const archiveId = this.options.snapshots.create({
      issueId,
      state,
      reason: 'archive',
      updateCount: 0,
      createdAt: now,
    })
    const archiveCreatedAt = this.options.snapshots.get(archiveId)?.createdAt ?? now.toISOString()
    const cutoff = new Date(archiveCreatedAt).getTime() - RETENTION_WINDOW_MS
    const latestByHour = new Map<string, number>()

    for (const snapshot of this.options.snapshots.list(issueId)) {
      if (snapshot.reason !== 'interval' && snapshot.reason !== 'volume') continue
      const timestamp = new Date(snapshot.createdAt)
      if (timestamp.getTime() < cutoff) continue
      const hour = snapshot.createdAt.slice(0, 13)
      if (!latestByHour.has(hour)) latestByHour.set(hour, snapshot.id)
    }
    this.options.snapshots.deleteAutomaticExcept(issueId, [...latestByHour.values()])
    return archiveId
  }

  async restore(
    issueId: string,
    snapshotId: number,
    now: Date,
    provider: DirectConnectionProvider,
  ): Promise<number> {
    if (this.options.issues.find(issueId)?.status !== 'current') {
      throw new Error(`Only the current issue can be restored: ${issueId}`)
    }
    const snapshot = this.options.snapshots.get(snapshotId)
    if (!snapshot || snapshot.issueId !== issueId) {
      throw new Error(`Snapshot does not belong to issue: ${snapshotId}`)
    }

    const validationDocument = new Y.Doc()
    Y.applyUpdate(validationDocument, snapshot.state)
    validationDocument.destroy()
    const connection = await provider.openDirectConnection(issueId)
    let restoredState: Uint8Array | undefined
    let restoredDocument: Y.Doc | undefined
    let previousState: Uint8Array | undefined
    try {
      await connection.transact((document) => {
        previousState = Y.encodeStateAsUpdate(document)
        const selected = materializeSnapshot(snapshot.state, document)
        restoredDocument = materializeSnapshot(Y.encodeStateAsUpdate(document), document)
        replaceDocument(restoredDocument, selected)
        restoredState = Y.encodeStateAsUpdate(restoredDocument)
        selected.destroy()
      })
    } catch (error) {
      await connection.disconnect().catch(() => undefined)
      throw error
    }

    let manualId: number
    const persist = () => {
      this.options.documents?.save(issueId, restoredState!)
      manualId = this.options.snapshots.create({
        issueId,
        state: restoredState!,
        reason: 'manual',
        updateCount: 0,
        createdAt: now,
      })
    }
    if (this.options.db && this.options.documents) {
      this.options.db.transaction(persist).immediate()
    } else {
      persist()
    }

    try {
      const applyPersistedState = () =>
        connection.transact((document) => replaceDocument(document, restoredDocument!))
      try {
        await applyPersistedState()
      } catch (firstError) {
        // The database commit is already authoritative and audited. Retry the
        // in-memory projection before allowing disconnect/store to run.
        try {
          await applyPersistedState()
        } catch {
          if (this.options.db && this.options.documents) {
            try {
              this.options.db.transaction(() => {
                this.options.documents!.save(issueId, previousState!)
                this.options.snapshots.delete(manualId!)
              }).immediate()
            } catch (rollbackError) {
              // Do not disconnect: its store hook could overwrite an unknown
              // rollback outcome. The authoritative process keeps the operation failed.
              throw rollbackError
            }
          }
          await connection.disconnect()
          throw firstError
        }
      }
      await connection.disconnect()
      return manualId!
    } finally {
      restoredDocument?.destroy()
    }
  }
}

function materializeSnapshot(state: Uint8Array, target: Y.Doc): Y.Doc {
  const selected = new Y.Doc()
  for (const [name, type] of target.share) getMatchingTopLevelType(selected, name, type)
  Y.applyUpdate(selected, state)
  return selected
}

function getMatchingTopLevelType(target: Y.Doc, name: string, type: unknown): SharedType {
  if (type instanceof Y.XmlFragment) return target.getXmlFragment(name)
  if (type instanceof Y.Text) return target.getText(name)
  if (type instanceof Y.Array) return target.getArray(name)
  if (type instanceof Y.Map) return target.getMap(name)
  // Yjs updates do not encode root constructors. Hocuspocus can therefore
  // expose an unmaterialized AbstractType after loading binary state. Tiptap's
  // collaboration root is always the `default` XmlFragment; auxiliary roots
  // used by this application are text roots.
  return name === 'default' ? target.getXmlFragment(name) : target.getText(name)
}

export function replaceDocument(target: Y.Doc, source: Y.Doc): void {
  const materializedTargets = new Map<string, SharedType>()
  for (const [name, type] of target.share) {
    materializedTargets.set(name, getMatchingTopLevelType(target, name, type))
  }
  for (const [name, sourceType] of source.share) {
    if (!materializedTargets.has(name)) {
      materializedTargets.set(name, getTopLevelType(target, name, sourceType))
    }
  }
  for (const type of materializedTargets.values()) clearType(type)

  for (const [name, sourceType] of source.share) {
    const targetType = materializedTargets.get(name)!
    copyType(sourceType, targetType)
  }
}

function getTopLevelType(target: Y.Doc, name: string, source: unknown): SharedType {
  return getMatchingTopLevelType(target, name, source)
}

function clearType(type: SharedType): void {
  if (type instanceof Y.Map) {
    for (const key of type.keys()) type.delete(key)
  } else if (type instanceof Y.Array || type instanceof Y.Text || type instanceof Y.XmlFragment) {
    if (type.length > 0) type.delete(0, type.length)
  }
}

function copyType(source: unknown, target: SharedType): void {
  if (source instanceof Y.Map && target instanceof Y.Map) {
    for (const [key, value] of source.entries()) target.set(key, cloneValue(value))
  } else if (source instanceof Y.Array && target instanceof Y.Array) {
    target.insert(0, source.toArray().map(cloneValue))
  } else if (source instanceof Y.Text && target instanceof Y.Text) {
    target.applyDelta(
      source.toDelta().map((part: { insert: unknown; attributes?: Record<string, unknown> }) => ({
        ...part,
        insert: cloneValue(part.insert),
      })),
    )
  } else if (source instanceof Y.XmlFragment && target instanceof Y.XmlFragment) {
    target.insert(0, source.toArray().map((child) => cloneType(child) as Y.XmlElement | Y.XmlText))
  } else {
    throw new Error('Selected snapshot has an incompatible Yjs document shape')
  }
}

function cloneValue<T>(value: T): T {
  if (value instanceof Y.AbstractType) return cloneType(value as unknown as SharedType) as T
  if (value instanceof Uint8Array) return new Uint8Array(value) as T
  return value
}

function cloneType(source: SharedType): SharedType {
  let target: SharedType
  if (source instanceof Y.XmlElement) {
    const element = new Y.XmlElement(source.nodeName)
    for (const [key, value] of Object.entries(source.getAttributes())) element.setAttribute(key, value)
    target = element
  } else if (source instanceof Y.XmlText) {
    target = new Y.XmlText()
  } else if (source instanceof Y.XmlFragment) {
    target = new Y.XmlFragment()
  } else if (source instanceof Y.Text) {
    target = new Y.Text()
  } else if (source instanceof Y.Array) {
    target = new Y.Array()
  } else if (source instanceof Y.Map) {
    target = new Y.Map()
  } else {
    throw new Error('Unsupported Yjs nested type')
  }
  copyType(source, target)
  return target
}
