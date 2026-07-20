// @vitest-environment node

import Database from 'better-sqlite3'
import * as Y from 'yjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createHttpRestoreClient,
  createSnapshotRouteHandlers,
} from '@/app/api/snapshots/[issueId]/route'
import { SnapshotPolicy } from '@/features/snapshots/policy'
import { SnapshotService } from '@/features/snapshots/service'
import { IssueRepository } from '@/server/db/issues-repository'
import { migrate } from '@/server/db/schema'
import { SnapshotRepository } from '@/server/db/snapshots-repository'
import { DocumentRepository } from '@/server/db/documents-repository'

const ISSUE_ID = 'issue-2026-07-13'
const NOW = new Date('2026-07-16T12:00:00.000Z')

function stateWithContent(content: string, obsolete = ''): Uint8Array {
  const document = new Y.Doc()
  document.getText('content').insert(0, content)
  if (obsolete) document.getText('obsolete').insert(0, obsolete)
  return Y.encodeStateAsUpdate(document)
}

function readText(state: Uint8Array, name = 'content'): string {
  const document = new Y.Doc()
  Y.applyUpdate(document, state)
  return document.getText(name).toString()
}

describe('SnapshotService', () => {
  let db: Database.Database
  let snapshots: SnapshotRepository
  let issues: IssueRepository

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db)
    snapshots = new SnapshotRepository(db)
    issues = new IssueRepository(db)
    issues.ensureCurrent(NOW)
  })

  afterEach(() => db.close())

  it('stores full state on the policy trigger and resets only after a successful insert', () => {
    const policy = new SnapshotPolicy()
    const service = new SnapshotService({ issues, policy, snapshots })

    for (let update = 1; update < 200; update += 1) {
      expect(service.onUpdate(ISSUE_ID, stateWithContent(String(update)), NOW)).toBeNull()
    }
    const id = service.onUpdate(ISSUE_ID, stateWithContent('full-state'), NOW)

    expect(id).toBeTypeOf('number')
    expect(snapshots.list(ISSUE_ID)).toEqual([
      expect.objectContaining({ reason: 'volume', updateCount: 200 }),
    ])
    expect(readText(snapshots.get(id!)!.state)).toBe('full-state')
    expect(service.onUpdate(ISSUE_ID, stateWithContent('next'), NOW)).toBeNull()
    expect(snapshots.list(ISSUE_ID)).toHaveLength(1)
  })

  it('keeps the final snapshot, manual snapshots, and one latest automatic snapshot per hour in the final 24 hours', () => {
    const service = new SnapshotService({ issues, snapshots })
    const create = (createdAt: string, reason: 'interval' | 'volume' | 'manual') =>
      snapshots.create({
        issueId: ISSUE_ID,
        state: stateWithContent(createdAt),
        reason,
        updateCount: 1,
        createdAt: new Date(createdAt),
      })

    const tooOld = create('2026-07-15T11:59:00.000Z', 'interval')
    const olderInHour = create('2026-07-15T12:05:00.000Z', 'volume')
    const latestInHour = create('2026-07-15T12:55:00.000Z', 'interval')
    const nextHour = create('2026-07-15T13:10:00.000Z', 'volume')
    const manualOld = create('2026-07-10T01:00:00.000Z', 'manual')

    const archiveId = service.archive(ISSUE_ID, stateWithContent('final'), NOW)
    const repeatedId = service.archive(
      ISSUE_ID,
      stateWithContent('different'),
      new Date('2026-07-18T12:00:00.000Z'),
    )

    expect(repeatedId).toBe(archiveId)
    expect(snapshots.get(tooOld)).toBeUndefined()
    expect(snapshots.get(olderInHour)).toBeUndefined()
    expect(snapshots.get(latestInHour)).toBeDefined()
    expect(snapshots.get(nextHour)).toBeDefined()
    expect(snapshots.get(manualOld)).toBeDefined()
    expect(snapshots.get(archiveId)).toMatchObject({ reason: 'archive' })
    expect(readText(snapshots.get(archiveId)!.state)).toBe('final')
    expect(snapshots.list(ISSUE_ID).filter(({ reason }) => reason === 'archive')).toHaveLength(1)
  })

  it('restores as a new manual version, keeps later history, and removes content absent from the selected state', async () => {
    const service = new SnapshotService({ issues, snapshots })
    const selectedId = snapshots.create({
      issueId: ISSUE_ID,
      state: stateWithContent('selected'),
      reason: 'interval',
      updateCount: 4,
      createdAt: new Date('2026-07-16T10:00:00.000Z'),
    })
    const laterId = snapshots.create({
      issueId: ISSUE_ID,
      state: stateWithContent('later', 'must disappear'),
      reason: 'volume',
      updateCount: 9,
      createdAt: new Date('2026-07-16T11:00:00.000Z'),
    })
    const live = new Y.Doc()
    Y.applyUpdate(live, snapshots.get(laterId)!.state)
    let disconnected = false

    const manualId = await service.restore(ISSUE_ID, selectedId, NOW, {
      openDirectConnection: async () => ({
        transact: async (transaction) => transaction(live),
        disconnect: async () => {
          disconnected = true
        },
      }),
    })

    expect(disconnected).toBe(true)
    expect(live.getText('content').toString()).toBe('selected')
    expect(live.getText('obsolete').toString()).toBe('')
    expect(snapshots.get(selectedId)).toBeDefined()
    expect(snapshots.get(laterId)).toBeDefined()
    expect(snapshots.get(manualId)).toMatchObject({
      issueId: ISSUE_ID,
      reason: 'manual',
      updateCount: 0,
    })
    expect(readText(snapshots.get(manualId)!.state)).toBe('selected')
  })

  it('rejects restoring a foreign snapshot or a historical issue', async () => {
    const service = new SnapshotService({ issues, snapshots })
    const foreignId = snapshots.create({
      issueId: 'issue-other',
      state: stateWithContent('foreign'),
      reason: 'manual',
      updateCount: 0,
      createdAt: NOW,
    })
    const connector = { openDirectConnection: async () => { throw new Error('must not open') } }

    await expect(service.restore(ISSUE_ID, foreignId, NOW, connector)).rejects.toThrow(
      /snapshot.*issue/i,
    )
    issues.ensureCurrent(new Date('2026-07-20T00:00:00.000Z'))
    const ownId = snapshots.create({
      issueId: ISSUE_ID,
      state: stateWithContent('old'),
      reason: 'manual',
      updateCount: 0,
      createdAt: NOW,
    })
    await expect(service.restore(ISSUE_ID, ownId, NOW, connector)).rejects.toThrow(/current issue/i)
  })

  it('retries a transient live-document update after the atomic document and manual snapshot commit', async () => {
    const documents = new DocumentRepository(db)
    const service = new SnapshotService({ db, documents, issues, snapshots })
    const selectedId = snapshots.create({
      issueId: ISSUE_ID,
      state: stateWithContent('atomic selected'),
      reason: 'interval',
      updateCount: 2,
      createdAt: NOW,
    })
    const live = new Y.Doc()
    live.getText('content').insert(0, 'live old')
    let calls = 0

    const manualId = await service.restore(ISSUE_ID, selectedId, NOW, {
      openDirectConnection: async () => ({
        transact: async (transaction) => {
          calls += 1
          if (calls === 2) throw new Error('transient live apply failure')
          transaction(live)
        },
        disconnect: async () => undefined,
      }),
    })

    expect(calls).toBe(3)
    expect(live.getText('content').toString()).toBe('atomic selected')
    expect(readText(documents.load(ISSUE_ID)!)).toBe('atomic selected')
    expect(snapshots.get(manualId)?.reason).toBe('manual')
  })

  it('rolls durable state and audit history back before disconnect when live projection fails twice', async () => {
    const documents = new DocumentRepository(db)
    const service = new SnapshotService({ db, documents, issues, snapshots })
    const selectedId = snapshots.create({
      issueId: ISSUE_ID,
      state: stateWithContent('selected'),
      reason: 'interval',
      updateCount: 2,
      createdAt: NOW,
    })
    const live = new Y.Doc()
    live.getText('content').insert(0, 'previous')
    documents.save(ISSUE_ID, Y.encodeStateAsUpdate(live))
    let calls = 0

    await expect(service.restore(ISSUE_ID, selectedId, NOW, {
      openDirectConnection: async () => ({
        transact: async (transaction) => {
          calls += 1
          if (calls > 1) throw new Error('persistent projection failure')
          transaction(live)
        },
        disconnect: async () => documents.save(ISSUE_ID, Y.encodeStateAsUpdate(live)),
      }),
    })).rejects.toThrow(/projection failure/)

    expect(readText(documents.load(ISSUE_ID)!)).toBe('previous')
    expect(live.getText('content').toString()).toBe('previous')
    expect(snapshots.list(ISSUE_ID).filter(({ reason }) => reason === 'manual')).toEqual([])
  })
})

describe('snapshot API', () => {
  let db: Database.Database
  let snapshots: SnapshotRepository
  let issues: IssueRepository
  let restoreClient: { restore: ReturnType<typeof vi.fn> }
  let handlers: ReturnType<typeof createSnapshotRouteHandlers>

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db)
    snapshots = new SnapshotRepository(db)
    issues = new IssueRepository(db)
    issues.ensureCurrent(NOW)
    restoreClient = { restore: vi.fn() }
    handlers = createSnapshotRouteHandlers({
      issues,
      snapshots,
      restoreClient,
    })
  })

  afterEach(() => {
    db.close()
  })

  it('lists snapshot summaries newest first without exposing binary state', async () => {
    snapshots.create({
      issueId: ISSUE_ID,
      state: stateWithContent('older'),
      reason: 'interval',
      updateCount: 4,
      createdAt: new Date('2026-07-16T10:00:00.000Z'),
    })
    snapshots.create({
      issueId: ISSUE_ID,
      state: stateWithContent('newer'),
      reason: 'volume',
      updateCount: 200,
      createdAt: new Date('2026-07-16T11:00:00.000Z'),
    })

    const response = await handlers.GET(new Request('http://localhost'), {
      params: Promise.resolve({ issueId: ISSUE_ID }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.snapshots.map((snapshot: { reason: string }) => snapshot.reason)).toEqual([
      'volume',
      'interval',
    ])
    expect(body.snapshots[0]).not.toHaveProperty('state')
  })

  it('returns the selected snapshot as base64 only when it belongs to the issue', async () => {
    const snapshotId = snapshots.create({
      issueId: ISSUE_ID,
      state: stateWithContent('真实预览内容'),
      reason: 'manual',
      updateCount: 0,
      createdAt: NOW,
    })
    const response = await handlers.GET(
      new Request(`http://localhost/api/snapshots/${ISSUE_ID}?snapshotId=${snapshotId}`),
      { params: Promise.resolve({ issueId: ISSUE_ID }) },
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(readText(Uint8Array.from(Buffer.from(body.snapshot.stateBase64, 'base64'))))
      .toBe('真实预览内容')
    expect(body.snapshot).not.toHaveProperty('state')
  })

  it('requires explicit confirmation and restores only a snapshot owned by the current issue', async () => {
    const selectedId = snapshots.create({
      issueId: ISSUE_ID,
      state: stateWithContent('selected'),
      reason: 'interval',
      updateCount: 3,
      createdAt: new Date('2026-07-16T10:00:00.000Z'),
    })
    restoreClient.restore.mockResolvedValue({
      id: 13,
      reason: 'manual',
      updateCount: 0,
      createdAt: NOW.toISOString(),
    })

    const unconfirmed = await handlers.POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ snapshotId: selectedId }),
      }),
      { params: Promise.resolve({ issueId: ISSUE_ID }) },
    )
    expect(unconfirmed.status).toBe(400)
    expect(await unconfirmed.json()).toMatchObject({ error: { code: 'CONFIRM_REQUIRED' } })

    const restored = await handlers.POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ snapshotId: selectedId, confirm: true }),
      }),
      { params: Promise.resolve({ issueId: ISSUE_ID }) },
    )
    expect(restored.status).toBe(201)
    expect(await restored.json()).toMatchObject({ snapshot: { reason: 'manual' } })
    expect(restoreClient.restore).toHaveBeenCalledWith(ISSUE_ID, selectedId)

    const foreignId = snapshots.create({
      issueId: 'issue-other',
      state: stateWithContent('foreign'),
      reason: 'manual',
      updateCount: 0,
      createdAt: NOW,
    })
    const foreign = await handlers.POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ snapshotId: foreignId, confirm: true }),
      }),
      { params: Promise.resolve({ issueId: ISSUE_ID }) },
    )
    expect(foreign.status).toBe(404)
    expect(await foreign.json()).toMatchObject({ error: { code: 'SNAPSHOT_NOT_FOUND' } })
  })

  it('rejects restore for an archived issue and malformed requests', async () => {
    const selectedId = snapshots.create({
      issueId: ISSUE_ID,
      state: stateWithContent('selected'),
      reason: 'manual',
      updateCount: 0,
      createdAt: NOW,
    })
    issues.ensureCurrent(new Date('2026-07-20T00:00:00.000Z'))

    const archived = await handlers.POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ snapshotId: selectedId, confirm: true }),
      }),
      { params: Promise.resolve({ issueId: ISSUE_ID }) },
    )
    expect(archived.status).toBe(403)
    expect(await archived.json()).toMatchObject({ error: { code: 'ISSUE_READ_ONLY' } })

    const malformed = await handlers.POST(
      new Request('http://localhost', { method: 'POST', body: '{' }),
      { params: Promise.resolve({ issueId: ISSUE_ID }) },
    )
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } })
  })

  it('returns an explicit configuration error without making a request when the internal token is missing', async () => {
    const previous = process.env.COLLAB_INTERNAL_TOKEN
    delete process.env.COLLAB_INTERNAL_TOKEN
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const selectedId = snapshots.create({
      issueId: ISSUE_ID,
      state: stateWithContent('selected'),
      reason: 'manual',
      updateCount: 0,
      createdAt: NOW,
    })
    const configuredHandlers = createSnapshotRouteHandlers({
      issues,
      snapshots,
      restoreClient: createHttpRestoreClient(),
    })
    const response = await configuredHandlers.POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ snapshotId: selectedId, confirm: true }),
      }),
      { params: Promise.resolve({ issueId: ISSUE_ID }) },
    )
    if (previous === undefined) delete process.env.COLLAB_INTERNAL_TOKEN
    else process.env.COLLAB_INTERNAL_TOKEN = previous

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'RESTORE_NOT_CONFIGURED' } })
    expect(fetch).not.toHaveBeenCalled()
  })
})
