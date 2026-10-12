import { createHash, type Hash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * Hugging Face answers a file URL with a redirect that names the file's size and SHA-256.
 * Reading them before downloading lets us verify the file afterwards.
 */
export async function fetchHuggingFaceMeta(url: string, signal?: AbortSignal): Promise<{ bytes: number | null; sha256: string | null }> {
  const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal })
  const size = Number(res.headers.get('x-linked-size'))
  const etag = res.headers.get('x-linked-etag')?.replace(/"/g, '') ?? null
  return {
    bytes: Number.isFinite(size) && size > 0 ? size : null,
    sha256: etag && /^[0-9a-f]{64}$/.test(etag) ? etag : null,
  }
}

export interface DownloadFileOptions {
  url: string
  dest: string
  expectedBytes?: number | null
  sha256?: string | null
  signal?: AbortSignal
  onProgress?: (fraction: number | null, downloadedBytes: number) => void
}

/** The file arrived but is wrong; the partial copy is useless and gets deleted. */
class CorruptDownloadError extends Error {}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function hashFile(path: string, hash: Hash): Promise<void> {
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
}

/**
 * Streams a file to `<dest>.partial`, checks its size and hash, then moves it into place.
 * An interrupted download keeps its partial file and continues from there next time.
 */
export async function downloadFile(opts: DownloadFileOptions): Promise<void> {
  const partial = `${opts.dest}.partial`
  await mkdir(dirname(opts.dest), { recursive: true })

  let offset = await sizeOf(partial)
  if (opts.expectedBytes && offset >= opts.expectedBytes) {
    await rm(partial, { force: true })
    offset = 0
  }

  const res = await fetch(opts.url, { signal: opts.signal, headers: offset ? { Range: `bytes=${offset}-` } : {} })
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
  // A server that ignores the Range header sends the whole file again.
  const resuming = offset > 0 && res.status === 206
  if (!resuming) offset = 0

  const hash = createHash('sha256')
  if (resuming && opts.sha256) await hashFile(partial, hash)

  const total = opts.expectedBytes ?? (Number(res.headers.get('content-length')) + offset || null)
  let received = offset
  let lastReport = 0
  const meter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      received += chunk.length
      hash.update(chunk)
      const now = Date.now()
      if (now - lastReport > 250) {
        lastReport = now
        opts.onProgress?.(total ? received / total : null, received)
      }
      done(null, chunk)
    },
  })

  try {
    await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(partial, { flags: resuming ? 'a' : 'w' }), {
      signal: opts.signal,
    })
    if (opts.expectedBytes && received < opts.expectedBytes) {
      throw new Error(`The connection closed early (${received} of ${opts.expectedBytes} bytes). Retry to continue.`)
    }
    if (opts.expectedBytes && received > opts.expectedBytes) {
      throw new CorruptDownloadError(`Got more data than expected (${received} of ${opts.expectedBytes} bytes). Try again.`)
    }
    if (opts.sha256 && hash.digest('hex') !== opts.sha256) {
      throw new CorruptDownloadError('The downloaded file is damaged (checksum mismatch). Try again.')
    }
    await rename(partial, opts.dest)
    opts.onProgress?.(1, received)
  } catch (error) {
    if (error instanceof CorruptDownloadError) await rm(partial, { force: true })
    throw error
  }
}
