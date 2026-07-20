import { describe, expect, it } from 'vitest'

import * as Y from 'yjs'

import { createIssueTemplate, createIssueTemplateState } from '@/features/issues/template'
import { getIssueId, getIssueWindow } from '@/features/issues/week'

describe('getIssueWindow', () => {
  it('starts Monday at midnight in Asia/Shanghai', () => {
    const window = getIssueWindow(new Date('2026-07-16T04:00:00.000Z'))

    expect(window.start.toISOString()).toBe('2026-07-12T16:00:00.000Z')
    expect(window.end.toISOString()).toBe('2026-07-19T16:00:00.000Z')
    expect(getIssueId(window)).toBe('issue-2026-07-13')
  })

  it('rolls over exactly at Monday 00:00 Shanghai time', () => {
    expect(getIssueId(getIssueWindow(new Date('2026-07-19T15:59:59.999Z')))).toBe(
      'issue-2026-07-13',
    )
    expect(getIssueId(getIssueWindow(new Date('2026-07-19T16:00:00.000Z')))).toBe(
      'issue-2026-07-20',
    )
  })
})

describe('createIssueTemplate', () => {
  it('creates the three required level-two sections with empty paragraphs', () => {
    expect(createIssueTemplate()).toEqual({
      type: 'doc',
      content: ['视觉设计分享', '文章知识类', '资源资讯类'].flatMap((text) => [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text }],
        },
        { type: 'paragraph' },
      ]),
    })
  })

  it('creates the same three-section template as a persisted Yjs document', () => {
    const document = new Y.Doc()
    Y.applyUpdate(document, createIssueTemplateState())
    const content = document.getXmlFragment('default').toString()

    expect(content).toContain('视觉设计分享')
    expect(content).toContain('文章知识类')
    expect(content).toContain('资源资讯类')
  })
})
