import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { HeadingIdentity } from '@/components/editor/heading-identity'

function headingIds(editor: Editor) {
  return (editor.getJSON().content ?? [])
    .filter((node) => node.type === 'heading')
    .map((node) => node.attrs?.id as string | null)
}

describe('HeadingIdentity', () => {
  it('assigns persistent unique ids once, even when an equal heading is inserted before them', async () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, HeadingIdentity],
      content: '<h2>同名标题</h2><h2>同名标题</h2>',
    })
    await waitFor(() => expect(headingIds(editor).every(Boolean)).toBe(true))
    const original = headingIds(editor)
    expect(original.every(Boolean)).toBe(true)
    expect(new Set(original).size).toBe(2)

    editor.commands.insertContentAt(0, {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '同名标题' }],
    })

    const afterInsert = headingIds(editor)
    expect(afterInsert.slice(1)).toEqual(original)
    expect(new Set(afterInsert).size).toBe(3)
    editor.destroy()
  })
})
