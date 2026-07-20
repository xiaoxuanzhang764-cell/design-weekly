import { defineConfig, devices } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const e2eRoot = mkdtempSync(join(tmpdir(), 'design-weekly-e2e-'))
const collaborationPort = 20_000 + (process.pid % 20_000)
const internalToken = randomBytes(32).toString('hex')
const environment = {
  COLLAB_TEST_ROLLOVER: '1',
  COLLABORATION_PORT: String(collaborationPort),
  COLLAB_INTERNAL_TOKEN: internalToken,
  DATABASE_PATH: join(e2eRoot, 'data', 'design-weekly.sqlite'),
  MEDIA_ROOT: join(e2eRoot, 'storage', 'uploads'),
  NEXT_PUBLIC_COLLAB_URL: `ws://127.0.0.1:${collaborationPort}`,
}

Object.assign(process.env, environment)

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  use: { baseURL: 'http://127.0.0.1:3000' },
  webServer: {
    command: 'pnpm dev',
    env: environment,
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
  },
})
