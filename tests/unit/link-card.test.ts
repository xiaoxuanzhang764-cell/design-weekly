import { Editor } from '@tiptap/core'
import Youtube from '@tiptap/extension-youtube'
import StarterKit from '@tiptap/starter-kit'
import { waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  handleLinkPaste,
  LinkCard,
  type LinkPreviewPayload,
} from '@/components/editor/extensions/link-card'
import { SafeLink } from '@/components/editor/extensions/safe-link'

const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

function createEditor() {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      SafeLink,
      Youtube.configure({ addPasteHandler: false }),
      LinkCard,
    ],
    content: '<p></p>',
  })
  editors.push(editor)
  return editor
}

function pasteEvent(text: string) {
  return {
    clipboardData: { getData: () => text },
    preventDefault: vi.fn(),
  }
}

describe('LinkCard', () => {
  it('rejects a rich HTML link card with a javascript href', () => {
    const editor = createEditor()
    editor.commands.setContent(
      '<a data-link-card href="javascript:alert(1)" data-title="Unsafe">Unsafe</a>',
    )

    expect(editor.getJSON().content?.[0]?.type).not.toBe('linkCard')
    expect(JSON.stringify(editor.getJSON())).not.toContain('javascript:')
    expect(editor.getHTML()).not.toContain('javascript:')
  })

  it('sanitizes rich HTML link-card attrs before persisting them', () => {
    const editor = createEditor()
    editor.commands.setContent(
      `<a data-link-card href="https://example.com" data-title="${'t'.repeat(1_000)}" data-description="${'d'.repeat(1_000)}" data-site-name="${'s'.repeat(1_000)}" data-image="javascript:alert(1)">Example</a>`,
    )

    const attrs = editor.getJSON().content?.[0]?.attrs
    expect(attrs?.url).toBe('https://example.com/')
    expect(attrs?.title).toHaveLength(200)
    expect(attrs?.description).toHaveLength(500)
    expect(attrs?.siteName).toHaveLength(100)
    expect(attrs?.image).toBeNull()
  })

  it('never renders a programmatic link card with an unsafe href', () => {
    const editor = createEditor()
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'linkCard',
          attrs: { url: 'javascript:alert(1)', title: 'Unsafe', status: 'ready' },
        },
      ],
    })

    expect(editor.getHTML()).not.toContain('javascript:')
    expect(editor.getHTML()).not.toContain('href=')
  })

  it('round-trips symmetric attrs as a plain secure external link', () => {
    const attrs = {
      id: 'card-1',
      url: 'https://example.com/article',
      title: 'An article',
      description: 'Summary',
      image: 'https://example.com/cover.jpg',
      siteName: 'Example',
      status: 'ready',
    }
    const editor = createEditor()
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'linkCard', attrs }],
    })

    const html = editor.getHTML()
    expect(html).toContain('<a')
    expect(html).toContain('href="https://example.com/article"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).not.toContain('<iframe')

    const restored = createEditor()
    restored.commands.setContent(html)
    expect(restored.getJSON().content?.[0]).toEqual({ type: 'linkCard', attrs })
  })

  it('inserts one loading card and updates the same stable id after preview resolves', async () => {
    let resolvePreview!: (value: LinkPreviewPayload) => void
    const fetchPreview = vi.fn(
      () => new Promise<LinkPreviewPayload>((resolve) => (resolvePreview = resolve)),
    )
    const editor = createEditor()
    const event = pasteEvent('  https://example.com/article  ')

    expect(
      handleLinkPaste(editor.view, event, {
        createId: () => 'preview-1',
        fetchPreview,
      }),
    ).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'linkCard',
      attrs: {
        id: 'preview-1',
        status: 'loading',
        url: 'https://example.com/article',
      },
    })

    resolvePreview({
      title: 'Article',
      description: 'Summary',
      image: 'https://example.com/cover.jpg',
      siteName: 'Example',
      url: 'https://example.com/article',
    })
    await waitFor(() =>
      expect(editor.getJSON().content?.[0]).toMatchObject({
        type: 'linkCard',
        attrs: { id: 'preview-1', title: 'Article', status: 'ready' },
      }),
    )
  })

  it('bounds abnormal API metadata before writing attrs into the document', async () => {
    const editor = createEditor()
    handleLinkPaste(editor.view, pasteEvent('https://example.com/article'), {
      createId: () => 'preview-1',
      fetchPreview: async () => ({
        title: 't'.repeat(10_000),
        description: 'd'.repeat(10_000),
        image: `https://example.com/${'i'.repeat(3_000)}`,
        siteName: 's'.repeat(10_000),
        url: 'https://example.com/article',
      }),
    })

    await waitFor(() =>
      expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({ status: 'ready' }),
    )
    const attrs = editor.getJSON().content?.[0]?.attrs
    expect(attrs?.title).toHaveLength(200)
    expect(attrs?.description).toHaveLength(500)
    expect(attrs?.siteName).toHaveLength(100)
    expect(attrs?.image).toBeNull()
  })

  it('does not turn a pasted URL longer than 2048 characters into a shared node', () => {
    const editor = createEditor()
    const handled = handleLinkPaste(
      editor.view,
      pasteEvent(`https://example.com/${'a'.repeat(2048)}`),
      { createId: () => 'preview-1', fetchPreview: vi.fn() },
    )

    expect(handled).toBe(false)
    expect(editor.getJSON().content?.[0]?.type).toBe('paragraph')
  })

  it('uses YouTube for a valid URL and falls back to a card for unsupported URLs', () => {
    const fetchPreview = vi.fn(async () => ({
      title: null,
      description: null,
      image: null,
      siteName: null,
      url: 'https://youtube.com.evil.example/watch?v=abc',
    }))
    const youtube = createEditor()

    expect(
      handleLinkPaste(youtube.view, pasteEvent('https://youtu.be/dQw4w9WgXcQ'), {
        createId: () => 'preview-1',
        fetchPreview,
      }),
    ).toBe(true)
    expect(youtube.getJSON().content?.[0]).toMatchObject({
      type: 'youtube',
      attrs: { src: 'https://youtu.be/dQw4w9WgXcQ' },
    })
    expect(fetchPreview).not.toHaveBeenCalled()

    const unsupported = createEditor()
    expect(
      handleLinkPaste(
        unsupported.view,
        pasteEvent('https://youtube.com.evil.example/watch?v=abc'),
        { createId: () => 'preview-1', fetchPreview },
      ),
    ).toBe(true)
    expect(unsupported.getJSON().content?.[0]?.type).toBe('linkCard')
  })

  it('does not intercept a range selection, multiple values, or a read-only view', () => {
    const editor = createEditor()
    editor.commands.setContent('<p>selected text</p>')
    editor.commands.setTextSelection({ from: 1, to: 5 })

    expect(
      handleLinkPaste(editor.view, pasteEvent('https://example.com'), {
        createId: () => 'preview-1',
        fetchPreview: vi.fn(),
      }),
    ).toBe(false)

    editor.commands.setTextSelection(1)
    expect(
      handleLinkPaste(editor.view, pasteEvent('https://a.example https://b.example'), {
        createId: () => 'preview-1',
        fetchPreview: vi.fn(),
      }),
    ).toBe(false)

    editor.setEditable(false)
    expect(
      handleLinkPaste(editor.view, pasteEvent('https://example.com'), {
        createId: () => 'preview-1',
        fetchPreview: vi.fn(),
      }),
    ).toBe(false)
  })

  it('marks failures as a link fallback and ignores stale async results', async () => {
    const failed = createEditor()
    handleLinkPaste(failed.view, pasteEvent('https://example.com/fail'), {
      createId: () => 'preview-1',
      fetchPreview: vi.fn(async () => Promise.reject(new Error('internal'))),
    })
    await waitFor(() =>
      expect(failed.getJSON().content?.[0]).toMatchObject({
        type: 'linkCard',
        attrs: { status: 'failed', url: 'https://example.com/fail' },
      }),
    )
    expect(failed.getHTML()).toContain('rel="noopener noreferrer"')

    let resolvePreview!: (value: LinkPreviewPayload) => void
    const pending = new Promise<LinkPreviewPayload>((resolve) => (resolvePreview = resolve))
    const stale = createEditor()
    handleLinkPaste(stale.view, pasteEvent('https://example.com/stale'), {
      createId: () => 'preview-1',
      fetchPreview: () => pending,
    })
    stale.commands.updateAttributes('linkCard', { status: 'ready', title: 'Manual title' })
    resolvePreview({
      title: 'Stale title',
      description: null,
      image: null,
      siteName: null,
      url: 'https://example.com/stale',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(stale.getJSON().content?.[0]).toMatchObject({
      attrs: { title: 'Manual title', status: 'ready' },
    })
  })
})

describe('SafeLink', () => {
  it('drops rich HTML rel and target attrs and always renders a safe external link', () => {
    const editor = createEditor()
    editor.commands.setContent(
      '<p><a href="https://example.com" target="_self" rel="opener">Example</a></p>',
    )

    const mark = editor.getJSON().content?.[0]?.content?.[0]?.marks?.[0]
    expect(mark).toMatchObject({
      type: 'link',
      attrs: { href: 'https://example.com', rel: null, target: null },
    })
    expect(JSON.stringify(mark)).not.toContain('opener')
    expect(editor.getHTML()).toContain(
      '<a target="_blank" rel="noopener noreferrer" href="https://example.com">Example</a>',
    )

    const restored = createEditor()
    restored.commands.setContent(editor.getHTML())
    expect(restored.getHTML()).toContain('target="_blank" rel="noopener noreferrer"')
    expect(JSON.stringify(restored.getJSON())).not.toContain('rel":"opener')
  })
})
