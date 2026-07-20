import { expect, test } from '@playwright/test'

import { openCurrentIssue } from './helpers/current-issue'

test('two anonymous visitors converge after one edits offline and reconnects', async ({
  browser,
}) => {
  const firstContext = await browser.newContext()
  const secondContext = await browser.newContext()
  const first = await firstContext.newPage()
  const second = await secondContext.newPage()
  const uniqueText = `共同编辑 ${Date.now()}`

  try {
    const issuePath = await openCurrentIssue(first)
    await second.goto(issuePath)

    const firstEditor = first.getByRole('textbox', { name: '周刊正文编辑区' })
    const secondEditor = second.getByRole('textbox', { name: '周刊正文编辑区' })
    await expect(first.getByRole('status')).toContainText('已保存')
    await expect(second.getByRole('status')).toContainText('已保存')

    await firstEditor.fill(uniqueText)
    await expect(secondEditor).toContainText(uniqueText)

    await firstContext.setOffline(true)
    await expect(first.getByRole('status')).toContainText('离线编辑')
    await firstEditor.press('End')
    await firstEditor.pressSequentially('，离线补充')
    await expect(firstEditor).toContainText(`${uniqueText}，离线补充`)

    await firstContext.setOffline(false)
    await expect(first.getByRole('status')).toContainText('已保存')
    await expect(secondEditor).toContainText(`${uniqueText}，离线补充`)
    await expect(firstEditor).toHaveText(await secondEditor.innerText())
  } finally {
    await Promise.all([firstContext.close(), secondContext.close()])
  }
})
