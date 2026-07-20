'use client'

import type { Editor } from '@tiptap/core'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ArchivedEditor } from '@/components/editor/archived-editor'
import { CollaborativeEditor } from '@/components/editor/collaborative-editor'
import type { IssueSummary } from '@/features/issues/types'

import { DocumentOutline } from './document-outline'
import { IssueSidebar } from './issue-sidebar'
import { PresenceList } from './presence-list'
import { SyncStatus } from './sync-status'
import { VersionHistory } from './version-history'
import styles from './document.module.css'

export interface DocumentShellProps {
  archivedState?: string | null
  issue: IssueSummary
  issues: IssueSummary[]
}

export function DocumentShell({ archivedState = null, issue, issues }: DocumentShellProps) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [informationOpen, setInformationOpen] = useState(false)
  const directoryTrigger = useRef<HTMLButtonElement>(null)
  const informationTrigger = useRef<HTMLButtonElement>(null)
  const directoryClose = useRef<HTMLButtonElement>(null)
  const informationClose = useRef<HTMLButtonElement>(null)
  const readOnly = issue.status === 'archived'
  const drawerOpen = directoryOpen || informationOpen

  const closeDrawers = useCallback(() => {
    const trigger = directoryOpen ? directoryTrigger.current : informationTrigger.current
    setDirectoryOpen(false)
    setInformationOpen(false)
    queueMicrotask(() => trigger?.focus())
  }, [directoryOpen])

  useEffect(() => {
    if (directoryOpen) directoryClose.current?.focus()
    if (informationOpen) informationClose.current?.focus()
  }, [directoryOpen, informationOpen])

  useEffect(() => {
    if (!drawerOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawers()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeDrawers, drawerOpen])

  return (
    <div className={styles.workspace}>
      <header
        className={styles.mobileBar}
        aria-hidden={drawerOpen ? 'true' : undefined}
        inert={drawerOpen ? true : undefined}
      >
        <button
          ref={directoryTrigger}
          type="button"
          aria-controls="issue-directory"
          aria-expanded={directoryOpen}
          onClick={() => setDirectoryOpen((open) => !open)}
        >
          打开周刊目录
        </button>
        <span>DW</span>
        <button
          ref={informationTrigger}
          type="button"
          aria-controls="document-information"
          aria-expanded={informationOpen}
          onClick={() => setInformationOpen((open) => !open)}
        >
          打开文档信息
        </button>
      </header>

      <nav
        className={styles.issueSidebar}
        id="issue-directory"
        aria-label="周刊目录"
        aria-hidden={informationOpen ? 'true' : undefined}
        data-open={directoryOpen}
        inert={informationOpen ? true : undefined}
      >
        <button
          ref={directoryClose}
          type="button"
          className={styles.drawerClose}
          onClick={closeDrawers}
        >
          关闭周刊目录
        </button>
        <IssueSidebar activeIssueId={issue.id} issues={issues} />
      </nav>

      <main
        className={styles.documentMain}
        aria-hidden={drawerOpen ? 'true' : undefined}
        inert={drawerOpen ? true : undefined}
      >
        <header className={styles.documentHeader}>
          <div>
            <p>{readOnly ? '历史归档' : '本周共创'}</p>
            <h1>{issue.title}</h1>
          </div>
          {readOnly ? <span className={styles.syncStatus}>已归档</span> : <SyncStatus />}
        </header>
        {readOnly ? <p className={styles.archiveNotice}>本期已归档，仅供阅读。</p> : null}
        {readOnly ? (
          <ArchivedEditor initialState={archivedState} onEditorReady={setEditor} />
        ) : (
          <CollaborativeEditor
            issueId={issue.id}
            onEditorReady={setEditor}
            readOnly={false}
          />
        )}
      </main>

      <aside
        className={styles.informationSidebar}
        id="document-information"
        aria-label="文档信息"
        aria-hidden={directoryOpen ? 'true' : undefined}
        data-open={informationOpen}
        inert={directoryOpen ? true : undefined}
      >
        <button
          ref={informationClose}
          type="button"
          className={styles.drawerClose}
          onClick={closeDrawers}
        >
          关闭文档信息
        </button>
        {readOnly ? null : <PresenceList />}
        <DocumentOutline editor={editor} />
        <VersionHistory issueId={issue.id} readOnly={readOnly} />
      </aside>

      {(directoryOpen || informationOpen) ? (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="关闭侧栏"
          onClick={closeDrawers}
        />
      ) : null}
    </div>
  )
}
