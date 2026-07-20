import Image from '@tiptap/extension-image'

export const MediaImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      error: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-error'),
        renderHTML: (attributes) =>
          attributes.error ? { 'data-error': attributes.error } : {},
      },
      mimeType: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-mime-type'),
        renderHTML: (attributes) =>
          attributes.mimeType ? { 'data-mime-type': attributes.mimeType } : {},
      },
      status: {
        default: 'ready',
        parseHTML: (element) => element.getAttribute('data-status') ?? 'ready',
        renderHTML: (attributes) => ({ 'data-status': attributes.status }),
      },
      uploadId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-upload-id'),
        renderHTML: (attributes) =>
          attributes.uploadId ? { 'data-upload-id': attributes.uploadId } : {},
      },
    }
  },
})
