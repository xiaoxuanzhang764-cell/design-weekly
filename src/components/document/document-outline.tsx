'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useSyncExternalStore,
} from 'react'

import styles from './document.module.css'

export interface OutlineEditor {
  view: { dom: HTMLElement }
  on(event: 'update', listener: () => void): unknown
  off(event: 'update', listener: () => void): unknown
}

interface OutlineItem {
  id: string
  level: 2 | 3
  title: string
}

function collectHeadings(editor: OutlineEditor): OutlineItem[] {
  return Array.from(editor.view.dom.querySelectorAll<HTMLHeadingElement>('h2[id], h3[id]')).map(
    (heading) => {
      const title = heading.textContent?.trim() || '未命名小节'
      return { id: heading.id, level: Number(heading.tagName.slice(1)) as 2 | 3, title }
    },
  )
}

function useReducedMotion(override?: boolean) {
  const getSnapshot = useCallback(
    () =>
      override ??
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    [override],
  )
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (override !== undefined || typeof window.matchMedia !== 'function') {
        return () => undefined
      }
      const query = window.matchMedia('(prefers-reduced-motion: reduce)')
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    },
    [override],
  )

  return useSyncExternalStore(subscribe, getSnapshot, () => override ?? false)
}

export function DocumentOutline({
  editor,
  reducedMotion,
}: {
  editor: OutlineEditor | null
  reducedMotion?: boolean
}) {
  const [revision, refresh] = useReducer((value: number) => value + 1, 0)
  const prefersReducedMotion = useReducedMotion(reducedMotion)

  useEffect(() => {
    if (!editor) return
    editor.on('update', refresh)
    return () => {
      editor.off('update', refresh)
    }
  }, [editor])

  const items = useMemo(() => {
    // The editor mutates its DOM in place; revision makes those updates observable to React.
    void revision
    return editor ? collectHeadings(editor) : []
  }, [editor, revision])

  const navigate = (id: string) => {
    const heading = Array.from(
      editor?.view.dom.querySelectorAll<HTMLElement>('h2, h3') ?? [],
    ).find((element) => element.id === id)
    heading?.scrollIntoView({
        block: 'start',
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      })
  }

  return (
    <nav className={styles.outline} aria-label="本文目录">
      <h2 className={styles.panelHeading}>本文目录</h2>
      {items.length === 0 ? (
        <p className={styles.emptyOutline}>标题会显示在这里</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id} data-level={item.level}>
              <button type="button" onClick={() => navigate(item.id)}>
                {item.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}
