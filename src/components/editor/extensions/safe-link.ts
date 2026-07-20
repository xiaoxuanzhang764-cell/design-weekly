import { mergeAttributes } from '@tiptap/core'
import Link, { isAllowedUri } from '@tiptap/extension-link'

export const SafeLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      target: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
      rel: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    }
  },

  renderHTML({ HTMLAttributes }) {
    const parsedAttributes = { ...HTMLAttributes }
    delete parsedAttributes.rel
    delete parsedAttributes.target
    const href = parsedAttributes.href
    const allowed = this.options.isAllowedUri(href, {
      defaultValidate: (value) => !!isAllowedUri(value, this.options.protocols),
      protocols: this.options.protocols,
      defaultProtocol: this.options.defaultProtocol,
    })
    return [
      'a',
      mergeAttributes(
        this.options.HTMLAttributes,
        { ...parsedAttributes, href: allowed ? href : '' },
        { target: '_blank', rel: 'noopener noreferrer' },
      ),
      0,
    ]
  },
})
