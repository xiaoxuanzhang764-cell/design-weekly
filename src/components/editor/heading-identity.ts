import { Extension, type Editor } from '@tiptap/core'

let fallbackSequence = 0

function createHeadingId() {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `heading-${uuid}`
  fallbackSequence += 1
  return `heading-${Date.now().toString(36)}-${fallbackSequence.toString(36)}`
}

function assignMissingHeadingIds(editor: Editor) {
  editor.commands.command(({ dispatch, state, tr }) => {
    let changed = false
    state.doc.descendants((node, position) => {
      if (node.type.name !== 'heading' || node.attrs.id) return
      tr.setNodeMarkup(position, undefined, { ...node.attrs, id: createHeadingId() })
      changed = true
    })
    if (changed) dispatch?.(tr)
    return changed
  })
}

export const HeadingIdentity = Extension.create({
  name: 'headingIdentity',

  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          id: {
            default: null,
            parseHTML: (element) => element.getAttribute('id'),
            renderHTML: (attributes) => attributes.id ? { id: attributes.id } : {},
          },
        },
      },
    ]
  },

  onCreate() {
    assignMissingHeadingIds(this.editor)
  },

  onTransaction({ editor, transaction }) {
    if (transaction.docChanged) assignMissingHeadingIds(editor)
  },
})
