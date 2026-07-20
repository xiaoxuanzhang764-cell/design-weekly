import { randomUUID } from 'node:crypto'
import {
  access,
  mkdir,
  open,
  rename,
  rm,
} from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { MediaStorage, StoredMedia } from './storage'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EXTENSIONS = new Set(['jpg', 'png', 'webp', 'gif', 'mp4', 'webm'])

export interface LocalMediaStorageOptions {
  now?: () => Date
  operations?: Partial<LocalFileOperations>
  root?: string
}

interface AtomicFileHandle {
  close(): Promise<void>
  sync(): Promise<void>
  writeFile(bytes: Uint8Array): Promise<void>
}

interface LocalFileOperations {
  access(path: string): Promise<void>
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
  open(path: string, flags: 'wx'): Promise<AtomicFileHandle>
  rename(from: string, to: string): Promise<void>
  rm(path: string, options: { force: true }): Promise<void>
}

const defaultOperations: LocalFileOperations = { access, mkdir, open, rename, rm }

export class LocalMediaStorage implements MediaStorage {
  readonly root: string
  private readonly now: () => Date
  private readonly operations: LocalFileOperations

  constructor(options: LocalMediaStorageOptions = {}) {
    const configuredRoot = options.root ?? process.env.MEDIA_ROOT
    this.root = configuredRoot
      ? resolve(/* turbopackIgnore: true */ configuredRoot)
      : join(process.cwd(), 'storage', 'uploads')
    this.now = options.now ?? (() => new Date())
    this.operations = { ...defaultOperations, ...options.operations }
  }

  async put(input: {
    id: string
    bytes: Uint8Array
    extension: string
  }): Promise<StoredMedia> {
    if (!UUID.test(input.id) || !EXTENSIONS.has(input.extension)) {
      throw new Error('Invalid media storage key')
    }

    const now = this.now()
    const year = String(now.getUTCFullYear()).padStart(4, '0')
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const directory = join(this.root, year, month)
    const filename = `${input.id}.${input.extension}`
    const path = join(directory, filename)

    await this.operations.mkdir(directory, { recursive: true })
    const temporaryPath = join(directory, `.${input.id}.${randomUUID()}.tmp`)
    const lockPath = join(directory, `.${input.id}.lock`)
    let temporaryHandle: AtomicFileHandle | undefined
    let lockHandle: AtomicFileHandle | undefined
    let finalWasAbsent = false

    try {
      lockHandle = await this.operations.open(lockPath, 'wx')
      await lockHandle.close()
      lockHandle = undefined

      try {
        await this.operations.access(path)
        throw Object.assign(new Error('Media already exists'), { code: 'EEXIST' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        finalWasAbsent = true
      }

      temporaryHandle = await this.operations.open(temporaryPath, 'wx')
      await temporaryHandle.writeFile(input.bytes)
      await temporaryHandle.sync()
      await temporaryHandle.close()
      temporaryHandle = undefined
      await this.operations.rename(temporaryPath, path)

      return { path, url: `/uploads/${year}/${month}/${filename}` }
    } catch (error) {
      if (temporaryHandle) await Promise.allSettled([temporaryHandle.close()])
      await Promise.allSettled([
        this.operations.rm(temporaryPath, { force: true }),
        this.operations.rm(lockPath, { force: true }),
        ...(finalWasAbsent ? [this.operations.rm(path, { force: true })] : []),
      ])
      throw error
    } finally {
      await Promise.allSettled([
        this.operations.rm(temporaryPath, { force: true }),
        this.operations.rm(lockPath, { force: true }),
      ])
    }
  }

  async delete(path: string): Promise<void> {
    const resolved = resolve(path)
    const pathFromRoot = relative(this.root, resolved)
    if (
      pathFromRoot === '' ||
      pathFromRoot === '..' ||
      pathFromRoot.startsWith(`..${sep}`) ||
      isAbsolute(pathFromRoot)
    ) {
      throw new Error('Invalid media storage path')
    }
    await this.operations.rm(resolved, { force: true })
  }
}
