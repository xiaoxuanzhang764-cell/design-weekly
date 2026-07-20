import { mergeAttributes, Node, type Editor as TiptapEditor } from '@tiptap/core'
import { isValidYoutubeUrl } from '@tiptap/extension-youtube'

import {
  LINK_PREVIEW_LIMITS,
  sanitizePreviewText,
  sanitizePreviewUrl,
} from '@/features/links/preview-limits'

export interface LinkPreviewPayload {
  title: string | null
  description: string | null
  image: string | null
  siteName: string | null
  url: string
}

export interface LinkPasteOptions {
  createId: () => string
  fetchPreview: (url: string) => Promise<LinkPreviewPayload>
}

interface PasteLikeEvent {
  clipboardData: Pick<DataTransfer, 'getData'> | null
  preventDefault(): void
}

type LinkPasteView = TiptapEditor['view']

function singleHttpUrl(text: string) {
  const value = text.trim()
  if (!value || /\s/.test(value)) return null
  return sanitizePreviewUrl(value)
}

async function requestLinkPreview(url: string): Promise<LinkPreviewPayload> {
  const response = await fetch('/api/link-preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!response.ok) throw new Error('Link preview unavailable')
  return (await response.json()) as LinkPreviewPayload
}

function updatePendingCard(
  view: LinkPasteView,
  id: string,
  url: string,
  attributes: Record<string, unknown>,
) {
  if (view.isDestroyed) return
  const pending = findCard(view.state.doc, id)
  if (
    !pending ||
    pending.attributes.status !== 'loading' ||
    pending.attributes.url !== url
  ) {
    return
  }
  view.dispatch(
    view.state.tr.setNodeMarkup(pending.position, undefined, {
      ...pending.attributes,
      ...attributes,
      id,
      url,
    }),
  )
}

function findCard(
  document: LinkPasteView['state']['doc'],
  id: string,
): { position: number; attributes: Record<string, unknown> } | null {
  let result: { position: number; attributes: Record<string, unknown> } | null = null
  document.descendants((node, nodePosition) => {
    if (node.type.name === 'linkCard' && node.attrs.id === id) {
      result = { position: nodePosition, attributes: node.attrs }
      return false
    }
    return result === null
  })
  return result
}

export function handleLinkPaste(
  view: LinkPasteView,
  event: PasteLikeEvent,
  options: LinkPasteOptions,
) {
  if (!view.editable || !view.state.selection.empty) return false
  const url = singleHttpUrl(event.clipboardData?.getData('text/plain') ?? '')
  if (!url) return false

  const youtube = view.state.schema.nodes.youtube
  if (youtube && isValidYoutubeUrl(url)) {
    try {
      view.dispatch(view.state.tr.replaceSelectionWith(youtube.create({ src: url })).scrollIntoView())
      event.preventDefault()
      return true
    } catch {
      // The schema can reject a URL even after the platform matcher accepts it.
    }
  }

  const linkCard = view.state.schema.nodes.linkCard
  if (!linkCard) return false
  const id = options.createId()
  view.dispatch(
    view.state.tr
      .replaceSelectionWith(
        linkCard.create({
          id,
          url,
          title: null,
          description: null,
          image: null,
          siteName: null,
          status: 'loading',
        }),
      )
      .scrollIntoView(),
  )
  event.preventDefault()

  void options.fetchPreview(url).then(
    (preview) =>
      updatePendingCard(view, id, url, {
        title: sanitizePreviewText(preview.title, LINK_PREVIEW_LIMITS.title),
        description: sanitizePreviewText(
          preview.description,
          LINK_PREVIEW_LIMITS.description,
        ),
        image: sanitizePreviewUrl(preview.image),
        siteName: sanitizePreviewText(preview.siteName, LINK_PREVIEW_LIMITS.siteName),
        status: 'ready',
      }),
    () => updatePendingCard(view, id, url, { status: 'failed' }),
  )
  return true
}

export function handleDefaultLinkPaste(view: LinkPasteView, event: PasteLikeEvent) {
  return handleLinkPaste(view, event, {
    createId: () => crypto.randomUUID(),
    fetchPreview: requestLinkPreview,
  })
}

export const LinkCard = Node.create({
  name: 'linkCard',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-link-card-id'),
        renderHTML: ({ id }) => (id ? { 'data-link-card-id': id } : {}),
      },
      url: {
        default: null,
        parseHTML: (element) => sanitizePreviewUrl(element.getAttribute('href')),
        renderHTML: ({ url }) => {
          const safeUrl = sanitizePreviewUrl(url)
          return safeUrl ? { href: safeUrl } : {}
        },
      },
      title: {
        default: null,
        parseHTML: (element) =>
          sanitizePreviewText(
            element.getAttribute('data-title'),
            LINK_PREVIEW_LIMITS.title,
          ),
        renderHTML: ({ title }) => {
          const safeTitle = sanitizePreviewText(title, LINK_PREVIEW_LIMITS.title)
          return safeTitle ? { 'data-title': safeTitle } : {}
        },
      },
      description: {
        default: null,
        parseHTML: (element) =>
          sanitizePreviewText(
            element.getAttribute('data-description'),
            LINK_PREVIEW_LIMITS.description,
          ),
        renderHTML: ({ description }) => {
          const safeDescription = sanitizePreviewText(
            description,
            LINK_PREVIEW_LIMITS.description,
          )
          return safeDescription ? { 'data-description': safeDescription } : {}
        },
      },
      image: {
        default: null,
        parseHTML: (element) => sanitizePreviewUrl(element.getAttribute('data-image')),
        renderHTML: ({ image }) => {
          const safeImage = sanitizePreviewUrl(image)
          return safeImage ? { 'data-image': safeImage } : {}
        },
      },
      siteName: {
        default: null,
        parseHTML: (element) =>
          sanitizePreviewText(
            element.getAttribute('data-site-name'),
            LINK_PREVIEW_LIMITS.siteName,
          ),
        renderHTML: ({ siteName }) => {
          const safeSiteName = sanitizePreviewText(siteName, LINK_PREVIEW_LIMITS.siteName)
          return safeSiteName ? { 'data-site-name': safeSiteName } : {}
        },
      },
      status: {
        default: 'ready',
        parseHTML: (element) => element.getAttribute('data-status') ?? 'ready',
        renderHTML: ({ status }) => ({ 'data-status': status }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-link-card][href]',
        priority: 1000,
        getAttrs: (element) =>
          sanitizePreviewUrl(element.getAttribute('href')) ? null : false,
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const url = sanitizePreviewUrl(node.attrs.url)
    const label =
      sanitizePreviewText(node.attrs.title, LINK_PREVIEW_LIMITS.title) ??
      url ??
      '无效链接'
    if (!url) return ['span', { 'data-link-card-invalid': '' }, label]
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-link-card': '',
        href: url,
        rel: 'noopener noreferrer',
        target: '_blank',
      }),
      label,
    ]
  },
})
