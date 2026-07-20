import { GalleryHero } from '@/components/gallery/gallery-hero'
import { IssueGrid } from '@/components/gallery/issue-grid'
import { ensureCurrentIssue } from '@/features/issues/server-lifecycle'
import { getRepositories } from '@/server/db/client'
import { notFound } from 'next/navigation'

import styles from '@/components/gallery/gallery.module.css'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  await ensureCurrentIssue()
  const { issues } = getRepositories()
  const current = issues.list().find(({ status }) => status === 'current')
  if (!current) notFound()
  const allIssues = issues.list()

  return (
    <div className={styles.galleryPage}>
      <main>
        <GalleryHero current={current} />
        <IssueGrid issues={allIssues} />
      </main>
      <footer className={styles.footer} id="about">
        <div>
          <span className={styles.footerMark} aria-hidden="true">DW</span>
          <p>由好奇、乐于分享的设计师们共同维护。</p>
        </div>
        <a href="#archive">回到周刊档案 ↑</a>
      </footer>
    </div>
  )
}
