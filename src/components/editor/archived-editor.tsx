'use client'

import type { Editor as TiptapEditor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useMemo } from 'react'
import * as Y from 'yjs'

import { createReadOnlyEditorExtensions } from './editor-extensions'
import styles from './editor.module.css'

function ArchivedDocument({
  initialState,
  onEditorReady,
}: {
  initialState: string
  onEditorReady?: (editor: TiptapEditor | null) => void
}) {
  const document = useMemo(() => {
    const value = Uint8Array.from(atob(initialState), (character) => character.charCodeAt(0))
    const next = new Y.Doc()
    Y.applyUpdate(next, value)
    return next
  }, [initialState])
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: false,
      extensions: createReadOnlyEditorExtensions(document),
      editorProps: {
        attributes: {
          'aria-label': '周刊正文',
          'aria-readonly': 'true',
          class: styles.document,
        },
      },
    },
    [document],
  )

  useEffect(() => {
    onEditorReady?.(editor)
    return () => onEditorReady?.(null)
  }, [editor, onEditorReady])

  return <EditorContent editor={editor} className={styles.editor} />
}

export function ArchivedEditor(props: {
  initialState: string | null
  onEditorReady?: (editor: TiptapEditor | null) => void
}) {
  if (!props.initialState) return <p className={styles.archiveEmpty}>暂无可读内容</p>
  return <ArchivedDocument initialState={props.initialState} onEditorReady={props.onEditorReady} />
}
