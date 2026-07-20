'use client'

import { useHocuspocusProvider } from '@hocuspocus/provider-react'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useMemo, useSyncExternalStore } from 'react'

import { createEditorExtensions } from '@/components/editor/editor-extensions'
import { handleDefaultLinkPaste } from '@/components/editor/extensions/link-card'
import { MediaToolbar } from '@/components/editor/media-toolbar'
import {
  getAnonymousIdentity,
  type AnonymousIdentity,
} from '@/features/collaboration/identity'

import styles from './editor.module.css'

export interface CollaborativeEditorProps {
  issueId: string
  onEditorReady?: (editor: TiptapEditor | null) => void
  readOnly: boolean
}

const subscribeToBrowser = () => () => undefined
const getBrowserSnapshot = () => true
const getServerSnapshot = () => false

function Editor({
  identity,
  issueId,
  onEditorReady,
  readOnly,
}: CollaborativeEditorProps & { identity: AnonymousIdentity }) {
  const provider = useHocuspocusProvider()
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: !readOnly,
      extensions: createEditorExtensions(provider, identity),
      editorProps: {
        handlePaste: (view, event) => handleDefaultLinkPaste(view, event),
        attributes: {
          'aria-label': readOnly ? '周刊正文' : '周刊正文编辑区',
          'aria-readonly': String(readOnly),
          class: styles.document,
        },
      },
    },
    [provider, identity, readOnly],
  )

  useEffect(() => {
    onEditorReady?.(editor)
    return () => onEditorReady?.(null)
  }, [editor, onEditorReady])

  return (
    <>
      {!readOnly ? <MediaToolbar editor={editor} issueId={issueId} /> : null}
      <EditorContent editor={editor} className={styles.editor} />
    </>
  )
}

export function CollaborativeEditor({
  issueId,
  onEditorReady,
  readOnly,
}: CollaborativeEditorProps) {
  const isBrowser = useSyncExternalStore(
    subscribeToBrowser,
    getBrowserSnapshot,
    getServerSnapshot,
  )
  const identity = useMemo(
    () => (isBrowser ? getAnonymousIdentity(window.localStorage) : null),
    [isBrowser],
  )

  if (!identity) {
    return (
      <div className={styles.editor} aria-busy="true">
        <span className={styles.srOnly}>正在准备文档</span>
      </div>
    )
  }

  return (
    <Editor
      identity={identity}
      issueId={issueId}
      onEditorReady={onEditorReady}
      readOnly={readOnly}
    />
  )
}
