import { spawn } from 'node:child_process'
import { chownSync, lchownSync, lstatSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const NODE_UID = 1000
const NODE_GID = 1000
function chownTree(path) {
  const metadata = lstatSync(path)
  lchownSync(path, NODE_UID, NODE_GID)
  if (!metadata.isDirectory()) return
  for (const entry of readdirSync(path)) chownTree(join(path, entry))
}

export function requireRailwayVolumeMountPath(value) {
  if (value !== '/data') {
    throw new Error('RAILWAY_VOLUME_MOUNT_PATH must be exactly /data')
  }
  return value
}

export function startRailwayServices({ host = process, spawnProcess = spawn } = {}) {
  const child = spawnProcess('pnpm', ['start:railway'], {
    detached: true,
    stdio: 'inherit',
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    host.on(signal, () => process.kill(-child.pid, signal))
  }
  child.once('error', (error) => {
    console.error('Failed to start Railway services.', error)
    host.exit(1)
  })
  child.once('exit', (code, signal) => {
    if (signal) {
      console.error(`Railway services stopped by ${signal}.`)
      host.exit(1)
      return
    }
    host.exit(code ?? 1)
  })
  return child
}

function main() {
  const volumeRoot = requireRailwayVolumeMountPath(
    process.env.RAILWAY_VOLUME_MOUNT_PATH,
  )
  const mediaRoot = process.env.MEDIA_ROOT ?? join(volumeRoot, 'uploads')

  mkdirSync(mediaRoot, { recursive: true })
  chownSync(volumeRoot, NODE_UID, NODE_GID)
  for (const entry of readdirSync(volumeRoot)) chownTree(join(volumeRoot, entry))

  process.setgid(NODE_GID)
  process.setuid(NODE_UID)
  startRailwayServices()
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
