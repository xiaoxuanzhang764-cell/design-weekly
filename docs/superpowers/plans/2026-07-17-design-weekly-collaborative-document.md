# Design Weekly Collaborative Document Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public design-weekly gallery whose current issue is an anonymously editable, real-time collaborative document with media blocks, offline recovery, snapshots, and automatic weekly archiving.

**Architecture:** A Next.js App Router application renders the public gallery, archive, APIs, and document shell. A separate Hocuspocus v4 WebSocket process synchronizes Tiptap/Yjs documents and awareness; both processes share SQLite repositories for issue metadata, binary Yjs state, and snapshots. Media uses a storage interface with a local filesystem adapter for development and a compatible object-storage adapter boundary for deployment.

**Tech Stack:** Node.js 22+, pnpm, Next.js App Router, React 19, TypeScript, Tiptap 3.27.x, Yjs 13.6.8+, Hocuspocus 4.x, y-indexeddb, better-sqlite3, Vitest, Testing Library, Playwright, plain CSS with OKLCH design tokens.

## Global Constraints

- The current issue is publicly readable and editable without authentication.
- Historical issues are read-only.
- The canonical timezone is `Asia/Shanghai`; archive rollover occurs Monday at `00:00`.
- The initial document template contains `视觉设计分享`, `文章知识类`, and `资源资讯类` headings.
- Image formats: JPEG, PNG, WebP, GIF; maximum 20 MB per file.
- Video formats: MP4, WebM; maximum 250 MB per file.
- Generate a snapshot every 5 minutes or 200 document updates, whichever occurs first; generate a final snapshot on archive.
- Persist anonymous identity only in the browser; it grants no authorization.
- Body text contrast is at least 4.5:1; large text contrast is at least 3:1.
- Respect `prefers-reduced-motion` and preserve complete keyboard editing.
- Do not add login, review, comments, likes, notifications, complex tables, whiteboards, or DingTalk synchronization.

---

## File Structure

```text
src/
  app/
    api/issues/current/route.ts       Current issue bootstrap endpoint
    api/issues/[issueId]/route.ts     Issue metadata and read-only archive endpoint
    api/media/route.ts                Validated media upload endpoint
    api/link-preview/route.ts         Safe URL metadata endpoint
    api/snapshots/[issueId]/route.ts  Snapshot list and restore endpoint
    issue/[issueId]/page.tsx          Collaborative/read-only document page
    page.tsx                          Gallery homepage
    globals.css                       Tokens, base typography, responsive behavior
  components/
    gallery/                          Homepage hero, filters, issue cards
    document/                         Three-column shell, sidebars, status bar
    editor/                           Tiptap editor, extensions, block menus
  features/
    collaboration/                    Provider hooks, identity, connection state
    issues/                           Week calculation and issue lifecycle
    media/                            Upload client and storage interface
    snapshots/                        Snapshot policy and restore logic
  server/
    db/                               SQLite connection, schema, repositories
    link-preview/                     URL validation and metadata parsing
    storage/                          Local media adapter and interface
server/
  collaboration.ts                   Hocuspocus WebSocket entry point
  collaboration-server.ts            Testable server factory
tests/
  unit/                               Pure domain and validation tests
  integration/                        SQLite, collaboration, and APIs
  e2e/                                Multi-browser collaboration and user flows
data/                                 Ignored SQLite database
storage/                              Ignored uploaded media
```

### Task 1: Scaffold the application and quality gates

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`
- Create: `tests/setup.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm build`, and `pnpm dev` commands used by every later task.
- Produces: CSS tokens such as `--surface-dark`, `--surface-document`, `--ink`, and `--accent`.

- [ ] **Step 1: Add a failing smoke test for the root layout**

```tsx
// tests/unit/root-layout.test.tsx
import { render, screen } from '@testing-library/react'
import RootLayout from '@/app/layout'

it('renders page content inside the root document', () => {
  render(<RootLayout><main>content</main></RootLayout>)
  expect(screen.getByText('content')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the smoke test and verify the project is not scaffolded**

Run: `pnpm vitest run tests/unit/root-layout.test.tsx`

Expected: FAIL because `package.json`, Vitest configuration, and `@/app/layout` do not exist.

- [ ] **Step 3: Scaffold Next.js and install exact collaboration/test dependencies**

Run:

```bash
pnpm dlx create-next-app@latest . --ts --eslint --app --src-dir --import-alias '@/*' --use-pnpm --no-tailwind
pnpm add @tiptap/core@^3.27.1 @tiptap/react@^3.27.1 @tiptap/starter-kit@^3.27.1 @tiptap/extension-collaboration@^3.27.1 @tiptap/extension-collaboration-caret@^3.27.1 @tiptap/extension-image@^3.27.1 @tiptap/extension-link@^3.27.1 @tiptap/extension-placeholder@^3.27.1 @tiptap/extension-youtube@^3.27.1 @hocuspocus/server@^4.0.0 @hocuspocus/provider@^4.0.0 @hocuspocus/provider-react@^4.0.0 @hocuspocus/extension-database@^4.0.0 yjs@^13.6.8 y-indexeddb better-sqlite3 zod date-fns date-fns-tz cheerio sharp
pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test tsx concurrently @types/better-sqlite3
```

Expected: dependencies install successfully under Node.js 22 or later.

- [ ] **Step 4: Configure scripts and the test environment**

```json
// package.json scripts
{
  "dev": "concurrently -k -n web,collab 'next dev' 'tsx watch server/collaboration.ts'",
  "dev:web": "next dev",
  "dev:collab": "tsx watch server/collaboration.ts",
  "build": "next build",
  "start": "next start",
  "start:collab": "tsx server/collaboration.ts",
  "lint": "eslint .",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test"
}
```

```ts
// vitest.config.ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'] },
})
```

```ts
// tests/setup.ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 5: Establish accessible design tokens and the root layout**

```tsx
// src/app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '设计周刊',
  description: '一份由所有人实时共同编辑的设计周刊',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>
}
```

```css
/* src/app/globals.css */
:root {
  --surface-dark: oklch(0.15 0.008 265);
  --surface-dark-raised: oklch(0.20 0.01 265);
  --surface-app: oklch(0.95 0.004 265);
  --surface-document: oklch(0.99 0 0);
  --ink: oklch(0.19 0.01 265);
  --ink-on-dark: oklch(0.97 0.003 265);
  --muted: oklch(0.49 0.012 265);
  --accent: oklch(0.61 0.19 264);
  --border: oklch(0.86 0.006 265);
  --radius-card: 12px;
}
* { box-sizing: border-box; }
body { margin: 0; color: var(--ink); font-family: ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; }
button, input, textarea { font: inherit; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; } }
```

- [ ] **Step 6: Run all quality gates**

Run: `pnpm test && pnpm lint && pnpm build`

Expected: PASS with the smoke test green and a successful production build.

- [ ] **Step 7: Commit the scaffold**

```bash
git add package.json pnpm-lock.yaml tsconfig.json next.config.ts vitest.config.ts playwright.config.ts src tests .gitignore
git commit -m "chore: scaffold collaborative weekly app"
```

### Task 2: Implement issue week calculation and lifecycle

**Files:**
- Create: `src/features/issues/types.ts`
- Create: `src/features/issues/week.ts`
- Create: `src/features/issues/template.ts`
- Test: `tests/unit/issues-week.test.ts`

**Interfaces:**
- Produces: `getIssueWindow(now: Date): IssueWindow`.
- Produces: `getIssueId(window: IssueWindow): string` formatted as `issue-YYYY-MM-DD`.
- Produces: `createIssueTemplate(): JSONContent` with the three required headings.

- [ ] **Step 1: Write failing timezone and boundary tests**

```ts
// tests/unit/issues-week.test.ts
import { describe, expect, it } from 'vitest'
import { getIssueId, getIssueWindow } from '@/features/issues/week'

describe('getIssueWindow', () => {
  it('starts Monday at midnight in Asia/Shanghai', () => {
    const window = getIssueWindow(new Date('2026-07-16T04:00:00.000Z'))
    expect(window.start.toISOString()).toBe('2026-07-12T16:00:00.000Z')
    expect(window.end.toISOString()).toBe('2026-07-19T16:00:00.000Z')
    expect(getIssueId(window)).toBe('issue-2026-07-13')
  })

  it('rolls over exactly at Monday 00:00 Shanghai time', () => {
    expect(getIssueId(getIssueWindow(new Date('2026-07-19T16:00:00.000Z'))))
      .toBe('issue-2026-07-20')
  })
})
```

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm vitest run tests/unit/issues-week.test.ts`

Expected: FAIL because `week.ts` does not exist.

- [ ] **Step 3: Implement the domain types and week calculation**

```ts
// src/features/issues/types.ts
export type IssueStatus = 'current' | 'archived'
export interface IssueWindow { start: Date; end: Date }
export interface IssueSummary {
  id: string; title: string; startsAt: string; endsAt: string
  status: IssueStatus; coverUrl: string | null; itemCount: number
}
```

```ts
// src/features/issues/week.ts
import { addWeeks, startOfWeek } from 'date-fns'
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz'
import type { IssueWindow } from './types'

const ZONE = 'Asia/Shanghai'
export function getIssueWindow(now: Date): IssueWindow {
  const local = toZonedTime(now, ZONE)
  const localStart = startOfWeek(local, { weekStartsOn: 1 })
  return { start: fromZonedTime(localStart, ZONE), end: fromZonedTime(addWeeks(localStart, 1), ZONE) }
}
export function getIssueId(window: IssueWindow) {
  return `issue-${formatInTimeZone(window.start, ZONE, 'yyyy-MM-dd')}`
}
```

- [ ] **Step 4: Add and test the initial Tiptap JSON template**

```ts
// src/features/issues/template.ts
import type { JSONContent } from '@tiptap/core'
export function createIssueTemplate(): JSONContent {
  return { type: 'doc', content: ['视觉设计分享', '文章知识类', '资源资讯类'].flatMap(text => [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] },
    { type: 'paragraph' },
  ]) }
}
```

Run: `pnpm vitest run tests/unit/issues-week.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the lifecycle domain**

```bash
git add src/features/issues tests/unit/issues-week.test.ts
git commit -m "feat: add weekly issue lifecycle domain"
```

### Task 3: Add SQLite schema and repositories

**Files:**
- Create: `src/server/db/client.ts`
- Create: `src/server/db/schema.ts`
- Create: `src/server/db/issues-repository.ts`
- Create: `src/server/db/documents-repository.ts`
- Create: `src/server/db/snapshots-repository.ts`
- Test: `tests/integration/repositories.test.ts`

**Interfaces:**
- Produces: `IssueRepository.ensureCurrent(now): IssueSummary` and `IssueRepository.list(): IssueSummary[]`.
- Produces: `DocumentRepository.load(name): Uint8Array | null` and `save(name, state): void`.
- Produces: `SnapshotRepository.create(input)`, `list(issueId)`, `get(snapshotId)`, and `deleteExcept(issueId, keepIds)`.

- [ ] **Step 1: Write a failing repository integration test**

```ts
// tests/integration/repositories.test.ts
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { migrate } from '@/server/db/schema'
import { IssueRepository } from '@/server/db/issues-repository'

it('creates one current issue and archives the previous week idempotently', () => {
  const db = new Database(':memory:')
  migrate(db)
  const repo = new IssueRepository(db)
  const first = repo.ensureCurrent(new Date('2026-07-16T00:00:00Z'))
  const next = repo.ensureCurrent(new Date('2026-07-20T00:00:00Z'))
  expect(repo.list().filter(issue => issue.status === 'current')).toHaveLength(1)
  expect(first.status).toBe('current')
  expect(next.id).toBe('issue-2026-07-20')
})
```

- [ ] **Step 2: Verify the repository test fails**

Run: `pnpm vitest run tests/integration/repositories.test.ts`

Expected: FAIL because database modules do not exist.

- [ ] **Step 3: Create the schema migration**

```ts
// src/server/db/schema.ts
import type Database from 'better-sqlite3'
export function migrate(db: Database.Database) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('current','archived')),
      cover_url TEXT, item_count INTEGER NOT NULL DEFAULT 0, archived_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_current_issue ON issues(status) WHERE status='current';
    CREATE TABLE IF NOT EXISTS documents (
      name TEXT PRIMARY KEY, state BLOB NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id TEXT NOT NULL, state BLOB NOT NULL,
      reason TEXT NOT NULL CHECK(reason IN ('interval','volume','manual','archive')),
      update_count INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, kind TEXT NOT NULL,
      original_url TEXT NOT NULL, derived_url TEXT, mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL
    );
  `)
}
```

- [ ] **Step 4: Implement transaction-safe current issue creation**

```ts
// src/server/db/issues-repository.ts
import type Database from 'better-sqlite3'
import { getIssueId, getIssueWindow } from '@/features/issues/week'
import type { IssueSummary } from '@/features/issues/types'

export class IssueRepository {
  constructor(private db: Database.Database) {}
  ensureCurrent(now: Date): IssueSummary {
    const window = getIssueWindow(now); const id = getIssueId(window)
    this.db.transaction(() => {
      this.db.prepare("UPDATE issues SET status='archived', archived_at=? WHERE status='current' AND id<>?")
        .run(now.toISOString(), id)
      this.db.prepare(`INSERT OR IGNORE INTO issues(id,title,starts_at,ends_at,status)
        VALUES(?,?,?,?, 'current')`).run(id, `设计周刊（${id.slice(-5).replace('-', '.')}）`, window.start.toISOString(), window.end.toISOString())
    })()
    return this.db.prepare('SELECT id,title,starts_at startsAt,ends_at endsAt,status,cover_url coverUrl,item_count itemCount FROM issues WHERE id=?').get(id) as IssueSummary
  }
  find(id: string) { return this.db.prepare('SELECT id,title,starts_at startsAt,ends_at endsAt,status,cover_url coverUrl,item_count itemCount FROM issues WHERE id=?').get(id) as IssueSummary | undefined }
  list() { return this.db.prepare('SELECT id,title,starts_at startsAt,ends_at endsAt,status,cover_url coverUrl,item_count itemCount FROM issues ORDER BY starts_at DESC').all() as IssueSummary[] }
}
```

- [ ] **Step 5: Implement binary document and snapshot repositories**

```ts
// src/server/db/documents-repository.ts
import type Database from 'better-sqlite3'
export class DocumentRepository {
  constructor(private db: Database.Database) {}
  load(name: string) { const row = this.db.prepare('SELECT state FROM documents WHERE name=?').get(name) as { state: Buffer } | undefined; return row ? new Uint8Array(row.state) : null }
  save(name: string, state: Uint8Array) { this.db.prepare(`INSERT INTO documents(name,state,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at`).run(name, Buffer.from(state), new Date().toISOString()) }
}
```

Create the shared repository factory so server components, route handlers, and the collaboration process use the same schema:

```ts
// src/server/db/client.ts
import Database from 'better-sqlite3'
import { migrate } from './schema'
import { IssueRepository } from './issues-repository'
import { DocumentRepository } from './documents-repository'
import { SnapshotRepository } from './snapshots-repository'

let singleton: ReturnType<typeof createRepositories> | undefined
function createRepositories(path = process.env.DATABASE_PATH ?? './data/design-weekly.sqlite') {
  const db = new Database(path); migrate(db)
  return { db, issues: new IssueRepository(db), documents: new DocumentRepository(db), snapshots: new SnapshotRepository(db) }
}
export function getRepositories() { return singleton ??= createRepositories() }
export { createRepositories }
```

Implement `SnapshotRepository` with these exact public methods:

```ts
create(input:{ issueId:string; state:Uint8Array; reason:'interval'|'volume'|'manual'|'archive'; updateCount:number; createdAt:Date }): number
list(issueId:string): Array<{ id:number; reason:string; updateCount:number; createdAt:string }>
get(snapshotId:number): { id:number; issueId:string; state:Uint8Array; reason:string; updateCount:number; createdAt:string } | undefined
deleteExcept(issueId:string, keepIds:number[]): void
```

Run: `pnpm vitest run tests/integration/repositories.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit persistence**

```bash
git add src/server/db tests/integration/repositories.test.ts
git commit -m "feat: add issue and document persistence"
```

### Task 4: Build the public gallery and archive pages

**Files:**
- Create: `src/components/gallery/gallery-hero.tsx`
- Create: `src/components/gallery/issue-card.tsx`
- Create: `src/components/gallery/issue-grid.tsx`
- Create: `src/components/gallery/gallery.module.css`
- Modify: `src/app/page.tsx`
- Test: `tests/unit/gallery.test.tsx`

**Interfaces:**
- Consumes: `IssueRepository.list()` and `IssueSummary`.
- Produces: links to `/issue/[issueId]` and filterable year/status cards.

- [ ] **Step 1: Write the failing gallery behavior test**

```tsx
// tests/unit/gallery.test.tsx
import { render, screen } from '@testing-library/react'
import { IssueGrid } from '@/components/gallery/issue-grid'

it('marks the current issue and links each card', () => {
  render(<IssueGrid issues={[{ id:'issue-2026-07-13', title:'设计周刊（07.13）', startsAt:'2026-07-12T16:00:00Z', endsAt:'2026-07-19T16:00:00Z', status:'current', coverUrl:null, itemCount:12 }]} />)
  expect(screen.getByText('更新中')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /设计周刊/ })).toHaveAttribute('href', '/issue/issue-2026-07-13')
})
```

- [ ] **Step 2: Verify the test fails**

Run: `pnpm vitest run tests/unit/gallery.test.tsx`

Expected: FAIL because gallery components do not exist.

- [ ] **Step 3: Implement semantic cards and the centered hero**

```tsx
// src/components/gallery/issue-card.tsx
import Link from 'next/link'
import type { IssueSummary } from '@/features/issues/types'
export function IssueCard({ issue }: { issue: IssueSummary }) {
  return <Link href={`/issue/${issue.id}`} aria-label={`${issue.title}${issue.status === 'current' ? '，更新中' : ''}`}>
    <article><div aria-hidden className="cover">{issue.id.slice(-5)}</div><h2>{issue.title}</h2>
      <p>{issue.itemCount} 条内容</p>{issue.status === 'current' && <span>更新中</span>}</article>
  </Link>
}
```

Implement `IssueGrid` with a `<ul>` and CSS `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`; implement `GalleryHero` with the confirmed centered title and current-issue actions.

- [ ] **Step 4: Render repository data on the App Router homepage**

```tsx
// src/app/page.tsx
import { GalleryHero } from '@/components/gallery/gallery-hero'
import { IssueGrid } from '@/components/gallery/issue-grid'
import { getRepositories } from '@/server/db/client'
export const dynamic = 'force-dynamic'
export default function HomePage() {
  const { issues } = getRepositories(); issues.ensureCurrent(new Date())
  const all = issues.list(); const current = all.find(issue => issue.status === 'current')!
  return <main><GalleryHero current={current} /><IssueGrid issues={all} /></main>
}
```

- [ ] **Step 5: Run component tests and visual smoke build**

Run: `pnpm vitest run tests/unit/gallery.test.tsx && pnpm build`

Expected: PASS; homepage renders current and archived cards.

- [ ] **Step 6: Commit the gallery**

```bash
git add src/app/page.tsx src/components/gallery tests/unit/gallery.test.tsx
git commit -m "feat: build design weekly gallery"
```

### Task 5: Start the Hocuspocus collaboration server with SQLite persistence

**Files:**
- Create: `server/collaboration-server.ts`
- Create: `server/collaboration.ts`
- Create: `src/features/snapshots/policy.ts`
- Test: `tests/unit/snapshot-policy.test.ts`
- Test: `tests/integration/collaboration-server.test.ts`

**Interfaces:**
- Produces: `createCollaborationServer({ db, port }): Hocuspocus`.
- Produces: WebSocket document names matching issue IDs.
- Produces: `SnapshotPolicy.recordUpdate(issueId, now): SnapshotDecision`.

- [ ] **Step 1: Write failing snapshot policy tests**

```ts
// tests/unit/snapshot-policy.test.ts
import { expect, it } from 'vitest'
import { SnapshotPolicy } from '@/features/snapshots/policy'

it('snapshots at 200 updates or five elapsed minutes', () => {
  const policy = new SnapshotPolicy()
  for (let i=0;i<199;i++) expect(policy.recordUpdate('issue-a', new Date(0)).shouldSnapshot).toBe(false)
  expect(policy.recordUpdate('issue-a', new Date(0)).shouldSnapshot).toBe(true)
  policy.markSnapshotted('issue-a', new Date(0))
  expect(policy.recordUpdate('issue-a', new Date(300_000)).shouldSnapshot).toBe(true)
})
```

- [ ] **Step 2: Implement the policy and verify it passes**

```ts
// src/features/snapshots/policy.ts
export class SnapshotPolicy {
  private state = new Map<string,{ count:number; at:number }>()
  recordUpdate(id:string, now:Date) { const s=this.state.get(id) ?? {count:0,at:now.getTime()}; s.count++; this.state.set(id,s); return { shouldSnapshot:s.count>=200 || now.getTime()-s.at>=300_000, updateCount:s.count } }
  markSnapshotted(id:string, now:Date) { this.state.set(id,{count:0,at:now.getTime()}) }
}
```

Run: `pnpm vitest run tests/unit/snapshot-policy.test.ts`

Expected: PASS.

- [ ] **Step 3: Implement the collaboration server factory**

```ts
// server/collaboration-server.ts
import { Server } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import type BetterSqlite3 from 'better-sqlite3'
import { DocumentRepository } from '@/server/db/documents-repository'

export function createCollaborationServer(db: BetterSqlite3.Database, port=1234) {
  const documents = new DocumentRepository(db)
  return new Server({
    name: 'design-weekly-collaboration', port, timeout: 60_000,
    debounce: 2_000, maxDebounce: 10_000, quiet: true,
    websocketOptions: { maxPayload: 1_048_576 },
    extensions: [new Database({
      fetch: async ({ documentName }) => documents.load(documentName),
      store: async ({ documentName, state }) => documents.save(documentName, state),
    })],
  })
}
```

`server/collaboration.ts` opens `data/design-weekly.sqlite`, runs `migrate`, calls `ensureCurrent`, starts a 60-second rollover check, and then calls `listen()`.

- [ ] **Step 4: Add a two-provider integration test**

Create two `HocuspocusProvider` clients against an ephemeral port, modify a shared `Y.Text`, await both `synced` events, and assert both clients read `共同编辑`. Close providers and server in `afterEach`.

Run: `pnpm vitest run tests/integration/collaboration-server.test.ts`

Expected: PASS with both clients converging on identical Yjs state.

- [ ] **Step 5: Commit collaboration persistence**

```bash
git add server src/features/snapshots tests/unit/snapshot-policy.test.ts tests/integration/collaboration-server.test.ts
git commit -m "feat: add realtime collaboration server"
```

### Task 6: Build the collaborative Tiptap editor and anonymous presence

**Files:**
- Create: `src/features/collaboration/identity.ts`
- Create: `src/features/collaboration/collaboration-room.tsx`
- Create: `src/components/editor/collaborative-editor.tsx`
- Create: `src/components/editor/editor-extensions.ts`
- Create: `src/components/editor/editor.module.css`
- Test: `tests/unit/identity.test.ts`
- Test: `tests/unit/collaborative-editor.test.tsx`

**Interfaces:**
- Produces: `getAnonymousIdentity(storage): AnonymousIdentity`.
- Produces: `<CollaborationRoom issueId>` wrapping Hocuspocus React provider and IndexedDB persistence.
- Produces: `<CollaborativeEditor readOnly={boolean}>`.

- [ ] **Step 1: Test stable anonymous identity generation**

```ts
// tests/unit/identity.test.ts
import { expect, it } from 'vitest'
import { getAnonymousIdentity } from '@/features/collaboration/identity'
it('persists the same anonymous identity in browser storage', () => {
  const map = new Map<string,string>(); const storage = { getItem:(k:string)=>map.get(k)??null, setItem:(k:string,v:string)=>void map.set(k,v) }
  expect(getAnonymousIdentity(storage)).toEqual(getAnonymousIdentity(storage))
})
```

- [ ] **Step 2: Implement identity and provider wiring**

```ts
// src/features/collaboration/identity.ts
export interface AnonymousIdentity { id:string; name:string; color:string }
const COLORS=['#3767e8','#d6533d','#2c7d70','#8056c7','#b36b18']
export function getAnonymousIdentity(storage: Pick<Storage,'getItem'|'setItem'>): AnonymousIdentity {
  const existing=storage.getItem('design-weekly-identity'); if(existing) return JSON.parse(existing)
  const number=Math.floor(Math.random()*900)+100
  const value={id:crypto.randomUUID(),name:`访客 ${number}`,color:COLORS[number%COLORS.length]}
  storage.setItem('design-weekly-identity',JSON.stringify(value)); return value
}
```

Use `HocuspocusProviderWebsocketComponent` once and `HocuspocusRoom name={issueId} sessionAwareness` per document. Inside the room, create `IndexeddbPersistence(issueId, provider.document)` and destroy it on unmount.

- [ ] **Step 3: Configure Tiptap collaboration correctly**

```tsx
// essential part of src/components/editor/collaborative-editor.tsx
const provider = useHocuspocusProvider()
const editor = useEditor({
  immediatelyRender: false,
  editable: !readOnly,
  extensions: [
    StarterKit.configure({ undoRedo: false }),
    Collaboration.configure({ document: provider.document }),
    CollaborationCaret.configure({ provider, user: identity }),
    Placeholder.configure({ placeholder: '输入 “/” 插入内容，或直接粘贴图片、视频和链接…' }),
  ],
})
return <EditorContent editor={editor} className={styles.editor} />
```

- [ ] **Step 4: Test read-only behavior and collaboration extension configuration**

Mock `useHocuspocusProvider`, render read-only and editable variants, and assert the editor receives `editable: false` for archived issues and `true` for current issues.

Run: `pnpm vitest run tests/unit/identity.test.ts tests/unit/collaborative-editor.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the collaborative editor**

```bash
git add src/features/collaboration src/components/editor tests/unit/identity.test.ts tests/unit/collaborative-editor.test.tsx
git commit -m "feat: add anonymous collaborative editor"
```

### Task 7: Build the three-column document workspace

**Files:**
- Create: `src/components/document/document-shell.tsx`
- Create: `src/components/document/issue-sidebar.tsx`
- Create: `src/components/document/document-outline.tsx`
- Create: `src/components/document/presence-list.tsx`
- Create: `src/components/document/sync-status.tsx`
- Create: `src/components/document/document.module.css`
- Create: `src/app/issue/[issueId]/page.tsx`
- Test: `tests/unit/document-shell.test.tsx`

**Interfaces:**
- Consumes: collaboration provider state, awareness states, issues list, and `CollaborativeEditor`.
- Produces: desktop three-column layout and mobile drawer layout.

- [ ] **Step 1: Write the failing shell semantics test**

```tsx
it('labels navigation, document, and outline regions', () => {
  render(<DocumentShell issue={currentIssue} issues={[currentIssue]} />)
  expect(screen.getByRole('navigation', { name:'周刊目录' })).toBeInTheDocument()
  expect(screen.getByRole('main')).toBeInTheDocument()
  expect(screen.getByRole('complementary', { name:'文档信息' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Implement the shell and live status components**

`SyncStatus` maps provider state to exact labels: `connected + synced → 已保存`, `connected + unsynced → 正在同步`, and `disconnected → 离线编辑`. `PresenceList` reads awareness states, removes the local client ID, and renders name/color pairs.

- [ ] **Step 3: Implement heading-derived outline navigation**

Subscribe to editor updates, collect level-2 and level-3 headings with generated stable IDs, and render anchor buttons that call `element.scrollIntoView({ block:'start', behavior: reducedMotion ? 'auto' : 'smooth' })`.

- [ ] **Step 4: Wire current and archived pages**

```tsx
// src/app/issue/[issueId]/page.tsx
export default async function IssuePage({ params }: { params: Promise<{issueId:string}> }) {
  const { issueId } = await params
  const { issues } = getRepositories(); const issue = issues.find(issueId)
  if (!issue) notFound()
  return <DocumentShell issue={issue} issues={issues.list()} readOnly={issue.status === 'archived'} />
}
```

- [ ] **Step 5: Run shell tests and build**

Run: `pnpm vitest run tests/unit/document-shell.test.tsx && pnpm build`

Expected: PASS; current issue is editable and archive pages are read-only.

- [ ] **Step 6: Commit the workspace**

```bash
git add src/components/document src/app/issue tests/unit/document-shell.test.tsx
git commit -m "feat: add collaborative document workspace"
```

### Task 8: Add media storage, uploads, and editor nodes

**Files:**
- Create: `src/server/storage/storage.ts`
- Create: `src/server/storage/local-storage.ts`
- Create: `src/features/media/validation.ts`
- Create: `src/features/media/upload-client.ts`
- Create: `src/app/api/media/route.ts`
- Create: `src/components/editor/extensions/video.ts`
- Create: `src/components/editor/media-toolbar.tsx`
- Test: `tests/unit/media-validation.test.ts`
- Test: `tests/integration/media-route.test.ts`

**Interfaces:**
- Produces: `MediaStorage.put(input): Promise<StoredMedia>`.
- Produces: `validateMedia(file): { kind:'image'|'video' }` or a typed validation error.
- Produces: `POST /api/media` returning `{ id, url, kind, mimeType, byteSize }`.

- [ ] **Step 1: Write exact validation tests**

```ts
it.each([['image/jpeg',20*1024*1024],['video/mp4',250*1024*1024]])('accepts %s at its limit',(type,size)=>expect(validateMedia({type,size})).toBeTruthy())
it('rejects oversized images',()=>expect(()=>validateMedia({type:'image/png',size:20*1024*1024+1})).toThrow('图片不能超过 20 MB'))
it('rejects unsupported video',()=>expect(()=>validateMedia({type:'video/quicktime',size:1})).toThrow('仅支持 MP4 或 WebM 视频'))
```

- [ ] **Step 2: Implement the storage interface and local adapter**

```ts
export interface MediaStorage { put(input:{ id:string; bytes:Uint8Array; extension:string }):Promise<{url:string;path:string}>; delete(path:string):Promise<void> }
```

`LocalMediaStorage` writes under `storage/uploads/<yyyy>/<mm>/<uuid>.<ext>` using exclusive file creation, returns `/uploads/...`, and never accepts caller-provided paths.

- [ ] **Step 3: Implement the upload route**

Parse multipart `file`, call `validateMedia`, upload, use Sharp to generate a 1280-pixel WebP derivative for non-GIF images, insert the media row, and return status 201. Return structured 400 errors for type/size problems and 503 with a retryable code for storage failures.

- [ ] **Step 4: Implement image/video editor insertion**

`MediaToolbar` exposes keyboard-focusable buttons. Upload inserts a temporary node with `status:'uploading'` and local object URL; success replaces attributes with the server URL; failure sets `status:'failed'` and exposes Retry and Remove buttons. The custom `video` node stores `src`, `poster`, `mimeType`, and `status` attributes.

- [ ] **Step 5: Run media tests**

Run: `pnpm vitest run tests/unit/media-validation.test.ts tests/integration/media-route.test.ts`

Expected: PASS for supported files, boundary sizes, and retryable storage failure.

- [ ] **Step 6: Commit media support**

```bash
git add src/server/storage src/features/media src/app/api/media src/components/editor tests/unit/media-validation.test.ts tests/integration/media-route.test.ts
git commit -m "feat: add image and video blocks"
```

### Task 9: Add safe link previews and embedded video fallback

**Files:**
- Create: `src/server/link-preview/validate-url.ts`
- Create: `src/server/link-preview/fetch-preview.ts`
- Create: `src/app/api/link-preview/route.ts`
- Create: `src/components/editor/extensions/link-card.ts`
- Test: `tests/unit/link-url.test.ts`
- Test: `tests/integration/link-preview-route.test.ts`

**Interfaces:**
- Produces: `validatePublicHttpUrl(input): URL`, rejecting localhost and private/reserved IP ranges.
- Produces: `fetchLinkPreview(url): { title, description, image, siteName, url }`.
- Produces: a `linkCard` node that degrades to a plain external link.

- [ ] **Step 1: Write SSRF and fallback tests**

```ts
it.each(['http://127.0.0.1/a','http://localhost/a','http://169.254.169.254/'])('rejects private URL %s', value => expect(()=>validatePublicHttpUrl(value)).toThrow())
it('accepts a public https URL',()=>expect(validatePublicHttpUrl('https://example.com/a').hostname).toBe('example.com'))
```

- [ ] **Step 2: Implement URL validation before every redirect hop**

Only allow `http:` and `https:`. Resolve DNS, reject loopback, link-local, private, multicast, and unspecified IPv4/IPv6 addresses. Limit redirects to three and validate each destination.

- [ ] **Step 3: Implement bounded metadata fetching**

Fetch with an 8-second abort timeout, `Accept: text/html`, maximum 2 MB response, and Cheerio parsing for Open Graph/title/description. Return the original URL with empty optional fields when parsing fails.

- [ ] **Step 4: Insert link cards on paste**

When the pasted selection is empty and contains one URL, insert `linkCard` with loading state, call the API, then update the same node. For YouTube URLs use Tiptap's YouTube extension; if it rejects the URL, preserve the link card.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run tests/unit/link-url.test.ts tests/integration/link-preview-route.test.ts`

Expected: PASS, including private URL rejection and plain-link fallback.

```bash
git add src/server/link-preview src/app/api/link-preview src/components/editor/extensions tests/unit/link-url.test.ts tests/integration/link-preview-route.test.ts
git commit -m "feat: add link previews and video embeds"
```

### Task 10: Implement snapshots, restore, and automatic archive rollover

**Files:**
- Modify: `src/server/db/snapshots-repository.ts`
- Create: `src/features/snapshots/service.ts`
- Create: `src/app/api/snapshots/[issueId]/route.ts`
- Create: `src/components/document/version-history.tsx`
- Modify: `server/collaboration-server.ts`
- Test: `tests/integration/snapshots.test.ts`
- Test: `tests/integration/archive-rollover.test.ts`

**Interfaces:**
- Produces: `SnapshotService.onUpdate(issueId, state, now)` and `archive(issueId, state, now)`.
- Produces: `GET /api/snapshots/:issueId` and `POST` with `{ snapshotId }`.

- [ ] **Step 1: Write failing retention and non-destructive restore tests**

Create interval snapshots, an archive snapshot, restore an older state, and assert restoration creates a new `manual` snapshot while all later snapshots remain queryable.

- [ ] **Step 2: Implement snapshot creation and retention**

On policy trigger, insert a full Yjs binary. On archive, insert `archive`. After archive, retain the final snapshot plus one snapshot per hour from the final 24 hours; delete other interval/volume snapshots for that issue.

- [ ] **Step 3: Implement restore through a direct Hocuspocus document connection**

Open `server.openDirectConnection(issueId)`, replace the current Yjs document state from the selected binary within one transaction, persist, broadcast, create a `manual` snapshot, then disconnect. Require a `confirm:true` body field so the UI's second confirmation cannot be bypassed accidentally.

- [ ] **Step 4: Implement archive rollover**

The collaboration server checks every 60 seconds. If `ensureCurrent` archives an issue, create its final snapshot and broadcast a stateless `{ type:'archived', nextIssueId }` message to connected clients. API and homepage requests also call the same idempotent lifecycle service.

- [ ] **Step 5: Build the version history UI**

List timestamp, reason, and update count. “预览” opens a read-only dialog. “恢复此版本” requires a second confirmation showing the snapshot time, then POSTs and displays “已恢复为新的当前版本”.

- [ ] **Step 6: Run snapshot and rollover tests**

Run: `pnpm vitest run tests/integration/snapshots.test.ts tests/integration/archive-rollover.test.ts`

Expected: PASS with only one current issue and non-destructive restore history.

- [ ] **Step 7: Commit history and rollover**

```bash
git add src/features/snapshots src/server/db/snapshots-repository.ts src/app/api/snapshots src/components/document/version-history.tsx server tests/integration
git commit -m "feat: add versions and weekly rollover"
```

### Task 11: Responsive, accessibility, and visual polish pass

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/gallery/gallery.module.css`
- Modify: `src/components/document/document.module.css`
- Modify: `src/components/editor/editor.module.css`
- Create: `tests/e2e/accessibility.spec.ts`
- Create: `tests/e2e/responsive.spec.ts`

**Interfaces:**
- Consumes all completed UI.
- Produces desktop three-column, tablet two-pane, and mobile single-column behavior without lost editor functionality.

- [ ] **Step 1: Add failing responsive and keyboard tests**

```ts
test('mobile collapses sidebars and keeps editor controls reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/issue/issue-2026-07-13')
  await expect(page.getByRole('button',{name:'打开周刊目录'})).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.locator(':focus')).toBeVisible()
})
```

- [ ] **Step 2: Implement breakpoint behavior**

At widths below 1100px hide the right sidebar behind “文档信息”; below 760px hide both sidebars behind top-bar buttons, remove fixed canvas margins, replace drag-only ordering with accessible up/down menu actions, and keep media buttons at least 44px tall.

- [ ] **Step 3: Add focus, contrast, and motion rules**

Use a 2px solid accent focus ring with 2px offset; never remove outline without replacement. Verify all muted text token combinations with a contrast script. Disable caret entrance and block insertion transforms under reduced motion.

- [ ] **Step 4: Run browser checks at three viewports**

Run: `pnpm playwright test tests/e2e/accessibility.spec.ts tests/e2e/responsive.spec.ts --project=chromium`

Expected: PASS at 390×844, 820×1180, and 1440×1000.

- [ ] **Step 5: Commit the polish pass**

```bash
git add src tests/e2e/accessibility.spec.ts tests/e2e/responsive.spec.ts
git commit -m "feat: polish responsive collaborative workspace"
```

### Task 12: End-to-end collaboration verification and operator documentation

**Files:**
- Create: `tests/e2e/collaboration.spec.ts`
- Create: `tests/e2e/media.spec.ts`
- Create: `tests/e2e/archive.spec.ts`
- Create: `README.md`
- Create: `.env.example`
- Modify: `package.json`

**Interfaces:**
- Produces reproducible local startup and verification instructions.
- Produces evidence that two browser contexts converge, reconnect, upload media, and cross archive boundaries.

- [ ] **Step 1: Write a two-context collaboration E2E test**

```ts
test('two anonymous visitors edit and converge', async ({ browser }) => {
  const a=await browser.newContext(); const b=await browser.newContext()
  const pa=await a.newPage(); const pb=await b.newPage()
  await Promise.all([pa.goto('/issue/current'),pb.goto('/issue/current')])
  await pa.getByRole('textbox').fill('共同编辑的内容')
  await expect(pb.getByText('共同编辑的内容')).toBeVisible()
  await a.setOffline(true); await pa.getByRole('textbox').pressSequentially(' 离线补充')
  await a.setOffline(false)
  await expect(pb.getByText(/离线补充/)).toBeVisible()
})
```

- [ ] **Step 2: Add media and archive E2E coverage**

Upload a 1 KB PNG fixture, assert upload progress then image rendering in the second context. Use a test-only clock injection to cross Monday 00:00, assert the old issue becomes read-only and the new issue receives the template headings.

- [ ] **Step 3: Write exact local operation instructions**

```dotenv
# .env.example
DATABASE_PATH=./data/design-weekly.sqlite
MEDIA_ROOT=./storage/uploads
NEXT_PUBLIC_COLLAB_URL=ws://127.0.0.1:1234
COLLAB_PORT=1234
APP_TIMEZONE=Asia/Shanghai
```

README commands:

```bash
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev
pnpm test
pnpm test:e2e
pnpm build
```

Document that the current version intentionally permits anonymous public editing, that historical issues are read-only, and that `data/` plus `storage/` must be backed up together.

- [ ] **Step 4: Run the complete verification suite**

Run:

```bash
pnpm test
pnpm lint
pnpm build
pnpm test:e2e
```

Expected: all unit, integration, build, lint, and browser tests pass; no unhandled console errors appear.

- [ ] **Step 5: Review the implementation against the specification**

Run: `rg -n "TODO|TBD|FIXME" src server tests README.md`

Expected: no output. Manually map specification sections 3–12 to Tasks 4–12 and record any deviation in README under “Known limitations”; the only acceptable first-release limitations are the explicit non-goals in the specification.

- [ ] **Step 6: Commit the verified application**

```bash
git add tests README.md .env.example package.json
git commit -m "test: verify collaborative weekly end to end"
```

---

## Implementation Completion Criteria

- `pnpm test`, `pnpm lint`, `pnpm build`, and `pnpm test:e2e` pass from a clean checkout.
- Two independent browser contexts converge on the same document, including after one goes offline.
- Images, uploaded videos, embedded videos, and link cards render in another browser after insertion.
- Current issue rollover is idempotent and archives the old document read-only.
- Snapshots obey the 5-minute/200-update rule and restores are non-destructive.
- The gallery matches the approved centered dark exhibition direction; the editor matches the approved light three-column document panel.
- Mobile visitors can read, type, paste links, upload images, and reorder blocks without drag gestures.
