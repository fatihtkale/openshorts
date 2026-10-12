import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DownloadQuality, TimeRange, YoutubeMeta } from '@clipstudio/core/shared'
import { ProcessError, run } from './process'

const COMMON_ARGS = ['--no-playlist', '--no-colors', '--socket-timeout', '30', '--retries', '5']

/** Turns yt-dlp's stderr into a sentence a person can act on. */
export function friendlyYtdlpError(stderr: string[]): string {
  const text = stderr.join('\n')
  if (/confirm you.?re not a bot/i.test(text)) {
    return 'YouTube asked for a bot check and blocked the download. Wait a while and retry; if it keeps happening, browser cookies will be needed.'
  }
  if (/confirm your age|age-restricted/i.test(text)) return 'This video is age-restricted, so YouTube requires a signed-in account to download it.'
  if (/private video/i.test(text)) return 'This video is private.'
  if (/members-only|join this channel/i.test(text)) return 'This video is for channel members only.'
  if (/requested format is not available/i.test(text)) return 'No download is available at this quality. Try "Best available".'
  if (/video unavailable|not available in your country/i.test(text)) return 'This video is unavailable (removed, blocked, or not available in your country).'
  if (/premieres in|live event will begin/i.test(text)) return 'This video has not premiered yet.'
  if (/unable to download webpage|timed out|network is unreachable|getaddrinfo/i.test(text)) {
    return 'Could not reach YouTube. Check the internet connection and retry.'
  }
  const last = [...stderr].reverse().find((l) => l.startsWith('ERROR:'))
  return last ? last.replace(/^ERROR:\s*(\[[^\]]+\]\s*[\w-]+:\s*)?/, '') : 'yt-dlp failed without an error message.'
}

/** Picks what we keep from `yt-dlp --dump-single-json`. */
export function parseYoutubeInfo(info: Record<string, unknown>): YoutubeMeta {
  const formats = Array.isArray(info.formats) ? (info.formats as { height?: number | null }[]) : []
  const heights = formats.map((f) => f.height ?? 0).filter((h) => h > 0)
  const id = String(info.id)
  return {
    videoId: id,
    title: String(info.title ?? 'Untitled video'),
    channel: (info.channel as string | undefined) ?? (info.uploader as string | undefined) ?? null,
    durationSec: typeof info.duration === 'number' ? info.duration : null,
    uploadDate: typeof info.upload_date === 'string' ? info.upload_date : null,
    // The hqdefault JPEG exists for every video, unlike maxres or webp variants.
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    license: typeof info.license === 'string' ? info.license : null,
    isLive: info.is_live === true || info.live_status === 'is_live' || info.live_status === 'is_upcoming',
    maxHeight: heights.length ? Math.max(...heights) : null,
  }
}

export async function fetchYoutubeInfo(url: string, signal?: AbortSignal): Promise<YoutubeMeta> {
  try {
    const { stdout } = await run('yt-dlp', [...COMMON_ARGS, '--dump-single-json', '--skip-download', url], { signal })
    return parseYoutubeInfo(JSON.parse(stdout) as Record<string, unknown>)
  } catch (error) {
    if (error instanceof ProcessError) throw new Error(friendlyYtdlpError(error.result.stderr))
    throw error
  }
}

/** Prefers H.264 up to the chosen height (fast to decode), then anything up to it, then whatever exists. */
export function formatSelector(quality: DownloadQuality): string {
  if (quality === 'best') return 'bv*+ba/b'
  const h = quality
  return `bv*[height<=${h}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/b`
}

export interface YtdlpProgress {
  downloaded: number
  total: number | null
  /** True for an audio-only part of a separate video+audio download. */
  audioOnly: boolean
}

const PROGRESS_PREFIX = 'CSPROG '

/** Parses one line written by our --progress-template. */
export function parseYtdlpProgress(line: string): YtdlpProgress | null {
  if (!line.startsWith(PROGRESS_PREFIX)) return null
  const [downloaded, total, estimate, vcodec] = line.slice(PROGRESS_PREFIX.length).split(' ')
  const n = (v: string | undefined) => {
    const x = Number(v)
    return Number.isFinite(x) && x > 0 ? x : null
  }
  return {
    downloaded: n(downloaded) ?? 0,
    total: n(total) ?? n(estimate),
    audioOnly: vcodec === 'none',
  }
}

export interface DownloadOptions {
  url: string
  outDir: string
  quality: DownloadQuality
  range?: TimeRange
  signal?: AbortSignal
  onProgress?: (fraction: number | null, message: string) => void
}

export interface DownloadResult {
  path: string
  bytes: number
}

/** Downloads to `<outDir>/source.mp4`, reporting progress across the video and audio parts. */
export async function downloadYoutube(opts: DownloadOptions): Promise<DownloadResult> {
  const template = `download:${PROGRESS_PREFIX}%(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(info.vcodec)s`
  const args = [
    ...COMMON_ARGS,
    '--newline',
    '--progress',
    '--progress-template',
    template,
    '--fragment-retries',
    '10',
    '-f',
    formatSelector(opts.quality),
    '--merge-output-format',
    'mp4',
    '-o',
    join(opts.outDir, 'source.%(ext)s'),
    '--print',
    'after_move:CSFILE %(filepath)s',
  ]
  if (opts.range) args.push('--download-sections', `*${opts.range.start}-${opts.range.end}`)
  args.push(opts.url)

  let finalPath: string | null = null
  let sawAudio = false
  let lastReport = 0

  const onLine = (line: string) => {
    if (line.startsWith('CSFILE ')) {
      finalPath = line.slice('CSFILE '.length).trim()
      return
    }
    const p = parseYtdlpProgress(line)
    if (!p) return
    const now = Date.now()
    if (now - lastReport < 250) return
    lastReport = now
    const mb = (p.downloaded / 1_048_576).toFixed(0)
    if (!p.total) {
      opts.onProgress?.(null, `Downloading… ${mb} MB`)
      return
    }
    const part = Math.min(1, p.downloaded / p.total)
    if (p.audioOnly) {
      sawAudio = true
      opts.onProgress?.(0.9 + part * 0.08, 'Downloading audio')
    } else {
      opts.onProgress?.(part * (sawAudio ? 0.98 : 0.9), `Downloading video · ${mb} of ${(p.total / 1_048_576).toFixed(0)} MB`)
    }
  }

  // Section downloads go through ffmpeg, which only reports once at the end.
  opts.onProgress?.(null, opts.range ? 'Downloading the selected part…' : 'Starting download…')
  try {
    // yt-dlp prints progress to stdout with --newline; --print output also goes to stdout.
    await run('yt-dlp', args, { signal: opts.signal, onStdoutLine: onLine, onStderrLine: onLine })
  } catch (error) {
    if (error instanceof ProcessError) throw new Error(friendlyYtdlpError(error.result.stderr))
    throw error
  }

  const path = finalPath ?? join(opts.outDir, 'source.mp4')
  const { size } = await stat(path)
  opts.onProgress?.(1, 'Downloaded')
  return { path, bytes: size }
}
