import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'

/**
 * Where media files live. The database stores keys like `projects/<id>/source.mp4`, never paths,
 * so a server deployment can swap in an S3 driver without touching any rows.
 */
export interface Storage {
  put(key: string, data: Buffer | Uint8Array | string | Readable): Promise<void>
  get(key: string): Promise<Buffer>
  createReadStream(key: string, range?: { start: number; end: number }): Readable
  stat(key: string): Promise<{ size: number; modifiedAt: Date } | null>
  delete(key: string): Promise<void>
  /** Keys under a prefix (recursive). */
  list(prefix: string): Promise<string[]>
  /** A local file path for tools like ffmpeg. A remote driver would download to a temp file. */
  localPath(key: string): Promise<string>
  /**
   * A local path a tool can write `key` to, with its folder created.
   * A remote driver would hand out a temp path and upload it in `commitLocalWrite`.
   */
  localWritePath(key: string): Promise<string>
  commitLocalWrite(key: string): Promise<void>
}

/** Rejects absolute keys, `..` segments and backslashes, and returns the normalised key. */
export function normaliseKey(key: string): string {
  if (!key || key.includes('\\') || key.includes('\0')) throw new Error(`Invalid storage key: ${key}`)
  const normalised = posix.normalize(key)
  if (normalised.startsWith('/') || normalised === '.' || normalised.split('/').includes('..')) {
    throw new Error(`Invalid storage key: ${key}`)
  }
  return normalised.replace(/\/+$/, '')
}

export class LocalStorage implements Storage {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    const full = resolve(this.root, normaliseKey(key))
    if (!full.startsWith(resolve(this.root) + sep)) throw new Error(`Invalid storage key: ${key}`)
    return full
  }

  async put(key: string, data: Buffer | Uint8Array | string | Readable): Promise<void> {
    const target = this.pathFor(key)
    await mkdir(dirname(target), { recursive: true })
    // Write next to the target and rename, so readers never see a half-written file.
    const temp = `${target}.${randomUUID()}.partial`
    try {
      const source = data instanceof Readable ? data : Readable.from([data])
      await pipeline(source, createWriteStream(temp))
      await rename(temp, target)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key))
  }

  createReadStream(key: string, range?: { start: number; end: number }): Readable {
    return createReadStream(this.pathFor(key), range)
  }

  async stat(key: string) {
    try {
      const s = await stat(this.pathFor(key))
      return s.isFile() ? { size: s.size, modifiedAt: s.mtime } : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true, recursive: true })
  }

  async list(prefix: string): Promise<string[]> {
    const base = this.pathFor(prefix)
    try {
      const entries = await readdir(base, { recursive: true, withFileTypes: true })
      return entries
        .filter((e) => e.isFile() && !e.name.endsWith('.partial'))
        .map((e) => relative(this.root, join(e.parentPath, e.name)).split(sep).join('/'))
        .sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async localPath(key: string): Promise<string> {
    return this.pathFor(key)
  }

  async localWritePath(key: string): Promise<string> {
    const target = this.pathFor(key)
    await mkdir(dirname(target), { recursive: true })
    return target
  }

  async commitLocalWrite(_key: string): Promise<void> {
    // Local files are already in place.
  }
}
