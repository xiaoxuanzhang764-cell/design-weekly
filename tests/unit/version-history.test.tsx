import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/editor/archived-editor', () => ({
  ArchivedEditor: ({ initialState }: { initialState: string }) => (
    <div data-testid="archived-preview" data-state={initialState}>
      真实只读文档
      <iframe title="嵌入预览" />
      <video aria-label="视频预览" controls tabIndex={0} />
    </div>
  ),
}))

import { VersionHistory } from '@/components/document/version-history'

const snapshots = [
  {
    id: 12,
    reason: 'volume',
    updateCount: 200,
    createdAt: '2026-07-16T11:00:00.000Z',
  },
  {
    id: 8,
    reason: 'interval',
    updateCount: 37,
    createdAt: '2026-07-16T10:00:00.000Z',
  },
]

afterEach(() => vi.unstubAllGlobals())

describe('VersionHistory', () => {
  it('lists timestamp, reason and update count and opens a read-only preview dialog', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ snapshots }))
      .mockResolvedValueOnce(Response.json({
        snapshot: { ...snapshots[0], stateBase64: 'dGVzdA==' },
      }))
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<VersionHistory issueId="issue-2026-07-13" readOnly={false} />)

    expect(await screen.findByText('累计 200 次更新')).toBeInTheDocument()
    expect(screen.getByText('自动保存（更新量）')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: '预览' })[0])

    const preview = screen.getByRole('dialog', { name: '版本预览' })
    expect(preview.parentElement).toBe(document.body)
    expect(preview).toHaveTextContent('只读预览')
    expect(preview).toHaveTextContent('累计 200 次更新')
    expect(screen.getByTestId('archived-preview')).toHaveAttribute('data-state', 'dGVzdA==')
    expect(screen.getByRole('button', { name: '关闭预览' })).toHaveFocus()
    expect(screen.getByTestId('version-background')).toHaveAttribute('inert')
    const applicationRoot = screen.getByTestId('version-background').closest('body > div')
    expect(applicationRoot).toHaveAttribute('inert')
    expect(applicationRoot).toHaveAttribute('aria-hidden', 'true')
    await user.keyboard('{Tab}')
    expect(screen.getByTitle('嵌入预览')).toHaveFocus()
    await user.keyboard('{Tab}')
    expect(screen.getByLabelText('视频预览')).toHaveFocus()
  })

  it('requires a second confirmation with the snapshot time and reports successful restore', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ snapshots }))
      .mockResolvedValueOnce(
        Response.json(
          { snapshot: { ...snapshots[0], id: 13, reason: 'manual' } },
          { status: 201 },
        ),
      )
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<VersionHistory issueId="issue-2026-07-13" readOnly={false} />)

    await user.click((await screen.findAllByRole('button', { name: '恢复此版本' }))[0])
    const confirmation = screen.getByRole('dialog', { name: '确认恢复版本' })
    expect(confirmation).toHaveTextContent('2026')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '确认恢复版本' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '恢复此版本' })[0]).toHaveFocus()
    await user.click(screen.getAllByRole('button', { name: '恢复此版本' })[0])

    await user.click(screen.getByRole('button', { name: '确认恢复' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ snapshotId: 12, confirm: true })
    expect(await screen.findByText('已恢复为新的当前版本')).toBeInTheDocument()
  })

  it('never offers restore controls for an archived issue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ snapshots })))
    render(<VersionHistory issueId="issue-2026-07-06" readOnly />)

    expect(await screen.findByText('累计 200 次更新')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '恢复此版本' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '预览' })).toHaveLength(2)
  })
})
