'use client'

import type { Editor } from '@tiptap/core'
import { useEffect, useRef, useState } from 'react'

import { uploadMedia } from '@/features/media/upload-client'
import type { MediaKind } from '@/features/media/validation'

import styles from './editor.module.css'

type MediaNodeAttributes = Record<string, unknown>
type BlockMovementDirection = 'down' | 'up'

export function getBlockMovementState(editor: Editor) {
  if (!editor.state) return { canMoveDown: false, canMoveUp: false }
  const index = editor.state.selection.$from.index(0)
  return {
    canMoveDown: index < editor.state.doc.childCount - 1,
    canMoveUp: index > 0,
  }
}

export function moveSelectedBlock(editor: Editor, direction: BlockMovementDirection) {
  const { doc, selection, tr } = editor.state
  const index = selection.$from.index(0)
  if (
    index < 0 ||
    index >= doc.childCount ||
    (direction === 'up' && index === 0) ||
    (direction === 'down' && index === doc.childCount - 1)
  ) {
    return false
  }

  let position = 0
  for (let childIndex = 0; childIndex < index; childIndex += 1) {
    position += doc.child(childIndex).nodeSize
  }
  const node = doc.child(index)
  const destination =
    direction === 'up'
      ? position - doc.child(index - 1).nodeSize
      : position + doc.child(index + 1).nodeSize
  tr.delete(position, position + node.nodeSize).insert(destination, node)

  const movedNode = tr.doc.nodeAt(destination)
  editor.view.dispatch(tr.scrollIntoView())
  if (movedNode?.isTextblock) {
    editor.commands.setTextSelection(destination + 1)
  } else {
    editor.commands.setNodeSelection(destination)
  }
  editor.view.focus()
  return true
}

export function updateMediaNode(
  editor: Editor,
  uploadId: string,
  attributes: MediaNodeAttributes,
) {
  let changed = false
  const transaction = editor.state.tr
  editor.state.doc.descendants((node, position) => {
    if (changed || node.attrs.uploadId !== uploadId) return
    transaction.setNodeMarkup(position, undefined, { ...node.attrs, ...attributes })
    changed = true
  })
  if (changed) editor.view.dispatch(transaction)
}

export function removeMediaNode(editor: Editor, uploadId: string) {
  let range: { from: number; to: number } | undefined
  editor.state.doc.descendants((node, position) => {
    if (range || node.attrs.uploadId !== uploadId) return
    range = { from: position, to: position + node.nodeSize }
  })
  if (range) editor.view.dispatch(editor.state.tr.delete(range.from, range.to))
}

interface FailedUpload {
  file: File
  kind: MediaKind
  status: 'failed' | 'uploading'
  uploadId: string
}

export interface MediaToolbarProps {
  editor: Editor | null
  issueId: string
  removeNode?: typeof removeMediaNode
  updateNode?: typeof updateMediaNode
}

function createUploadId() {
  return globalThis.crypto?.randomUUID?.() ?? `upload-${Date.now()}-${Math.random()}`
}

export function MediaToolbar({
  editor,
  issueId,
  removeNode = removeMediaNode,
  updateNode = updateMediaNode,
}: MediaToolbarProps) {
  const [failures, setFailures] = useState<FailedUpload[]>([])
  const [movement, setMovement] = useState(() =>
    editor
      ? getBlockMovementState(editor)
      : { canMoveDown: false, canMoveUp: false },
  )
  const previewUrls = useRef(new Map<string, string>())
  const attempts = useRef(new Map<string, number>())
  const inFlight = useRef(new Set<string>())

  useEffect(
    () => () => {
      attempts.current.forEach((attempt, uploadId) => {
        attempts.current.set(uploadId, attempt + 1)
      })
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url))
      previewUrls.current.clear()
      inFlight.current.clear()
    },
    [],
  )

  useEffect(() => {
    if (!editor || typeof editor.on !== 'function') return
    const updateMovement = () => setMovement(getBlockMovementState(editor))
    updateMovement()
    editor.on('selectionUpdate', updateMovement)
    editor.on('update', updateMovement)
    return () => {
      editor.off('selectionUpdate', updateMovement)
      editor.off('update', updateMovement)
    }
  }, [editor])

  if (!editor) return null

  const runUpload = async (
    file: File,
    kind: MediaKind,
    existingUploadId?: string,
  ) => {
    const uploadId = existingUploadId ?? createUploadId()
    if (inFlight.current.has(uploadId)) return
    const previewUrl = previewUrls.current.get(uploadId) ?? URL.createObjectURL(file)
    previewUrls.current.set(uploadId, previewUrl)
    const attempt = (attempts.current.get(uploadId) ?? 0) + 1
    attempts.current.set(uploadId, attempt)
    inFlight.current.add(uploadId)

    if (existingUploadId) {
      setFailures((current) =>
        current.map((item) =>
          item.uploadId === uploadId ? { ...item, status: 'uploading' } : item,
        ),
      )
      updateNode(editor, uploadId, {
        error: null,
        mimeType: file.type,
        src: previewUrl,
        status: 'uploading',
      })
    } else {
      editor
        .chain()
        .focus()
        .insertContent({
          type: kind === 'image' ? 'image' : 'video',
          attrs: {
            error: null,
            mimeType: file.type,
            poster: null,
            src: previewUrl,
            status: 'uploading',
            uploadId,
          },
        })
        .run()
    }

    try {
      const uploaded = await uploadMedia(file, issueId)
      if (attempts.current.get(uploadId) !== attempt) return
      updateNode(editor, uploadId, {
        error: null,
        mimeType: uploaded.mimeType,
        src: uploaded.url,
        status: 'ready',
      })
      setFailures((current) => current.filter((item) => item.uploadId !== uploadId))
      const currentPreview = previewUrls.current.get(uploadId)
      if (currentPreview) URL.revokeObjectURL(currentPreview)
      previewUrls.current.delete(uploadId)
    } catch (error) {
      if (attempts.current.get(uploadId) !== attempt) return
      const message = error instanceof Error ? error.message : '媒体上传失败，请稍后重试'
      updateNode(editor, uploadId, { error: message, status: 'failed' })
      setFailures((current) => [
        ...current.filter((item) => item.uploadId !== uploadId),
        { file, kind, status: 'failed', uploadId },
      ])
    } finally {
      if (attempts.current.get(uploadId) === attempt) inFlight.current.delete(uploadId)
    }
  }

  const selectFile = (kind: MediaKind, files: FileList | null) => {
    const file = files?.[0]
    if (file) void runUpload(file, kind)
  }

  return (
    <div className={styles.mediaToolbar} aria-label="编辑工具栏" role="toolbar">
      <button
        type="button"
        className={styles.mediaButton}
        aria-label="上移当前区块"
        disabled={!movement.canMoveUp}
        onClick={() => {
          moveSelectedBlock(editor, 'up')
          setMovement(getBlockMovementState(editor))
        }}
      >
        上移区块
      </button>
      <button
        type="button"
        className={styles.mediaButton}
        aria-label="下移当前区块"
        disabled={!movement.canMoveDown}
        onClick={() => {
          moveSelectedBlock(editor, 'down')
          setMovement(getBlockMovementState(editor))
        }}
      >
        下移区块
      </button>
      <label className={styles.mediaButton}>
        <span>添加图片</span>
        <input
          className={styles.mediaInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          aria-label="选择图片文件"
          onChange={(event) => {
            selectFile('image', event.currentTarget.files)
            event.currentTarget.value = ''
          }}
        />
      </label>
      <label className={styles.mediaButton}>
        <span>添加视频</span>
        <input
          className={styles.mediaInput}
          type="file"
          accept="video/mp4,video/webm"
          aria-label="选择视频文件"
          onChange={(event) => {
            selectFile('video', event.currentTarget.files)
            event.currentTarget.value = ''
          }}
        />
      </label>
      {failures.map((failure) => (
        <span
          aria-busy={failure.status === 'uploading'}
          className={styles.mediaFailure}
          key={failure.uploadId}
          role="status"
        >
          <span>{failure.file.name} 上传失败</span>
          <button
            type="button"
            aria-label={`重试 ${failure.file.name}`}
            disabled={failure.status === 'uploading'}
            onClick={() => void runUpload(failure.file, failure.kind, failure.uploadId)}
          >
            重试
          </button>
          <button
            type="button"
            aria-label={`移除 ${failure.file.name}`}
            disabled={failure.status === 'uploading'}
            onClick={() => {
              removeNode(editor, failure.uploadId)
              const previewUrl = previewUrls.current.get(failure.uploadId)
              if (previewUrl) URL.revokeObjectURL(previewUrl)
              previewUrls.current.delete(failure.uploadId)
              attempts.current.set(
                failure.uploadId,
                (attempts.current.get(failure.uploadId) ?? 0) + 1,
              )
              setFailures((current) =>
                current.filter((item) => item.uploadId !== failure.uploadId),
              )
            }}
          >
            移除
          </button>
        </span>
      ))}
    </div>
  )
}
