import { mergeAttributes, Node } from '@tiptap/core'

export const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      error: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-error'),
        renderHTML: ({ error }) => (error ? { 'data-error': error } : {}),
      },
      mimeType: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-mime-type'),
        renderHTML: ({ mimeType }) =>
          mimeType ? { 'data-mime-type': mimeType } : {},
      },
      poster: {
        default: null,
        parseHTML: (element) => element.getAttribute('poster'),
        renderHTML: ({ poster }) => (poster ? { poster } : {}),
      },
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute('src'),
        renderHTML: ({ src }) => (src ? { src } : {}),
      },
      status: {
        default: 'ready',
        parseHTML: (element) => element.getAttribute('data-status') ?? 'ready',
        renderHTML: ({ status }) => ({ 'data-status': status }),
      },
      uploadId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-upload-id'),
        renderHTML: ({ uploadId }) =>
          uploadId ? { 'data-upload-id': uploadId } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'video[src]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'video',
      mergeAttributes(HTMLAttributes, {
        controls: 'true',
        preload: 'metadata',
      }),
    ]
  },
})
