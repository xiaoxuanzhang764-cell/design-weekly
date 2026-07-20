import type Database from 'better-sqlite3'

import type { IssueSummary } from '@/features/issues/types'
import { getIssueId, getIssueWindow } from '@/features/issues/week'

const SELECT_ISSUE = `
  SELECT
    id,
    title,
    starts_at AS startsAt,
    ends_at AS endsAt,
    status,
    cover_url AS coverUrl,
    item_count AS itemCount
  FROM issues
`

export class IssueRepository {
  constructor(private readonly db: Database.Database) {}

  ensureCurrent(now: Date): IssueSummary {
    const window = getIssueWindow(now)
    const id = getIssueId(window)
    const archivedAt = now.toISOString()
    const title = `设计周刊（${id.slice(-5).replace('-', '.')}）`
    const startsAt = window.start.toISOString()

    const ensuredId = this.db.transaction(() => {
      const current = this.db
        .prepare(
          `SELECT id, starts_at AS startsAt
           FROM issues
           WHERE status = 'current'`,
        )
        .get() as { id: string; startsAt: string } | undefined

      if (current && current.startsAt > startsAt) {
        return current.id
      }

      this.db
        .prepare(
          `UPDATE issues
           SET status = 'archived', archived_at = ?
           WHERE status = 'current' AND id <> ?`,
        )
        .run(archivedAt, id)

      this.db
        .prepare(
          `INSERT INTO issues(id, title, starts_at, ends_at, status)
           VALUES(?, ?, ?, ?, 'current')
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             starts_at = excluded.starts_at,
             ends_at = excluded.ends_at,
             status = 'current',
             archived_at = NULL`,
        )
        .run(id, title, startsAt, window.end.toISOString())

      return id
    }).immediate()

    const issue = this.find(ensuredId)
    if (!issue) {
      throw new Error(`Failed to ensure current issue: ${ensuredId}`)
    }
    return issue
  }

  find(id: string): IssueSummary | undefined {
    return this.db.prepare(`${SELECT_ISSUE} WHERE id = ?`).get(id) as
      | IssueSummary
      | undefined
  }

  list(): IssueSummary[] {
    return this.db.prepare(`${SELECT_ISSUE} ORDER BY starts_at DESC`).all() as IssueSummary[]
  }
}
