import type Database from 'better-sqlite3'

export class DocumentRepository {
  constructor(private readonly db: Database.Database) {}

  load(name: string): Uint8Array | null {
    const row = this.db.prepare('SELECT state FROM documents WHERE name = ?').get(name) as
      | { state: Buffer }
      | undefined

    return row ? new Uint8Array(row.state) : null
  }

  save(name: string, state: Uint8Array): void {
    this.db
      .prepare(
        `INSERT INTO documents(name, state, updated_at)
         VALUES(?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           state = excluded.state,
           updated_at = excluded.updated_at`,
      )
      .run(name, Buffer.from(state), new Date().toISOString())
  }
}
