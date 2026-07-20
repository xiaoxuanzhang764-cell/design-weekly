import type Database from 'better-sqlite3'

export function migrate(db: Database.Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('current', 'archived')),
      cover_url TEXT,
      item_count INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS one_current_issue
      ON issues(status) WHERE status = 'current';

    CREATE TABLE IF NOT EXISTS documents (
      name TEXT PRIMARY KEY,
      state BLOB NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id TEXT NOT NULL,
      state BLOB NOT NULL,
      reason TEXT NOT NULL CHECK(reason IN ('interval', 'volume', 'manual', 'archive')),
      update_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS one_archive_snapshot_per_issue
      ON snapshots(issue_id) WHERE reason = 'archive';

    CREATE TABLE IF NOT EXISTS archive_notifications (
      issue_id TEXT PRIMARY KEY,
      next_issue_id TEXT NOT NULL,
      notified_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      original_url TEXT NOT NULL,
      derived_url TEXT,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL
    );
  `)
}
