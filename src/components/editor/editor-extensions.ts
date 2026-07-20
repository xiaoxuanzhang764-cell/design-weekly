import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Placeholder from '@tiptap/extension-placeholder'
import Youtube from '@tiptap/extension-youtube'
import StarterKit from '@tiptap/starter-kit'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type * as Y from 'yjs'

import type { AnonymousIdentity } from '@/features/collaboration/identity'

import { MediaImage } from './extensions/media-image'
import { LinkCard } from './extensions/link-card'
import { SafeLink } from './extensions/safe-link'
import { Video } from './extensions/video'
import { HeadingIdentity } from './heading-identity'

export const EDITOR_PLACEHOLDER = '输入 “/” 插入内容，或直接粘贴图片、视频和链接…'

export function createEditorExtensions(
  provider: HocuspocusProvider,
  identity: AnonymousIdentity,
) {
  return [
    StarterKit.configure({ undoRedo: false, link: false }),
    MediaImage,
    Video,
    Youtube.configure({ addPasteHandler: false, nocookie: true }),
    SafeLink.configure({
      autolink: true,
      openOnClick: false,
    }),
    LinkCard,
    HeadingIdentity,
    Collaboration.configure({ document: provider.document }),
    CollaborationCaret.configure({ provider, user: identity }),
    Placeholder.configure({ placeholder: EDITOR_PLACEHOLDER }),
  ]
}

export function createReadOnlyEditorExtensions(document: Y.Doc) {
  return [
    StarterKit.configure({ undoRedo: false, link: false }),
    MediaImage,
    Video,
    Youtube.configure({ addPasteHandler: false, nocookie: true }),
    SafeLink.configure({
      autolink: true,
      openOnClick: false,
    }),
    LinkCard,
    HeadingIdentity,
    Collaboration.configure({ document }),
  ]
}
