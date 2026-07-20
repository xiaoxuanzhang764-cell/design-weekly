import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

// The production entrypoint is plain ESM so it can run before tsx is started.
// @ts-expect-error The JavaScript entrypoint intentionally has no declaration file.
import { requireRailwayVolumeMountPath, startRailwayServices } from '../../server/railway-entrypoint.mjs'

describe('Railway runtime', () => {
  it.each([undefined, '', '/data2', '/tmp/data'])('fails fast unless Railway mounts exactly /data: %s', (value) => {
    expect(() => requireRailwayVolumeMountPath(value)).toThrow(
      'RAILWAY_VOLUME_MOUNT_PATH must be exactly /data',
    )
  })

  it('accepts the required Railway mount path', () => {
    expect(requireRailwayVolumeMountPath('/data')).toBe('/data')
  })

  it.each(['SIGINT', 'SIGTERM'] as const)('forwards %s to the detached child process group', (signal) => {
    const host = new EventEmitter() as EventEmitter & { exit: ReturnType<typeof vi.fn> }
    host.exit = vi.fn()
    const child = new EventEmitter() as EventEmitter & { pid: number }
    child.pid = 4312
    const spawnProcess = vi.fn(() => child)
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)

    startRailwayServices({ host, spawnProcess })
    host.emit(signal)

    expect(spawnProcess).toHaveBeenCalledWith('pnpm', ['start:railway'], {
      detached: true,
      stdio: 'inherit',
    })
    expect(kill).toHaveBeenCalledWith(-4312, signal)
    kill.mockRestore()
  })

  it.each([0, 7])('preserves child exit code %i', (code) => {
    const host = new EventEmitter() as EventEmitter & { exit: ReturnType<typeof vi.fn> }
    host.exit = vi.fn()
    const child = new EventEmitter() as EventEmitter & { pid: number }
    child.pid = 4312

    startRailwayServices({
      host,
      spawnProcess: vi.fn(() => child),
    })
    child.emit('exit', code, null)

    expect(host.exit).toHaveBeenCalledWith(code)
  })
})
