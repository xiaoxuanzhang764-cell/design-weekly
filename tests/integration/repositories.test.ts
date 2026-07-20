import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createRepositories } from '@/server/db/client'
import { DocumentRepository } from '@/server/db/documents-repository'
import { IssueRepository } from '@/server/db/issues-repository'
import { migrate } from '@/server/db/schema'
import { SnapshotRepository } from '@/server/db/snapshots-repository'

describe('SQLite repositories', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db)
  })

  afterEach(() => {
    db.close()
  })

  it('creates one current issue and archives the previous week idempotently', () => {
    const repo = new IssueRepository(db)

    const first = repo.ensureCurrent(new Date('2026-07-16T00:00:00.000Z'))
    const repeated = repo.ensureCurrent(new Date('2026-07-17T00:00:00.000Z'))
    const next = repo.ensureCurrent(new Date('2026-07-20T00:00:00.000Z'))

    expect(first).toMatchObject({
      id: 'issue-2026-07-13',
      title: '设计周刊（07.13）',
      status: 'current',
      coverUrl: null,
      itemCount: 0,
    })
    expect(repeated.id).toBe(first.id)
    expect(next.id).toBe('issue-2026-07-20')
    expect(repo.list()).toEqual([
      expect.objectContaining({ id: next.id, status: 'current' }),
      expect.objectContaining({ id: first.id, status: 'archived' }),
    ])
    expect(repo.list().filter((issue) => issue.status === 'current')).toHaveLength(1)
    expect(db.prepare('SELECT archived_at FROM issues WHERE id = ?').get(first.id)).toEqual({
      archived_at: '2026-07-20T00:00:00.000Z',
    })
  })

  it('finds an issue and enforces the single-current invariant in SQLite', () => {
    const repo = new IssueRepository(db)
    const issue = repo.ensureCurrent(new Date('2026-07-16T00:00:00.000Z'))

    expect(repo.find(issue.id)).toEqual(issue)
    expect(repo.find('missing')).toBeUndefined()
    expect(() =>
      db
        .prepare(
          "INSERT INTO issues(id,title,starts_at,ends_at,status) VALUES(?,?,?,?, 'current')",
        )
        .run('issue-other', 'Other', '2026-01-01', '2026-01-08'),
    ).toThrow()
  })

  it('does not roll the current issue back for a late request from an older week', () => {
    const repo = new IssueRepository(db)
    const oldIssue = repo.ensureCurrent(new Date('2026-07-16T00:00:00.000Z'))
    const currentIssue = repo.ensureCurrent(new Date('2026-07-20T00:00:00.000Z'))

    const late = repo.ensureCurrent(new Date('2026-07-16T00:00:00.000Z'))
    const repeatedLate = repo.ensureCurrent(new Date('2026-07-17T00:00:00.000Z'))

    expect(late).toEqual(currentIssue)
    expect(repeatedLate).toEqual(currentIssue)
    expect(repo.find(oldIssue.id)).toMatchObject({ status: 'archived' })
    expect(repo.list().filter((issue) => issue.status === 'current')).toEqual([currentIssue])
  })

  it('saves and overwrites binary document state without sharing mutable storage', () => {
    const repo = new DocumentRepository(db)

    expect(repo.load('issue-a')).toBeNull()
    repo.save('issue-a', new Uint8Array([0, 127, 128, 255]))
    expect(repo.load('issue-a')).toEqual(new Uint8Array([0, 127, 128, 255]))

    repo.save('issue-a', new Uint8Array([9, 8]))
    expect(repo.load('issue-a')).toEqual(new Uint8Array([9, 8]))
  })

  it('creates, lists, and loads snapshots with binary state', () => {
    const repo = new SnapshotRepository(db)
    const firstId = repo.create({
      issueId: 'issue-a',
      state: new Uint8Array([1, 2, 255]),
      reason: 'interval',
      updateCount: 12,
      createdAt: new Date('2026-07-16T01:00:00.000Z'),
    })
    const secondId = repo.create({
      issueId: 'issue-a',
      state: new Uint8Array([3, 4]),
      reason: 'manual',
      updateCount: 20,
      createdAt: new Date('2026-07-16T02:00:00.000Z'),
    })
    repo.create({
      issueId: 'issue-b',
      state: new Uint8Array([5]),
      reason: 'archive',
      updateCount: 30,
      createdAt: new Date('2026-07-16T03:00:00.000Z'),
    })

    expect(repo.list('issue-a')).toEqual([
      {
        id: secondId,
        reason: 'manual',
        updateCount: 20,
        createdAt: '2026-07-16T02:00:00.000Z',
      },
      {
        id: firstId,
        reason: 'interval',
        updateCount: 12,
        createdAt: '2026-07-16T01:00:00.000Z',
      },
    ])
    expect(repo.get(firstId)).toEqual({
      id: firstId,
      issueId: 'issue-a',
      state: new Uint8Array([1, 2, 255]),
      reason: 'interval',
      updateCount: 12,
      createdAt: '2026-07-16T01:00:00.000Z',
    })
    expect(repo.get(999_999)).toBeUndefined()
  })

  it('deletes all but retained snapshots without crossing issue boundaries', () => {
    const repo = new SnapshotRepository(db)
    const create = (issueId: string, minute: number) =>
      repo.create({
        issueId,
        state: new Uint8Array([minute]),
        reason: 'volume',
        updateCount: minute,
        createdAt: new Date(`2026-07-16T00:${String(minute).padStart(2, '0')}:00.000Z`),
      })
    const remove = create('issue-a', 1)
    const keep = create('issue-a', 2)
    const otherIssue = create('issue-b', 3)

    repo.deleteExcept('issue-a', [keep])
    expect(repo.get(remove)).toBeUndefined()
    expect(repo.get(keep)).toBeDefined()
    expect(repo.get(otherIssue)).toBeDefined()

    repo.deleteExcept('issue-a', [])
    expect(repo.list('issue-a')).toEqual([])
    expect(repo.get(otherIssue)).toBeDefined()
  })
})

it('creates missing parent directories for a nested file database', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'design-weekly-repositories-'))
  const databasePath = join(temporaryRoot, 'nested', 'data', 'weekly.sqlite')

  try {
    const repositories = createRepositories(databasePath)
    try {
      expect(existsSync(dirname(databasePath))).toBe(true)
      expect(repositories.issues.list()).toEqual([])
    } finally {
      repositories.db.close()
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

it('takes the write reservation before reading current across database connections', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'design-weekly-locking-'))
  const databasePath = join(temporaryRoot, 'weekly.sqlite')
  const firstDb = new Database(databasePath)
  const secondDb = new Database(databasePath)

  try {
    migrate(firstDb)
    migrate(secondDb)
    secondDb.pragma('busy_timeout = 0')
    const firstRepo = new IssueRepository(firstDb)
    const secondRepo = new IssueRepository(secondDb)
    firstRepo.ensureCurrent(new Date('2026-07-16T00:00:00.000Z'))

    const originalPrepare = firstDb.prepare.bind(firstDb)
    let contended = false
    let contendingError: unknown
    Object.defineProperty(firstDb, 'prepare', {
      configurable: true,
      value: ((source: string) => {
        const statement = originalPrepare(source)
        if (!source.includes('SELECT id, starts_at AS startsAt')) return statement

        const originalGet = statement.get.bind(statement)
        statement.get = ((...params: unknown[]) => {
          const row = originalGet(...params)
          if (!contended) {
            contended = true
            try {
              secondRepo.ensureCurrent(new Date('2026-07-27T00:00:00.000Z'))
            } catch (error) {
              contendingError = error
            }
          }
          return row
        }) as typeof statement.get
        return statement
      }) as typeof firstDb.prepare,
    })

    expect(firstRepo.ensureCurrent(new Date('2026-07-20T00:00:00.000Z'))).toMatchObject({
      id: 'issue-2026-07-20',
      status: 'current',
    })
    expect(contendingError).toMatchObject({ code: 'SQLITE_BUSY' })

    expect(secondRepo.ensureCurrent(new Date('2026-07-27T00:00:00.000Z'))).toMatchObject({
      id: 'issue-2026-07-27',
      status: 'current',
    })
    expect(secondRepo.list().filter((issue) => issue.status === 'current')).toHaveLength(1)
  } finally {
    firstDb.close()
    secondDb.close()
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})
