/// <reference lib="dom" />
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { drawCredit, outputDuration, type CreditBanner, type Range } from '@clipstudio/captions'
import { createCanvas } from '@napi-rs/canvas'
import { ffmpeg } from './ffmpeg'
import { parseFfmpegProgress } from './ffmpeg'
import { AbortError } from './process'
import type { VideoEncoder } from './prepare'
import { registerCaptionFonts, selectExpression } from './render'
import { findExecutable } from './tools'

export const COMPILATION_FPS = 30
/** A short fade at each clip's edges, so cuts between streamers don't pop. */
const EDGE_FADE_S = 0.15
/** Loudness every clip is brought to (YouTube plays around -14 LUFS; a little under leaves headroom). */
export const TARGET_LUFS = -16
/** Gain is capped, so a near-silent clip isn't blown up into noise. */
const MAX_GAIN_DB = 15

/**
 * The integrated loudness (LUFS) of the kept parts' audio, or null when it's silent or unreadable. Audio only, so it
 * takes a fraction of a second per clip.
 */
export async function measureLoudness(src: string, segments: Range[], signal?: AbortSignal): Promise<number | null> {
  const t0 = segments[0]!.start
  const span = segments.at(-1)!.end - t0
  const select = selectExpression(segments)
  const filter = `${select ? `aselect='${select}',asetpts=N/SR/TB,` : ''}ebur128=framelog=quiet`
  const args = ['-hide_banner', '-nostats', '-ss', sec(t0), '-t', sec(span), '-i', src, '-vn', '-af', filter, '-f', 'null', '-']
  const child = spawn((await findExecutable('ffmpeg')) ?? 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
  let text = ''
  child.stderr!.on('data', (d: Buffer) => (text = (text + d.toString()).slice(-4000)))
  const onAbort = () => child.kill('SIGTERM')
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (c) => resolve(c ?? -1))
    })
    if (signal?.aborted) throw new AbortError()
    return code === 0 ? parseIntegratedLoudness(text) : null
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Reads "I: -23.4 LUFS" from ebur128's summary; null for silence (-70 or below) or nothing found. */
export function parseIntegratedLoudness(stderr: string): number | null {
  const all = [...stderr.matchAll(/I:\s+(-?[\d.]+|-inf)\s+LUFS/g)]
  const last = all.at(-1)?.[1]
  if (!last || last === '-inf') return null
  const v = Number(last)
  return Number.isFinite(v) && v > -70 ? v : null
}

/** dB to add to reach the target, capped both ways; 0 for silence. */
export function loudnessGain(lufs: number | null): number {
  if (lufs === null) return 0
  return Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, TARGET_LUFS - lufs))
}

export interface CompilationPartOptions {
  src: string
  source: { width: number; height: number; hasAudio: boolean }
  /** The clip's kept parts (its trims applied), source milliseconds. */
  segments: Range[]
  /** Output size, e.g. 1920×1080. The source is fitted inside (black bars if its shape differs). */
  width: number
  height: number
  /** dB to add to the audio (from measureLoudness/loudnessGain); a limiter catches peaks after. */
  gainDb: number
  /** Credit banner shown at the start; null for none. */
  banner: { credit: CreditBanner; durationMs: number } | null
  encoder: VideoEncoder
  out: string
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

const sec = (ms: number) => (ms / 1000).toFixed(3)

/**
 * Renders one clip of a compilation: its kept parts, fitted into the landscape frame, with the gain that evens out its
 * loudness (so quiet and loud streamers match), short fades at both ends, and the credit banner drawn by the shared caption
 * engine and laid on top for its first seconds. Every part gets the same codecs, so they join without re-encoding.
 */
export async function renderCompilationPart(opts: CompilationPartOptions): Promise<{ durationMs: number }> {
  registerCaptionFonts()
  const { segments, source, width: W, height: H } = opts
  if (!segments.length) throw new Error('Nothing is left of a clip after its cuts.')
  const durationMs = outputDuration(segments)
  const frames = Math.max(1, Math.round((durationMs / 1000) * COMPILATION_FPS))
  const t0 = segments[0]!.start
  const span = segments.at(-1)!.end - t0
  const select = selectExpression(segments)
  const dur = durationMs / 1000
  const fadeOut = Math.max(0, dur - EDGE_FADE_S).toFixed(3)
  const bannerFrames = opts.banner ? Math.min(frames, Math.ceil((opts.banner.durationMs / 1000) * COMPILATION_FPS)) : 0

  await mkdir(dirname(opts.out), { recursive: true })
  const graph = [
    `[0:v]fps=${COMPILATION_FPS}${select ? `,select='${select}'` : ''},setpts=N/${COMPILATION_FPS}/TB,` +
      `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,` +
      `fade=t=in:st=0:d=${EDGE_FADE_S},fade=t=out:st=${fadeOut}:d=${EDGE_FADE_S}[v]`,
    bannerFrames ? '[v][1:v]overlay=0:0:format=auto:eof_action=pass,format=yuv420p[vout]' : '[v]format=yuv420p[vout]',
  ]
  const audioIn = source.hasAudio ? '0:a' : `${bannerFrames ? 2 : 1}:a`
  graph.push(
    `[${audioIn}]${source.hasAudio && select ? `aselect='${select}',asetpts=N/SR/TB,` : ''}` +
      `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${opts.gainDb.toFixed(2)}dB,alimiter=limit=0.9:level=disabled,` +
      `afade=t=in:st=0:d=${EDGE_FADE_S},afade=t=out:st=${fadeOut}:d=${EDGE_FADE_S}[aout]`,
  )

  const encode =
    opts.encoder === 'h264_videotoolbox'
      ? ['-c:v', 'h264_videotoolbox', '-b:v', '12M', '-maxrate', '16M', '-profile:v', 'high', '-allow_sw', '1']
      : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-profile:v', 'high']
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-y',
    '-ss', sec(t0), '-t', sec(span), '-i', opts.src,
    ...(bannerFrames ? ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(COMPILATION_FPS), '-i', 'pipe:0'] : []),
    ...(source.hasAudio ? [] : ['-f', 'lavfi', '-t', sec(durationMs), '-i', 'anullsrc=r=48000:cl=stereo']),
    '-filter_complex', graph.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    ...encode,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-r', String(COMPILATION_FPS), '-frames:v', String(frames), '-t', sec(durationMs),
    '-pix_fmt', 'yuv420p', '-video_track_timescale', '30000', '-movflags', '+faststart',
    opts.out,
  ]

  const child = spawn((await findExecutable('ffmpeg')) ?? 'ffmpeg', args, { stdio: [bannerFrames ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
  const stderr: string[] = []
  child.stderr!.on('data', (d: Buffer) => {
    stderr.push(...d.toString().split('\n').filter(Boolean))
    if (stderr.length > 30) stderr.splice(0, stderr.length - 30)
  })
  child.stdout!.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n')) {
      const s = parseFfmpegProgress(line)
      if (s !== null) opts.onProgress?.(Math.min(1, s / dur))
    }
  })
  const onAbort = () => child.kill('SIGTERM')
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  const exited = new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? -1))
  })
  try {
    if (bannerFrames && opts.banner) await streamBanner(child.stdin!, opts.banner, W, H, bannerFrames, opts.signal)
    const code = await exited
    if (opts.signal?.aborted) throw new AbortError()
    if (code !== 0) throw new Error(`Export failed: ${stderr.slice(-3).join(' ') || `ffmpeg exited with code ${code}`}`)
    opts.onProgress?.(1)
    return { durationMs }
  } catch (error) {
    child.kill('SIGTERM')
    await rm(opts.out, { force: true })
    throw opts.signal?.aborted ? new AbortError() : error
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

/** Draws the banner's frames (only as many as it's on screen; ffmpeg passes the video through after that). */
async function streamBanner(
  stdin: NodeJS.WritableStream,
  banner: { credit: CreditBanner; durationMs: number },
  W: number,
  H: number,
  frames: number,
  signal?: AbortSignal,
): Promise<void> {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
  let broken: Error | null = null
  stdin.on('error', (e: Error) => (broken = e))
  for (let i = 0; i < frames; i++) {
    if (signal?.aborted) throw new AbortError()
    if (broken) throw broken
    ctx.clearRect(0, 0, W, H)
    drawCredit(ctx, banner.credit, (i * 1000) / COMPILATION_FPS, banner.durationMs, W, H)
    const frame = Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer)
    if (!stdin.write(frame)) await new Promise<void>((resolve) => stdin.once('drain', () => resolve()))
  }
  stdin.end()
}

/** Joins finished parts (same codecs) into one MP4 without re-encoding. */
export async function joinParts(parts: string[], out: string, workDir: string, signal?: AbortSignal): Promise<void> {
  if (!parts.length) throw new Error('Nothing to join')
  await mkdir(workDir, { recursive: true })
  const list = join(workDir, 'parts.txt')
  await writeFile(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
  try {
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { signal })
  } finally {
    await rm(list, { force: true })
  }
}
