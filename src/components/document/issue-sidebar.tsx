import Link from 'next/link'

import type { IssueSummary } from '@/features/issues/types'

import styles from './document.module.css'

export interface IssueSidebarProps {
  activeIssueId: string
  issues: IssueSummary[]
}

export function IssueSidebar({ activeIssueId, issues }: IssueSidebarProps) {
  return (
    <>
      <Link className={styles.homeLink} href="/" aria-label="返回设计周刊首页">
        <span aria-hidden="true">DW</span>
        <span>设计周刊</span>
      </Link>
      <h2 className={styles.sidebarHeading}>周刊目录</h2>
      <ul className={styles.issueList}>
        {issues.map((issue) => {
          const active = issue.id === activeIssueId
          return (
            <li key={issue.id}>
              <Link href={`/issue/${issue.id}`} aria-current={active ? 'page' : undefined}>
                <span>{issue.title}</span>
                <small>{issue.status === 'current' ? '更新中' : '已归档'}</small>
              </Link>
            </li>
          )
        })}
      </ul>
    </>
  )
}
