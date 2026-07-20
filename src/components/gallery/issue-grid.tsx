'use client'

import { useMemo, useState } from 'react'

import type { IssueStatus, IssueSummary } from '@/features/issues/types'

import { IssueCard } from './issue-card'
import styles from './gallery.module.css'

type StatusFilter = 'all' | IssueStatus

const statusOptions: Array<{ value: StatusFilter; label: string; accessibleLabel: string }> = [
  { value: 'all', label: '全部', accessibleLabel: '查看全部' },
  { value: 'current', label: '当前期', accessibleLabel: '只看当前期' },
  { value: 'archived', label: '已归档', accessibleLabel: '只看归档' },
]

export function IssueGrid({ issues }: { issues: IssueSummary[] }) {
  const [year, setYear] = useState('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const years = useMemo(
    () => [...new Set(issues.map((issue) => issue.id.slice(6, 10)))].sort().reverse(),
    [issues],
  )
  const visibleIssues = issues.filter(
    (issue) =>
      (year === 'all' || issue.id.slice(6, 10) === year) &&
      (status === 'all' || issue.status === status),
  )

  return (
    <section className={styles.archive} id="archive" aria-labelledby="archive-title">
      <div className={styles.archiveHeading}>
        <div>
          <h2 id="archive-title">周刊档案</h2>
          <p>每一期都是一块正在发生的设计工作台。</p>
        </div>
        <p className={styles.issueCount} aria-live="polite">
          {visibleIssues.length} / {issues.length} 期
        </p>
      </div>

      <div className={styles.filters} aria-label="周刊筛选">
        <div className={styles.statusFilters} role="group" aria-label="按状态筛选">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-label={option.accessibleLabel}
              aria-pressed={status === option.value}
              onClick={() => setStatus(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className={styles.yearFilter}>
          <span>年份</span>
          <select
            aria-label="按年份筛选"
            value={year}
            onChange={(event) => setYear(event.target.value)}
          >
            <option value="all">全部年份</option>
            {years.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visibleIssues.length > 0 ? (
        <ul className={styles.issueGrid} aria-label="周刊期数">
          {visibleIssues.map((issue) => (
            <li key={issue.id}>
              <IssueCard issue={issue} />
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.emptyState} role="status">
          <p>没有符合条件的周刊。</p>
          <button
            type="button"
            onClick={() => {
              setYear('all')
              setStatus('all')
            }}
          >
            清除筛选
          </button>
        </div>
      )}
    </section>
  )
}
