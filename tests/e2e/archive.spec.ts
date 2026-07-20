import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as Y from 'yjs'

import { createRepositories } from '../../src/server/db/client'
import { openCurrentIssue } from './helpers/current-issue'

const execFileAsync = promisify(execFile)

test('Monday rollover freezes the old issue and seeds the new weekly template', async ({ page }) => {
  const oldIssuePath = await openCurrentIssue(page)
  const editor = page.getByRole('textbox', { name: '周刊正文编辑区' })
  const marker = `归档前内容 ${Date.now()}`
  await expect(page.getByRole('status')).toContainText('已保存')
  await editor.fill(marker)
  await expect(page.getByRole('status')).toContainText('已保存')

  const oldIssueId = oldIssuePath.split('/').at(-1)
  if (!oldIssueId) throw new Error(`Invalid issue path: ${oldIssuePath}`)
  await expect.poll(() => {
    const repositories = createRepositories()
    const persisted = repositories.documents.load(oldIssueId)
    const issue = repositories.issues.find(oldIssueId)
    repositories.db.close()
    if (!persisted || !issue) return null
    const document = new Y.Doc()
    Y.applyUpdate(document, persisted)
    return document.getXmlFragment('default').toString().includes(marker)
      ? issue.endsAt
      : null
  }).not.toBeNull()
  const repositories = createRepositories()
  const rolloverAt = repositories.issues.find(oldIssueId)?.endsAt
  repositories.db.close()
  if (!rolloverAt) throw new Error('The edited issue did not persist before rollover')

  const internalToken = process.env.COLLAB_INTERNAL_TOKEN
  if (!internalToken) throw new Error('COLLAB_INTERNAL_TOKEN is required for archive E2E')
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      '--import',
      'tsx',
      'tests/e2e/helpers/archive-current.ts',
      '--now',
      rolloverAt,
      '--token',
      internalToken,
      '--port',
      process.env.COLLABORATION_PORT ?? '1234',
    ],
    {
      cwd: process.cwd(),
      env: process.env,
    },
  )
  const result = JSON.parse(stdout) as { nextIssueId: string }

  await expect(page.getByRole('status')).toContainText('离线编辑')
  const rejectedMarker = `归档后拒绝写入 ${Date.now()}`
  await editor.fill(rejectedMarker)
  await expect(page.getByRole('status')).toContainText('离线编辑')
  await page.waitForTimeout(500)
  const archivedRepositories = createRepositories()
  const archivedState = archivedRepositories.documents.load(oldIssueId)
  archivedRepositories.db.close()
  if (!archivedState) throw new Error('Archived issue state is missing')
  const archivedYDoc = new Y.Doc()
  Y.applyUpdate(archivedYDoc, archivedState)
  expect(archivedYDoc.getXmlFragment('default').toString()).not.toContain(rejectedMarker)

  await page.reload()
  await expect(page.getByText('本期已归档，仅供阅读。')).toBeVisible()
  const archivedDocument = page.locator('[aria-label="周刊正文"]')
  await expect(archivedDocument).toHaveAttribute(
    'aria-readonly',
    'true',
  )
  await expect(archivedDocument).toContainText(marker)

  await openCurrentIssue(page)
  await expect(page).toHaveURL(new RegExp(`/issue/${result.nextIssueId}$`))
  for (const heading of ['视觉设计分享', '文章知识类', '资源资讯类']) {
    await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible()
  }
})
