import type { Page } from '@playwright/test'

export async function openCurrentIssue(page: Page): Promise<string> {
  await page.goto('/')
  const href = await page.getByRole('link', { name: '进入当前期' }).getAttribute('href')
  if (!href) throw new Error('The homepage did not expose a current issue link')
  await page.goto(href)
  return href
}
