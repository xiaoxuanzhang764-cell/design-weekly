import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MediaImage } from '@/components/editor/extensions/media-image'
import { LinkCard } from '@/components/editor/extensions/link-card'
import { Video } from '@/components/editor/extensions/video'
import {
  getBlockMovementState,
  MediaToolbar,
  moveSelectedBlock,
} from '@/components/editor/media-toolbar'
import * as uploadClient from '@/features/media/upload-client'

const activeEditors: Editor[] = []
const trackEditor = (editor: Editor) => {
  activeEditors.push(editor)
  return editor
}

afterEach(() => {
  for (const editor of activeEditors.splice(0)) editor.destroy()
})

describe('media editor nodes', () => {
  it('persists image and video upload attributes in document JSON', () => {
    const editor = trackEditor(new Editor({
      extensions: [StarterKit, MediaImage, Video],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    }))

    editor.commands.insertContent([
      {
        type: 'image',
        attrs: {
          src: 'blob:image',
          mimeType: 'image/png',
          status: 'uploading',
          uploadId: 'upload-image',
        },
      },
      {
        type: 'video',
        attrs: {
          src: 'blob:video',
          poster: '/poster.webp',
          mimeType: 'video/webm',
          status: 'failed',
          uploadId: 'upload-video',
        },
      },
    ])

    expect(editor.getJSON().content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'image',
          attrs: expect.objectContaining({
            mimeType: 'image/png',
            status: 'uploading',
            uploadId: 'upload-image',
          }),
        }),
        expect.objectContaining({
          type: 'video',
          attrs: expect.objectContaining({
            poster: '/poster.webp',
            mimeType: 'video/webm',
            status: 'failed',
            uploadId: 'upload-video',
          }),
        }),
      ]),
    )
  })

  it('round-trips every custom video attribute through HTML', () => {
    const source = trackEditor(new Editor({ extensions: [StarterKit, Video] }))
    source.commands.insertContent({
      type: 'video',
      attrs: {
        error: '上传中断',
        mimeType: 'video/webm',
        poster: '/poster.webp',
        src: '/clip.webm',
        status: 'failed',
        uploadId: 'upload-video',
      },
    })

    const html = source.getHTML()
    expect(html).toContain('data-error="上传中断"')
    expect(html).toContain('data-mime-type="video/webm"')
    expect(html).toContain('data-status="failed"')
    expect(html).toContain('data-upload-id="upload-video"')

    const parsed = trackEditor(new Editor({ extensions: [StarterKit, Video], content: html }))
    expect(parsed.getJSON().content?.find((node) => node.type === 'video')?.attrs).toMatchObject({
      error: '上传中断',
      mimeType: 'video/webm',
      poster: '/poster.webp',
      src: '/clip.webm',
      status: 'failed',
      uploadId: 'upload-video',
    })
  })
})

describe('MediaToolbar', () => {
  afterEach(() => vi.restoreAllMocks())

  it('inserts a local uploading node, replaces it on success, and revokes the URL', async () => {
    const user = userEvent.setup()
    const inserted: Array<Record<string, unknown>> = []
    const updated: Array<Record<string, unknown>> = []
    const editor = {
      chain: () => ({
        focus() {
          return this
        },
        insertContent(content: Record<string, unknown>) {
          inserted.push(content)
          return this
        },
        run: () => true,
      }),
    }
    vi.spyOn(uploadClient, 'uploadMedia').mockResolvedValue({
      id: '7d9b0c17-b4cb-4c80-aa83-743b47ec7108',
      url: '/uploads/2026/07/server.webp',
      kind: 'image',
      mimeType: 'image/png',
      byteSize: 8,
    })
    const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    render(
      <MediaToolbar
        editor={editor as never}
        issueId="issue-2026-07-13"
        updateNode={(_editor, _uploadId, attrs) => updated.push(attrs)}
      />,
    )
    await user.upload(
      screen.getByLabelText('选择图片文件'),
      new File(['png-data'], 'reference.png', { type: 'image/png' }),
    )

    expect(inserted[0]).toMatchObject({
      type: 'image',
      attrs: { src: 'blob:preview', status: 'uploading', mimeType: 'image/png' },
    })
    await waitFor(() =>
      expect(updated).toContainEqual(
        expect.objectContaining({
          src: '/uploads/2026/07/server.webp',
          status: 'ready',
          mimeType: 'image/png',
        }),
      ),
    )
    expect(uploadClient.uploadMedia).toHaveBeenCalledWith(
      expect.any(File),
      'issue-2026-07-13',
    )
    expect(objectUrl).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:preview')
  })

  it('marks a failed node and exposes keyboard buttons to retry or remove it', async () => {
    const user = userEvent.setup()
    const inserted: Array<Record<string, unknown>> = []
    const updated: Array<Record<string, unknown>> = []
    const removed: string[] = []
    const editor = {
      chain: () => ({
        focus() {
          return this
        },
        insertContent(content: Record<string, unknown>) {
          inserted.push(content)
          return this
        },
        run: () => true,
      }),
    }
    vi.spyOn(uploadClient, 'uploadMedia')
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce({
        id: '7d9b0c17-b4cb-4c80-aa83-743b47ec7108',
        url: '/uploads/retried.mp4',
        kind: 'video',
        mimeType: 'video/mp4',
        byteSize: 5,
      })
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:retry')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    render(
      <MediaToolbar
        editor={editor as never}
        issueId="issue-2026-07-13"
        removeNode={(_editor, uploadId) => removed.push(uploadId)}
        updateNode={(_editor, _uploadId, attrs) => updated.push(attrs)}
      />,
    )
    await user.upload(
      screen.getByLabelText('选择视频文件'),
      new File(['video'], 'demo.mp4', { type: 'video/mp4' }),
    )

    await waitFor(() => expect(screen.getByRole('button', { name: '重试 demo.mp4' })).toBeVisible())
    expect(screen.getByRole('button', { name: '移除 demo.mp4' })).toBeVisible()
    expect(updated).toContainEqual(
      expect.objectContaining({ status: 'failed', error: '网络错误' }),
    )
    expect(revoke).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '重试 demo.mp4' }))
    await waitFor(() =>
      expect(updated).toContainEqual(
        expect.objectContaining({ src: '/uploads/retried.mp4', status: 'ready' }),
      ),
    )
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:first')

    vi.mocked(uploadClient.uploadMedia).mockRejectedValueOnce(new Error('再次失败'))
    await user.upload(
      screen.getByLabelText('选择视频文件'),
      new File(['next'], 'remove.mp4', { type: 'video/mp4' }),
    )
    await waitFor(() => expect(screen.getByRole('button', { name: '移除 remove.mp4' })).toBeVisible())
    expect(revoke).not.toHaveBeenCalledWith('blob:retry')
    await user.click(screen.getByRole('button', { name: '移除 remove.mp4' }))
    expect(removed).toHaveLength(1)
    expect(revoke).toHaveBeenCalledWith('blob:retry')
  })

  it('allows only one retry in flight and disables retry and remove', async () => {
    const user = userEvent.setup()
    const editor = {
      chain: () => ({
        focus() {
          return this
        },
        insertContent() {
          return this
        },
        run: () => true,
      }),
    }
    let finishRetry: ((value: uploadClient.UploadedMedia) => void) | undefined
    vi.spyOn(uploadClient, 'uploadMedia')
      .mockRejectedValueOnce(new Error('first failure'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRetry = resolve
          }),
      )
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:single-flight')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    render(
      <MediaToolbar
        editor={editor as never}
        issueId="issue-2026-07-13"
        removeNode={vi.fn()}
        updateNode={vi.fn()}
      />,
    )
    await user.upload(
      screen.getByLabelText('选择图片文件'),
      new File(['image'], 'single.png', { type: 'image/png' }),
    )
    const retry = await screen.findByRole('button', { name: '重试 single.png' })
    await user.dblClick(retry)

    expect(uploadClient.uploadMedia).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: '重试 single.png' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '移除 single.png' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')

    finishRetry?.({
      id: '7d9b0c17-b4cb-4c80-aa83-743b47ec7108',
      url: '/uploads/server.webp',
      kind: 'image',
      mimeType: 'image/png',
      byteSize: 5,
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '重试 single.png' })).not.toBeInTheDocument(),
    )
  })
})

describe('keyboard block ordering', () => {
  const createEditor = () =>
    trackEditor(new Editor({
      extensions: [StarterKit, MediaImage, Video, LinkCard],
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '段落' }] },
          { type: 'image', attrs: { src: '/image.webp' } },
          { type: 'linkCard', attrs: { id: 'card', url: 'https://example.com' } },
          { type: 'video', attrs: { src: '/video.mp4' } },
          { type: 'paragraph', content: [{ type: 'text', text: '结尾' }] },
        ],
      },
    }))

  it('moves the selected paragraph down and keeps it selected for moving back up', () => {
    const editor = createEditor()
    editor.commands.setTextSelection(1)

    expect(moveSelectedBlock(editor, 'down')).toBe(true)
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      'image',
      'paragraph',
      'linkCard',
      'video',
      'paragraph',
    ])
    expect(moveSelectedBlock(editor, 'up')).toBe(true)
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      'paragraph',
      'image',
      'linkCard',
      'video',
      'paragraph',
    ])
  })

  it.each([
    ['image', 4, 'down', ['paragraph', 'linkCard', 'image', 'video', 'paragraph']],
    ['linkCard', 5, 'up', ['paragraph', 'linkCard', 'image', 'video', 'paragraph']],
    ['video', 6, 'up', ['paragraph', 'image', 'video', 'linkCard', 'paragraph']],
  ] as const)('moves a selected %s block with a document transaction', (_type, position, direction, order) => {
    const editor = createEditor()
    editor.commands.setNodeSelection(position)

    expect(moveSelectedBlock(editor, direction)).toBe(true)
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(order)
  })

  it('disables movement at document boundaries', () => {
    const editor = createEditor()
    editor.commands.setTextSelection(1)
    expect(getBlockMovementState(editor)).toEqual({ canMoveDown: true, canMoveUp: false })
    expect(moveSelectedBlock(editor, 'up')).toBe(false)

    editor.commands.setTextSelection(8)
    expect(getBlockMovementState(editor)).toEqual({ canMoveDown: false, canMoveUp: true })
    expect(moveSelectedBlock(editor, 'down')).toBe(false)
  })
})
