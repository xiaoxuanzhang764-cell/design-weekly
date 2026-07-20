import type Database from 'better-sqlite3'

import type { MediaKind } from '@/features/media/validation'

export interface CreateMediaInput {
  byteSize: number
  createdAt: string
  derivedUrl: string | null
  id: string
  issueId: string
  kind: MediaKind
  mimeType: string
  originalUrl: string
}

export class IssueReadOnlyError extends Error {
  constructor() {
    super('Issue is no longer current')
    this.name = 'IssueReadOnlyError'
  }
}

export class MediaRepository {
  constructor(private readonly db: Database.Database) {}

  isCurrentIssue(issueId: string): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM issues WHERE id = ? AND status = 'current'")
        .get(issueId),
    )
  }

  create(input: CreateMediaInput): void {
    const result = this.db
      .prepare(
        `INSERT INTO media(
          id, issue_id, kind, original_url, derived_url, mime_type,
          byte_size, status, error, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, 'ready', NULL, ?
        WHERE EXISTS (
          SELECT 1 FROM issues WHERE id = ? AND status = 'current'
        )`,
      )
      .run(
        input.id,
        input.issueId,
        input.kind,
        input.originalUrl,
        input.derivedUrl,
        input.mimeType,
        input.byteSize,
        input.createdAt,
        input.issueId,
      )
    if (result.changes !== 1) throw new IssueReadOnlyError()
  }
}
