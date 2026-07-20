import { expect, test } from '@playwright/test'

import { createRepositories } from '../../src/server/db/client'

let currentIssuePath: string

test.beforeAll(() => {
  const repositories = createRepositories()
  const current = repositories.issues.ensureCurrent(new Date())
  currentIssuePath = `/issue/${current.id}`
  repositories.db.close()
})

test('desktop presents the document between two visible sidebars', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(currentIssuePath)

  const directory = page.getByRole('navigation', { name: '周刊目录' })
  const document = page.getByRole('main')
  const information = page.getByRole('complementary', { name: '文档信息' })
  await expect(directory).toBeVisible()
  await expect(document).toBeVisible()
  await expect(information).toBeVisible()
  await expect(page.getByRole('button', { name: '打开文档信息' })).toBeHidden()

  const [directoryBox, documentBox, informationBox] = await Promise.all([
    directory.boundingBox(),
    document.boundingBox(),
    information.boundingBox(),
  ])
  expect(directoryBox?.x).toBeLessThan(documentBox?.x ?? 0)
  expect(informationBox?.x).toBeGreaterThan(documentBox?.x ?? Number.POSITIVE_INFINITY)
})

test('tablet keeps the directory pane and exposes document information as a drawer', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 })
  await page.goto(currentIssuePath)

  await expect(page.getByRole('navigation', { name: '周刊目录' })).toBeVisible()
  await expect(page.getByRole('button', { name: '打开周刊目录' })).toBeHidden()
  const informationTrigger = page.getByRole('button', { name: '打开文档信息' })
  await expect(informationTrigger).toBeVisible()
  await expect(page.getByRole('complementary', { name: '文档信息' })).toBeHidden()

  await informationTrigger.click()
  await expect(page.getByRole('complementary', { name: '文档信息' })).toBeVisible()
  await expect(page.getByRole('button', { name: '关闭文档信息' })).toBeFocused()
})

test('mobile collapses both sidebars and keeps editor controls reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(currentIssuePath)

  const directoryTrigger = page.getByRole('button', { name: '打开周刊目录' })
  const informationTrigger = page.getByRole('button', { name: '打开文档信息' })
  await expect(directoryTrigger).toBeVisible()
  await expect(informationTrigger).toBeVisible()
  await expect(page.getByRole('navigation', { name: '周刊目录' })).toBeHidden()
  await expect(page.getByRole('complementary', { name: '文档信息' })).toBeHidden()

  await directoryTrigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '关闭周刊目录' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(directoryTrigger).toBeFocused()

  const mediaToolbar = page.getByRole('toolbar', { name: '编辑工具栏' })
  await expect(mediaToolbar).toBeVisible()
  const moveUp = page.getByRole('button', { name: '上移当前区块' })
  const moveDown = page.getByRole('button', { name: '下移当前区块' })
  await expect(moveUp).toBeVisible()
  await expect(moveDown).toBeVisible()
  for (const control of [
    directoryTrigger,
    informationTrigger,
    moveUp,
    moveDown,
    mediaToolbar.locator('label').filter({ hasText: '添加图片' }),
    mediaToolbar.locator('label').filter({ hasText: '添加视频' }),
  ]) {
    const box = await control.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
