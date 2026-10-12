import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { findExecutable } from './tools'

export interface RunOptions {
  signal?: AbortSignal
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
  /** Lines of stderr kept for error messages. */
  stderrTail?: number
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string[]
}

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly result: RunResult,
  ) {
    super(message)
  }
}

/** Raised when the run was stopped through its AbortSignal. */
export class AbortError extends Error {
  constructor() {
    super('Stopped')
    this.name = 'AbortError'
  }
}

/**
 * Runs a command line by line. On abort, the whole process group gets SIGTERM
 * (yt-dlp starts ffmpeg itself, and that child must stop too).
 */
export async function run(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  if (opts.signal?.aborted) throw new AbortError()
  const path = (await findExecutable(bin)) ?? bin
  const keep = opts.stderrTail ?? 40

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(path, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const stderr: string[] = []
    let stdout = ''
    let aborted = false

    const onAbort = () => {
      aborted = true
      try {
        process.kill(-child.pid!, 'SIGTERM')
      } catch {
        child.kill('SIGTERM')
      }
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    createInterface({ input: child.stdout! }).on('line', (line) => {
      if (opts.onStdoutLine) opts.onStdoutLine(line)
      else stdout += `${line}\n`
    })
    createInterface({ input: child.stderr! }).on('line', (line) => {
      stderr.push(line)
      if (stderr.length > keep) stderr.shift()
      opts.onStderrLine?.(line)
    })

    child.on('error', (error) => {
      opts.signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort)
      const result = { code: code ?? -1, stdout, stderr }
      if (aborted) reject(new AbortError())
      else if (result.code !== 0) reject(new ProcessError(`${bin} exited with code ${result.code}`, result))
      else resolve(result)
    })
  })
}
