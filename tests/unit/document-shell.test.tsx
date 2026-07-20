import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const providerState = vi.hoisted(() => ({
  connection: 'connected' as 'connected' | 'connecting' | 'disconnected',
  sync: 'synced' as 'synced' | 'syncing',
  localClientId: 11,
  awareness: [
    { clientId: 11, user: { name: '访客 111', color: '#2447a8' } },
    { clientId: 22, user: { name: '访客 222', color: '#8f3228' } },
  ],
}))

vi.mock('@hocuspocus/provider-react', () => ({
  useHocuspocusConnectionStatus: () => providerState.connection,
  useHocuspocusSyncStatus: () => providerState.sync,
  useHocuspocusProvider: () => ({ document: { clientID: providerState.localClientId } }),
  useHocuspocusAwareness: () => providerState.awareness,
}))

vi.mock('@/components/editor/collaborative-editor', () => ({
  CollaborativeEditor: ({
    issueId,
    readOnly,
  }: {
    issueId: string
    readOnly: boolean
    onEditorReady?: (editor: null) => void
  }) => {
    return (
      <div
        data-testid="editor"
        data-issue-id={issueId}
        data-read-only={String(readOnly)}
      />
    )
  },
}))

vi.mock('@/components/document/version-history', () => ({
  VersionHistory: ({ issueId, readOnly }: { issueId: string; readOnly: boolean }) => (
    <div data-testid="version-history" data-issue-id={issueId} data-read-only={String(readOnly)} />
  ),
}))

import { DocumentOutline, type OutlineEditor } from '@/components/document/document-outline'
import { DocumentShell } from '@/components/document/document-shell'
import { PresenceList } from '@/components/document/presence-list'
import { SyncStatus } from '@/components/document/sync-status'
import type { IssueSummary } from '@/features/issues/types'

const currentIssue: IssueSummary = {
  id: 'issue-2026-07-13',
  title: '设计周刊（07.13）',
  startsAt: '2026-07-12T16:00:00.000Z',
  endsAt: '2026-07-19T16:00:00.000Z',
  status: 'current',
  coverUrl: null,
  itemCount: 12,
}

const archivedIssue: IssueSummary = {
  ...currentIssue,
  id: 'issue-2026-07-06',
  title: '设计周刊（07.06）',
  status: 'archived',
}

describe('DocumentShell', () => {
  it('labels navigation, document, and information regions', () => {
    render(<DocumentShell issue={currentIssue} issues={[currentIssue, archivedIssue]} />)

    expect(screen.getByRole('navigation', { name: '周刊目录' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '文档信息' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /设计周刊（07\.06）/ })).toHaveAttribute(
      'href',
      '/issue/issue-2026-07-06',
    )
    expect(screen.getByTestId('editor')).toHaveAttribute('data-read-only', 'false')
    expect(screen.getByTestId('editor')).toHaveAttribute('data-issue-id', currentIssue.id)
    expect(screen.getByTestId('version-history')).toHaveAttribute('data-read-only', 'false')
  })

  it('makes archived issues read-only and exposes keyboard-operable panel toggles', async () => {
    const user = userEvent.setup()
    render(<DocumentShell issue={archivedIssue} issues={[currentIssue, archivedIssue]} />)

    expect(screen.getByText('暂无可读内容')).toBeInTheDocument()
    expect(screen.getByTestId('version-history')).toHaveAttribute('data-read-only', 'true')
    const directoryButton = screen.getByRole('button', { name: '打开周刊目录' })
    const informationButton = screen.getByRole('button', { name: '打开文档信息' })
    expect(directoryButton).toHaveAttribute('aria-expanded', 'false')
    expect(informationButton).toHaveAttribute('aria-expanded', 'false')

    await user.click(directoryButton)
    expect(directoryButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('navigation', { name: '周刊目录' })).toHaveAttribute(
      'data-open',
      'true',
    )
  })

  it('moves focus into drawers, closes with Escape, and restores the trigger', async () => {
    const user = userEvent.setup()
    render(<DocumentShell issue={currentIssue} issues={[currentIssue, archivedIssue]} />)

    const trigger = screen.getByRole('button', { name: '打开文档信息' })
    const main = screen.getByRole('main')
    await user.click(trigger)
    expect(screen.getByRole('button', { name: '关闭文档信息' })).toHaveFocus()
    expect(main).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: '关闭侧栏' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(main).not.toHaveAttribute('aria-hidden')
  })

  it('makes every non-active workspace region inert while a drawer is open', async () => {
    const user = userEvent.setup()
    render(<DocumentShell issue={currentIssue} issues={[currentIssue, archivedIssue]} />)

    const trigger = screen.getByRole('button', { name: '打开文档信息' })
    const mobileBar = trigger.closest('header')
    const directory = screen.getByRole('navigation', { name: '周刊目录' })
    const main = screen.getByRole('main')
    const information = screen.getByRole('complementary', { name: '文档信息' })

    await user.click(trigger)

    for (const inactive of [mobileBar, directory, main]) {
      expect(inactive).toHaveAttribute('inert')
      expect(inactive).toHaveAttribute('aria-hidden', 'true')
    }
    expect(information).not.toHaveAttribute('inert')
    expect(information).not.toHaveAttribute('aria-hidden')

    await user.keyboard('{Escape}')
    for (const restored of [mobileBar, directory, main, information]) {
      expect(restored).not.toHaveAttribute('inert')
      expect(restored).not.toHaveAttribute('aria-hidden')
    }
    expect(trigger).toHaveFocus()
  })
})

describe('SyncStatus', () => {
  it.each([
    ['connected', 'synced', '已保存'],
    ['connected', 'syncing', '正在同步'],
    ['connecting', 'synced', '离线编辑'],
    ['disconnected', 'syncing', '离线编辑'],
  ] as const)('maps %s + %s to %s', (connection, sync, label) => {
    providerState.connection = connection
    providerState.sync = sync
    const view = render(<SyncStatus />)
    expect(screen.getByText(label)).toBeInTheDocument()
    view.unmount()
  })
})

describe('PresenceList', () => {
  it('removes the local client and keeps identity color decorative', () => {
    render(<PresenceList />)

    const list = screen.getByRole('list', { name: '在线协作者' })
    expect(within(list).queryByText('访客 111')).not.toBeInTheDocument()
    expect(within(list).getByText('访客 222')).not.toHaveStyle({ color: '#8f3228' })
    expect(within(list).getByTestId('presence-swatch-22')).toHaveStyle({
      backgroundColor: '#8f3228',
    })
  })
})

describe('DocumentOutline', () => {
  it('creates stable heading ids and scrolls without motion when requested', async () => {
    const user = userEvent.setup()
    const root = document.createElement('div')
    root.innerHTML = '<h2 id="heading-a">视觉设计分享</h2><h3 id="heading-b">动效参考</h3><h2 id="heading-c">视觉设计分享</h2>'
    const headings = Array.from(root.querySelectorAll('h2, h3'))
    const scrollIntoView = vi.fn()
    headings.forEach((heading) => {
      heading.scrollIntoView = scrollIntoView
    })
    const listeners = new Set<() => void>()
    const editor: OutlineEditor = {
      view: { dom: root },
      on: vi.fn((_event: 'update', listener: () => void) => listeners.add(listener)),
      off: vi.fn((_event: 'update', listener: () => void) => listeners.delete(listener)),
    }

    const view = render(<DocumentOutline editor={editor} reducedMotion />)
    const outline = screen.getByRole('navigation', { name: '本文目录' })
    expect(within(outline).getAllByRole('button')).toHaveLength(3)
    const firstIds = headings.map((heading) => heading.id)
    expect(new Set(firstIds).size).toBe(3)

    listeners.forEach((listener) => listener())
    view.rerender(<DocumentOutline editor={editor} reducedMotion />)
    expect(headings.map((heading) => heading.id)).toEqual(firstIds)

    await user.click(within(outline).getByRole('button', { name: '动效参考' }))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
  })
})
