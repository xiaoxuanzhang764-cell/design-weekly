import Link from 'next/link'

import type { IssueSummary } from '@/features/issues/types'

import styles from './gallery.module.css'

const rangeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Shanghai',
})

function coverVariant(id: string) {
  return String(
    [...id].reduce((value, character) => value + character.charCodeAt(0), 0) % 6,
  )
}

export function IssueCard({ issue }: { issue: IssueSummary }) {
  const isCurrent = issue.status === 'current'
  const inclusiveEnd = new Date(new Date(issue.endsAt).getTime() - 1)
  const range = `${rangeFormatter.format(new Date(issue.startsAt))} — ${rangeFormatter.format(inclusiveEnd)}`
  const issueNumber = issue.id.slice(-5).replace('-', '.')

  return (
    <Link
      className={styles.cardLink}
      href={`/issue/${issue.id}`}
      aria-label={`${issue.title}${isCurrent ? '，更新中' : '，已归档'}`}
    >
      <article className={styles.issueCard}>
        <div
          className={styles.cover}
          data-variant={coverVariant(issue.id)}
          style={issue.coverUrl ? { backgroundImage: `url("${issue.coverUrl}")` } : undefined}
          aria-hidden="true"
        >
          <span className={styles.coverWord}>DESIGN</span>
          <span className={styles.coverNumber}>{issueNumber}</span>
          <span className={styles.coverWeek}>WEEKLY / 设计共享</span>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.cardTopline}>
            <span>{range}</span>
            {isCurrent ? (
              <span className={styles.currentBadge}>
                <span aria-hidden="true" />更新中
              </span>
            ) : (
              <span className={styles.archiveBadge}>已归档</span>
            )}
          </div>
          <h2>{issue.title}</h2>
          <div className={styles.cardFooter}>
            <span>{issue.itemCount} 条内容</span>
            <span className={styles.openLabel} aria-hidden="true">
              打开 <span>↗</span>
            </span>
          </div>
        </div>
      </article>
    </Link>
  )
}
