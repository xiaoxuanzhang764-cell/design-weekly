import type { JSONContent } from '@tiptap/core'
import * as Y from 'yjs'

const ISSUE_HEADINGS = ['视觉设计分享', '文章知识类', '资源资讯类']

export function createIssueTemplate(): JSONContent {
  return {
    type: 'doc',
    content: ISSUE_HEADINGS.flatMap((text) => [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text }],
      },
      { type: 'paragraph' },
    ]),
  }
}

export function createIssueTemplateState(): Uint8Array {
  const document = new Y.Doc()
  const fragment = document.getXmlFragment('default')
  const blocks = ISSUE_HEADINGS.flatMap((headingText) => {
    const heading = new Y.XmlElement('heading')
    heading.setAttribute('level', 2 as unknown as string)
    const text = new Y.XmlText()
    text.insert(0, headingText)
    heading.insert(0, [text])
    return [heading, new Y.XmlElement('paragraph')]
  })
  fragment.insert(0, blocks)
  return Y.encodeStateAsUpdate(document)
}
