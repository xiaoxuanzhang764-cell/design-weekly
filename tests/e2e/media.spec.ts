import { expect, test } from '@playwright/test'
import { join } from 'node:path'

import { openCurrentIssue } from './helpers/current-issue'

const PNG_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'one-kilobyte.png')

test('an uploaded PNG renders in a second browser context', async ({ browser }) => {
  const uploaderContext = await browser.newContext()
  const observerContext = await browser.newContext()
  const uploader = await uploaderContext.newPage()
  const observer = await observerContext.newPage()

  try {
    const issuePath = await openCurrentIssue(uploader)
    await observer.goto(issuePath)
    await expect(uploader.getByRole('status')).toContainText('已保存')
    await expect(observer.getByRole('status')).toContainText('已保存')

    let releaseUpload: (() => void) | undefined
    const uploadMayContinue = new Promise<void>((resolve) => {
      releaseUpload = resolve
    })
    await uploader.route('**/api/media', async (route) => {
      await uploadMayContinue
      await route.continue()
    })

    await uploader.getByLabel('选择图片文件').setInputFiles(PNG_FIXTURE)
    const uploadingImage = uploader.locator('img[data-status="uploading"]')
    await expect(uploadingImage).toBeVisible()
    releaseUpload?.()

    const uploadedImage = uploader.locator('img[data-status="ready"]').last()
    await expect(uploadedImage).toBeVisible()
    await expect(uploadedImage).toHaveAttribute('src', /\/uploads\//)

    const remoteImage = observer.locator('img[data-status="ready"]').last()
    await expect(remoteImage).toBeVisible()
    await expect(remoteImage).toHaveAttribute('src', /\/uploads\//)
    await expect(remoteImage).toHaveJSProperty('complete', true)
    await expect.poll(() => remoteImage.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0)
    const source = await remoteImage.getAttribute('src')
    if (!source) throw new Error('Uploaded image is missing its source URL')
    const response = await observer.request.get(source)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('image/png')
  } finally {
    await Promise.all([uploaderContext.close(), observerContext.close()])
  }
})
