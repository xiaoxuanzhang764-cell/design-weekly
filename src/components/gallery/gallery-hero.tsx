import Link from 'next/link'

import type { IssueSummary } from '@/features/issues/types'

import styles from './gallery.module.css'

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Shanghai',
})

export function GalleryHero({ current }: { current: IssueSummary }) {
  const inclusiveEnd = new Date(new Date(current.endsAt).getTime() - 1)
  const range = `${dateFormatter.format(new Date(current.startsAt))} — ${dateFormatter.format(inclusiveEnd)}`

  return (
    <>
      <header className={styles.siteHeader}>
        <Link className={styles.brand} href="/" aria-label="设计周刊首页">
          <span className={styles.brandMark} aria-hidden="true">
            DW
          </span>
          <span>设计周刊</span>
        </Link>
        <nav className={styles.nav} aria-label="主要导航">
          <a href="#archive">周刊归档</a>
          <a href="#about">关于团队</a>
          <Link className={styles.headerAction} href={`/issue/${current.id}`}>
            打开当前期
          </Link>
        </nav>
      </header>

      <section className={styles.hero} aria-labelledby="gallery-title">
        <div className={styles.liveLine}>
          <span className={styles.liveDot} aria-hidden="true" />
          第 {current.id.slice(-5).replace('-', '.')} 期正在共同编辑
        </div>
        <h1 id="gallery-title">设计周刊</h1>
        <p className={styles.heroLead}>
          一份由每个人实时共建的设计档案。把这周遇到的好视觉、好文章和好工具，留在同一个地方。
        </p>
        <div className={styles.heroActions}>
          <Link className={styles.primaryAction} href={`/issue/${current.id}`}>
            进入当前期
            <span aria-hidden="true">↗</span>
          </Link>
          <a className={styles.textAction} href="#archive">
            浏览历史周刊
          </a>
        </div>
        <p className={styles.currentMeta}>
          <span>{range}</span>
          <span>{current.itemCount} 条内容</span>
          <span>无需登录，即刻共创</span>
        </p>
      </section>
    </>
  )
}
