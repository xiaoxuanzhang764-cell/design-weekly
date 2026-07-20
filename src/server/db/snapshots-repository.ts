import type Database from 'better-sqlite3'

export type SnapshotReason = 'interval' | 'volume' | 'manual' | 'archive'

export interface CreateSnapshotInput {
  issueId: string
  state: Uint8Array
  reason: SnapshotReason
  updateCount: number
  createdAt: Date
}

export interface SnapshotSummary {
  id: number
  reason: string
  updateCount: number
  createdAt: string
}

export interface Snapshot extends SnapshotSummary {
  issueId: string
  state: Uint8Array
}

interface SnapshotRow {
  id: number
  issueId: string
  state: Buffer
  reason: string
  updateCount: number
  createdAt: string
}

export class SnapshotRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateSnapshotInput): number {
    const result = this.db
      .prepare(
        `${input.reason === 'archive' ? 'INSERT OR IGNORE' : 'INSERT'} INTO snapshots(issue_id, state, reason, update_count, created_at)
         VALUES(?, ?, ?, ?, ?)`,
      )
      .run(
        input.issueId,
        Buffer.from(input.state),
        input.reason,
        input.updateCount,
        input.createdAt.toISOString(),
      )

    if (result.changes > 0) return Number(result.lastInsertRowid)
    const existing = this.findArchive(input.issueId)
    if (!existing) throw new Error(`Failed to create snapshot for ${input.issueId}`)
    return existing.id
  }

  list(issueId: string): SnapshotSummary[] {
    return this.db
      .prepare(
        `SELECT
           id,
           reason,
           update_count AS updateCount,
           created_at AS createdAt
         FROM snapshots
         WHERE issue_id = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(issueId) as SnapshotSummary[]
  }

  get(snapshotId: number): Snapshot | undefined {
    const row = this.db
      .prepare(
        `SELECT
           id,
           issue_id AS issueId,
           state,
           reason,
           update_count AS updateCount,
           created_at AS createdAt
         FROM snapshots
         WHERE id = ?`,
      )
      .get(snapshotId) as SnapshotRow | undefined

    if (!row) return undefined

    return {
      ...row,
      state: new Uint8Array(row.state),
    }
  }

  delete(snapshotId: number): void {
    this.db.prepare('DELETE FROM snapshots WHERE id = ?').run(snapshotId)
  }

  findArchive(issueId: string): SnapshotSummary | undefined {
    return this.db
      .prepare(
        `SELECT id, reason, update_count AS updateCount, created_at AS createdAt
         FROM snapshots
         WHERE issue_id = ? AND reason = 'archive'
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(issueId) as SnapshotSummary | undefined
  }

  deleteAutomaticExcept(issueId: string, keepIds: number[]): void {
    const params: Array<string | number> = [issueId]
    let keepClause = ''
    if (keepIds.length > 0) {
      keepClause = ` AND id NOT IN (${keepIds.map(() => '?').join(', ')})`
      params.push(...keepIds)
    }
    this.db
      .prepare(
        `DELETE FROM snapshots
         WHERE issue_id = ? AND reason IN ('interval', 'volume')${keepClause}`,
      )
      .run(...params)
  }

  deleteExcept(issueId: string, keepIds: number[]): void {
    if (keepIds.length === 0) {
      this.db.prepare('DELETE FROM snapshots WHERE issue_id = ?').run(issueId)
      return
    }

    const placeholders = keepIds.map(() => '?').join(', ')
    this.db
      .prepare(`DELETE FROM snapshots WHERE issue_id = ? AND id NOT IN (${placeholders})`)
      .run(issueId, ...keepIds)
  }
}
