import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { DocumentRepository } from './documents-repository'
import { IssueRepository } from './issues-repository'
import { MediaRepository } from './media-repository'
import { migrate } from './schema'
import { SnapshotRepository } from './snapshots-repository'

let singleton: ReturnType<typeof createRepositories> | undefined

function createRepositories(path = process.env.DATABASE_PATH ?? './data/design-weekly.sqlite') {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }

  const db = new Database(path)
  migrate(db)

  return {
    db,
    issues: new IssueRepository(db),
    media: new MediaRepository(db),
    documents: new DocumentRepository(db),
    snapshots: new SnapshotRepository(db),
  }
}

export function getRepositories(): ReturnType<typeof createRepositories> {
  singleton ??= createRepositories()
  return singleton
}

export { createRepositories }
