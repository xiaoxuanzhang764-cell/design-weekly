import { expect, test } from '@playwright/test'

import { createRepositories } from '../../src/server/db/client'

let currentIssuePath: string

test.beforeAll(() => {
  const repositories = createRepositories()
  const current = repositories.issues.ensureCurrent(new Date())
  currentIssuePath = `/issue/${current.id}`
  repositories.db.close()
})

test('keyboard focus is visible and mobile drawers restore focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(currentIssuePath)

  const directoryTrigger = page.getByRole('button', { name: '打开周刊目录' })
  await directoryTrigger.focus()
  await expect(directoryTrigger).toBeFocused()
  await expect(directoryTrigger).toHaveCSS('outline-style', 'solid')
  await expect(directoryTrigger).toHaveCSS('outline-width', '2px')
  await expect(directoryTrigger).toHaveCSS('outline-offset', '2px')

  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '关闭周刊目录' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(directoryTrigger).toBeFocused()
})

test('reduced motion removes interface transitions and smooth scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(currentIssuePath)

  const information = page.getByRole('complementary', { name: '文档信息' })
  await expect(information).toHaveCSS('transition-duration', '0s')
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
  ).toBe('auto')
})

test('primary pages load without console errors or uncaught page errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: '设计周刊', level: 1 })).toBeVisible()
  await page.goto(currentIssuePath)
  await expect(page.getByRole('main')).toBeVisible()

  expect(errors).toEqual([])
})
