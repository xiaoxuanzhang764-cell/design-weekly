import { readFileSync } from 'node:fs'

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { GalleryHero } from '@/components/gallery/gallery-hero'
import { IssueGrid } from '@/components/gallery/issue-grid'
import type { IssueSummary } from '@/features/issues/types'

const issues: IssueSummary[] = [
  {
    id: 'issue-2026-07-13',
    title: '设计周刊（07.13）',
    startsAt: '2026-07-12T16:00:00.000Z',
    endsAt: '2026-07-19T16:00:00.000Z',
    status: 'current',
    coverUrl: null,
    itemCount: 12,
  },
  {
    id: 'issue-2026-01-05',
    title: '设计周刊（01.05）',
    startsAt: '2026-01-04T16:00:00.000Z',
    endsAt: '2026-01-11T16:00:00.000Z',
    status: 'archived',
    coverUrl: null,
    itemCount: 24,
  },
  {
    id: 'issue-2025-12-29',
    title: '设计周刊（12.29）',
    startsAt: '2025-12-28T16:00:00.000Z',
    endsAt: '2026-01-04T16:00:00.000Z',
    status: 'archived',
    coverUrl: null,
    itemCount: 18,
  },
]

describe('IssueGrid', () => {
  it('marks the current issue and links every visible card', () => {
    render(<IssueGrid issues={issues.slice(0, 1)} />)

    expect(screen.getByText('更新中')).toBeInTheDocument()
    expect(screen.getByText('07/13 — 07/19')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /设计周刊（07\.13），更新中/ })).toHaveAttribute(
      'href',
      '/issue/issue-2026-07-13',
    )
  })

  it('filters by year and status without hiding the server-rendered filter controls', async () => {
    const user = userEvent.setup()
    render(<IssueGrid issues={issues} />)

    expect(screen.getByRole('group', { name: '按状态筛选' })).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: '按年份筛选' }), '2025')
    expect(screen.getByRole('heading', { name: '设计周刊（12.29）' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '设计周刊（07.13）' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: '按年份筛选' }), 'all')
    await user.click(screen.getByRole('button', { name: '只看归档' }))
    const list = screen.getByRole('list', { name: '周刊期数' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByText('更新中')).not.toBeInTheDocument()
  })
})

it('keeps shared application tokens and dedicated high-contrast CTA colors', () => {
  const projectRoot = `${process.cwd()}/`
  const globals = readFileSync(`${projectRoot}src/app/globals.css`, 'utf8')
  const gallery = readFileSync(
    `${projectRoot}src/components/gallery/gallery.module.css`,
    'utf8',
  )

  for (const token of [
    '--surface-dark',
    '--surface-dark-raised',
    '--surface-app',
    '--surface-document',
    '--ink',
    '--ink-on-dark',
    '--muted',
    '--accent',
    '--border',
    '--radius-card',
  ]) {
    expect(globals).toContain(`${token}:`)
  }

  expect(globals).toContain('--color-cta: oklch(0.43 0.16 264)')
  expect(globals).toContain('--color-cta-hover: oklch(0.38 0.14 264)')
  expect(gallery).toMatch(/\.primaryAction\s*{[^}]*background:\s*var\(--color-cta\)/s)
  expect(gallery).toMatch(/\.primaryAction:hover\s*{[^}]*background:\s*var\(--color-cta-hover\)/s)
})

it('gives the current repository issue a clear primary action', () => {
  render(<GalleryHero current={issues[0]} />)

  expect(screen.getByRole('heading', { level: 1, name: '设计周刊' })).toBeInTheDocument()
  expect(screen.getByText('7月13日 — 7月19日')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '进入当前期' })).toHaveAttribute(
    'href',
    '/issue/issue-2026-07-13',
  )
})
