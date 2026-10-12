import { ProcessError, run } from './process'

/** Reads `out_time_us=` from ffmpeg's `-progress` output; returns seconds processed. */
export function parseFfmpegProgress(line: string): number | null {
  const match = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim())
  return match ? Number(match[1]) / 1_000_000 : null
}

export interface FfmpegOptions {
  /** Length of the media being processed, for progress as a fraction. */
  durationMs?: number
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

/** Runs ffmpeg with progress reporting. Errors carry ffmpeg's own last lines. */
export async function ffmpeg(args: string[], opts: FfmpegOptions = {}): Promise<void> {
  const full = ['-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-y', ...args]
  const total = (opts.durationMs ?? 0) / 1000
  try {
    await run('ffmpeg', full, {
      signal: opts.signal,
      onStdoutLine: (line) => {
        const seconds = parseFfmpegProgress(line)
        if (seconds !== null && total > 0) opts.onProgress?.(Math.min(1, seconds / total))
      },
    })
  } catch (error) {
    if (error instanceof ProcessError) {
      const detail = error.result.stderr.filter(Boolean).slice(-3).join(' ')
      throw new Error(`ffmpeg failed: ${detail || `exit code ${error.result.code}`}`)
    }
    throw error
  }
}
