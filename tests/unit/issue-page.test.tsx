import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { IssueSummary } from '@/features/issues/types'

const state = vi.hoisted(() => ({
  document: new Uint8Array([1, 2]),
  issue: undefined as IssueSummary | undefined,
  notFound: vi.fn(() => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404')
  }),
}))

vi.mock('next/navigation', () => ({ notFound: state.notFound }))
vi.mock('@/server/db/client', () => ({
  getRepositories: () => ({
    documents: { load: () => state.document },
    issues: {
      find: () => state.issue,
      list: () => (state.issue ? [state.issue] : []),
    },
  }),
}))
vi.mock('@/features/collaboration/collaboration-room', () => ({
  CollaborationSocketProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="socket">{children}</div>
  ),
  CollaborationRoom: ({
    children,
    initialState,
    issueId,
  }: {
    children: ReactNode
    initialState?: string
    issueId: string
  }) => (
    <section data-testid="room" data-initial-state={initialState} data-issue-id={issueId}>
      {children}
    </section>
  ),
}))
vi.mock('@/components/document/document-shell', () => ({
  DocumentShell: ({ archivedState, issue }: { archivedState?: string; issue: IssueSummary }) => (
    <div data-testid="shell" data-archived-state={archivedState} data-status={issue.status}>
      {issue.title}
    </div>
  ),
}))

import IssuePage from '@/app/issue/[issueId]/page'

const issue: IssueSummary = {
  id: 'issue-2026-07-13',
  title: '设计周刊（07.13）',
  startsAt: '2026-07-12T16:00:00.000Z',
  endsAt: '2026-07-19T16:00:00.000Z',
  status: 'current',
  coverUrl: null,
  itemCount: 12,
}

describe('IssuePage', () => {
  beforeEach(() => {
    state.notFound.mockClear()
    state.issue = issue
  })

  it.each(['current', 'archived'] as const)(
    'places a %s issue shell inside its collaboration room',
    async (status) => {
      state.issue = { ...issue, status }
      render(await IssuePage({ params: Promise.resolve({ issueId: issue.id }) }))

      expect(screen.getByTestId('shell')).toHaveAttribute('data-status', status)
      if (status === 'archived') {
        expect(screen.queryByTestId('socket')).not.toBeInTheDocument()
        expect(screen.queryByTestId('room')).not.toBeInTheDocument()
        expect(screen.getByTestId('shell')).toHaveAttribute('data-archived-state', 'AQI=')
      } else {
        expect(screen.getByTestId('socket')).toBeInTheDocument()
        expect(screen.getByTestId('room')).toHaveAttribute('data-issue-id', issue.id)
      }
    },
  )

  it('terminates missing issue routes with notFound', async () => {
    state.issue = undefined

    await expect(
      IssuePage({ params: Promise.resolve({ issueId: 'missing' }) }),
    ).rejects.toThrow('404')
    expect(state.notFound).toHaveBeenCalledOnce()
  })
})
