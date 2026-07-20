'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ArchivedEditor } from '@/components/editor/archived-editor'
import type { SnapshotSummary } from '@/server/db/snapshots-repository'

import styles from './document.module.css'

interface VersionHistoryProps {
  issueId: string
  readOnly: boolean
}

const reasonLabels: Record<string, string> = {
  interval: '自动保存（定时）',
  volume: '自动保存（更新量）',
  manual: '手动恢复',
  archive: '最终归档',
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

export function VersionHistory({ issueId, readOnly }: VersionHistoryProps) {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([])
  const [preview, setPreview] = useState<(SnapshotSummary & { stateBase64: string }) | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<SnapshotSummary | null>(null)
  const [message, setMessage] = useState('')
  const [restoring, setRestoring] = useState(false)
  const dialogTrigger = useRef<HTMLButtonElement | null>(null)
  const previewClose = useRef<HTMLButtonElement>(null)
  const restoreCancel = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const modalOpen = Boolean(preview || restoreTarget)

  const closeDialog = useCallback(() => {
    setPreview(null)
    setRestoreTarget(null)
    queueMicrotask(() => dialogTrigger.current?.focus())
  }, [])

  useEffect(() => {
    if (preview) previewClose.current?.focus()
    if (restoreTarget) restoreCancel.current?.focus()
  }, [preview, restoreTarget])

  useEffect(() => {
    if (!modalOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDialog()
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      const controls = [...(dialog?.querySelectorAll<HTMLElement>(
        'a[href],area[href],button,input,select,textarea,iframe,video[controls],audio[controls],summary,[contenteditable="true"],[tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((element) =>
        !element.matches(':disabled,[hidden],[inert]')
        && !element.closest('[hidden],[inert]'),
      )
      if (controls.length === 0) return
      event.preventDefault()
      const currentIndex = controls.indexOf(document.activeElement as HTMLElement)
      const offset = event.shiftKey ? -1 : 1
      const nextIndex = currentIndex < 0
        ? 0
        : (currentIndex + offset + controls.length) % controls.length
      controls[nextIndex].focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeDialog, modalOpen])

  useEffect(() => {
    if (!modalOpen || !dialogRef.current) return
    const dialog = dialogRef.current
    const siblings = [...document.body.children].filter((child) => child !== dialog)
    const previous = siblings.map((element) => ({
      element: element as HTMLElement,
      inert: (element as HTMLElement).inert,
      inertAttribute: element.hasAttribute('inert'),
      ariaHidden: element.getAttribute('aria-hidden'),
    }))
    for (const { element } of previous) {
      element.inert = true
      element.setAttribute('inert', '')
      element.setAttribute('aria-hidden', 'true')
    }
    return () => {
      for (const state of previous) {
        state.element.inert = state.inert
        if (!state.inertAttribute) state.element.removeAttribute('inert')
        if (state.ariaHidden === null) state.element.removeAttribute('aria-hidden')
        else state.element.setAttribute('aria-hidden', state.ariaHidden)
      }
    }
  }, [modalOpen])

  useEffect(() => {
    let active = true
    void fetch(`/api/snapshots/${encodeURIComponent(issueId)}`)
      .then((response) => response.json())
      .then((body: { snapshots?: SnapshotSummary[] }) => {
        if (active) setSnapshots(body.snapshots ?? [])
      })
      .catch(() => {
        if (active) setMessage('版本历史暂时无法加载')
      })
    return () => {
      active = false
    }
  }, [issueId])

  async function restore() {
    if (!restoreTarget) return
    setRestoring(true)
    setMessage('')
    try {
      const response = await fetch(`/api/snapshots/${encodeURIComponent(issueId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ snapshotId: restoreTarget.id, confirm: true }),
      })
      if (!response.ok) throw new Error('restore failed')
      const body = (await response.json()) as { snapshot?: SnapshotSummary }
      if (body.snapshot) setSnapshots((items) => [body.snapshot!, ...items])
      setRestoreTarget(null)
      queueMicrotask(() => dialogTrigger.current?.focus())
      setMessage('已恢复为新的当前版本')
    } catch {
      setMessage('恢复失败，请稍后重试')
    } finally {
      setRestoring(false)
    }
  }

  async function openPreview(snapshot: SnapshotSummary, trigger: HTMLButtonElement) {
    dialogTrigger.current = trigger
    try {
      const response = await fetch(
        `/api/snapshots/${encodeURIComponent(issueId)}?snapshotId=${snapshot.id}`,
      )
      if (!response.ok) throw new Error('preview failed')
      const body = (await response.json()) as {
        snapshot: SnapshotSummary & { stateBase64: string }
      }
      setPreview(body.snapshot)
    } catch {
      setMessage('版本预览暂时无法加载')
    }
  }

  function openRestore(snapshot: SnapshotSummary, trigger: HTMLButtonElement) {
    dialogTrigger.current = trigger
    setRestoreTarget(snapshot)
  }

  return (
    <section className={styles.versionHistory} aria-labelledby="version-history-heading">
      <div
        data-testid="version-background"
        aria-hidden={modalOpen ? 'true' : undefined}
        inert={modalOpen ? true : undefined}
      >
      <h2 id="version-history-heading" className={styles.panelHeading}>版本历史</h2>
      {message ? <p role="status" className={styles.versionMessage}>{message}</p> : null}
      {snapshots.length === 0 ? <p className={styles.emptyOutline}>暂无历史版本</p> : (
        <ul className={styles.versionList}>
          {snapshots.map((snapshot) => (
            <li key={snapshot.id}>
              <strong>{reasonLabels[snapshot.reason] ?? snapshot.reason}</strong>
              <time dateTime={snapshot.createdAt}>{formatTime(snapshot.createdAt)}</time>
              <small>累计 {snapshot.updateCount} 次更新</small>
              <div>
                <button
                  type="button"
                  onClick={(event) => void openPreview(snapshot, event.currentTarget)}
                >预览</button>
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={(event) => openRestore(snapshot, event.currentTarget)}
                  >恢复此版本</button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      </div>

      {preview ? createPortal(
        <div ref={dialogRef} data-version-dialog role="dialog" aria-modal="true" aria-label="版本预览" className={styles.versionDialog}>
          <div>
            <p>只读预览</p>
            <h3>{formatTime(preview.createdAt)}</h3>
            <p>{reasonLabels[preview.reason] ?? preview.reason} · 累计 {preview.updateCount} 次更新</p>
            <ArchivedEditor initialState={preview.stateBase64} />
            <button ref={previewClose} type="button" onClick={closeDialog}>关闭预览</button>
          </div>
        </div>, document.body,
      ) : null}

      {restoreTarget ? createPortal(
        <div ref={dialogRef} data-version-dialog role="dialog" aria-modal="true" aria-label="确认恢复版本" className={styles.versionDialog}>
          <div>
            <h3>确认恢复版本</h3>
            <p>将当前文档恢复到 {formatTime(restoreTarget.createdAt)}。现有版本仍会保留。</p>
            <button ref={restoreCancel} type="button" onClick={closeDialog}>取消</button>
            <button type="button" disabled={restoring} onClick={() => void restore()}>
              {restoring ? '正在恢复…' : '确认恢复'}
            </button>
          </div>
        </div>, document.body,
      ) : null}
    </section>
  )
}
