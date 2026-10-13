/// <reference lib="dom" />
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import {
  drawCaptions,
  drawHook,
  fillRect,
  fontFiles,
  OUT_FPS,
  OUT_H,
  OUT_W,
  outputDuration,
  outputToSource,
  pageAt,
  paginate,
  panelRect,
  screenPanels,
  type CaptionStyle,
  type CaptionWord,
  type ClipLayout,
  type HookSettings,
  type Range,
} from '@clipstudio/captions'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { AbortError } from './process'
import { parseFfmpegProgress } from './ffmpeg'
import type { VideoEncoder } from './prepare'
import { findExecutable } from './tools'

let fontsRegistered = false

/** Registers the caption fonts with the Node canvas (once), from the same Fontsource files the browser uses. */
export function registerCaptionFonts(): void {
  if (fontsRegistered) return
  const require = createRequire(import.meta.url)
  const captionsDir = dirname(require.resolve('@clipstudio/captions/package.json'))
  for (const f of fontFiles()) {
    const file = join(captionsDir, 'node_modules', f.path)
    if (existsSync(file)) GlobalFonts.registerFromPath(file, f.family)
  }
  fontsRegistered = true
}

export interface RenderClipOptions {
  src: string
  /** Display size of the source (rotation applied), and whether it has sound. */
  source: { width: number; height: number; hasAudio: boolean }
  /** The kept parts of the clip, source milliseconds. */
  segments: Range[]
  /** The clip's start in the source; layout keyframes count from here. */
  clipStartMs: number
  layout: ClipLayout
  captions: { style: CaptionStyle; words: CaptionWord[] } | null
  hook: HookSettings | null
  out: string
  /** Scratch folder for the crop command file. */
  workDir: string
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

export interface RenderClipResult {
  durationMs: number
  frames: number
  encoder: VideoEncoder
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)
const sec = (ms: number) => (ms / 1000).toFixed(3)

/** ffmpeg `select` expression keeping the segments, relative to the first segment's start. */
export function selectExpression(segments: Range[]): string | null {
  if (segments.length <= 1) return null
  const t0 = segments[0]!.start
  return segments.map((s) => `between(t,${sec(s.start - t0)},${sec(s.end - t0)})`).join('+')
}

/**
 * Builds the filter graph for the video layout. Fill uses `sendcmd` to move the crop window per frame
 * when the layout has keyframes; the command file is written by the caller.
 */
export function layoutFilter(
  layout: ClipLayout,
  srcW: number,
  srcH: number,
  opts: { cmdFile: string | null; firstCrop: { x: number; y: number; w: number; h: number } },
): string {
  if (layout.mode === 'fit') {
    return [
      '[base]split[a][b]',
      // Blur a small copy and scale it back up: a soft backdrop for a fraction of the cost.
      `[a]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},scale=270:480,boxblur=18:2,scale=${OUT_W}:${OUT_H},eq=brightness=-0.08:saturation=1.1[bg]`,
      `[b]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease:flags=lanczos[fg]`,
      '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]',
    ].join(';')
  }
  if (layout.mode === 'split') {
    const top = panelRect(layout.split.top, srcW, srcH)
    const bottom = panelRect(layout.split.bottom, srcW, srcH)
    const crop = (r: typeof top) => `crop=${even(r.w)}:${even(r.h)}:${Math.round(r.x)}:${Math.round(r.y)}`
    return [
      '[base]split[a][b]',
      `[a]${crop(top)},scale=${OUT_W}:${OUT_H / 2}:flags=lanczos,setsar=1[top]`,
      `[b]${crop(bottom)},scale=${OUT_W}:${OUT_H / 2}:flags=lanczos,setsar=1[bot]`,
      '[top][bot]vstack[v]',
    ].join(';')
  }
  if (layout.mode === 'screen') {
    const p = screenPanels(layout, srcW, srcH)
    const crop = (r: { x: number; y: number; w: number; h: number }) => `crop=${even(r.w)}:${even(r.h)}:${Math.round(r.x)}:${Math.round(r.y)}`
    return [
      '[base]split[a][b]',
      `[a]${crop(p.screen.src)},scale=${OUT_W}:${p.screen.out.h}:flags=lanczos,setsar=1[scr]`,
      `[b]${crop(p.face.src)},scale=${OUT_W}:${p.face.out.h}:flags=lanczos,setsar=1[face]`,
      p.face.out.y === 0 ? '[face][scr]vstack[v]' : '[scr][face]vstack[v]',
    ].join(';')
  }
  const c = opts.firstCrop
  const cmd = opts.cmdFile ? `sendcmd=f='${opts.cmdFile.replace(/'/g, "'\\''")}',` : ''
  return `[base]${cmd}crop@c=w=${even(c.w)}:h=${even(c.h)}:x=${Math.round(c.x)}:y=${Math.round(c.y)},scale=${OUT_W}:${OUT_H}:flags=lanczos,setsar=1[v]`
}

/** One line per frame where the crop window moves: "0.033 crop@c x 412, crop@c y 0;" */
export function cropCommands(layout: ClipLayout, srcW: number, srcH: number, segments: Range[], clipStartMs: number, frames: number): string {
  const lines: string[] = []
  let last = ''
  for (let i = 0; i < frames; i++) {
    const outMs = (i * 1000) / OUT_FPS
    const r = fillRect(layout, srcW, srcH, outputToSource(segments, outMs) - clipStartMs)
    const value = `${Math.round(r.x)} ${Math.round(r.y)}`
    if (value === last) continue
    last = value
    lines.push(`${(i / OUT_FPS).toFixed(4)} crop@c x ${Math.round(r.x)}, crop@c y ${Math.round(r.y)};`)
  }
  return lines.join('\n')
}

/**
 * Renders a vertical 1080×1920 MP4 of a clip: ffmpeg cuts, crops and encodes the video, and the caption engine
 * draws each frame's captions and hook, streamed into ffmpeg and laid on top.
 */
export async function renderClip(opts: RenderClipOptions): Promise<RenderClipResult> {
  registerCaptionFonts()
  try {
    return await renderOnce(opts, 'h264_videotoolbox')
  } catch (error) {
    if (opts.signal?.aborted || error instanceof AbortError) throw error
    // The hardware encoder can be busy or missing; the software one always works.
    return renderOnce(opts, 'libx264')
  }
}

async function renderOnce(opts: RenderClipOptions, encoder: VideoEncoder): Promise<RenderClipResult> {
  const { segments, source } = opts
  if (!segments.length) throw new Error('Nothing is left of this clip after the cuts.')
  const durationMs = outputDuration(segments)
  const frames = Math.max(1, Math.round((durationMs / 1000) * OUT_FPS))
  const t0 = segments[0]!.start
  const span = segments.at(-1)!.end - t0
  const select = selectExpression(segments)

  await mkdir(opts.workDir, { recursive: true })
  await mkdir(dirname(opts.out), { recursive: true })

  let cmdFile: string | null = null
  if (opts.layout.mode === 'fill' && opts.layout.keyframes.length > 1) {
    cmdFile = join(opts.workDir, 'crop.cmd')
    await writeFile(cmdFile, cropCommands(opts.layout, source.width, source.height, segments, opts.clipStartMs, frames))
  }
  const firstCrop = fillRect(opts.layout, source.width, source.height, segments[0]!.start - opts.clipStartMs)

  const overlay = !!opts.captions?.words.length || !!(opts.hook?.enabled && opts.hook.text.trim())
  const video = `[0:v]fps=${OUT_FPS}${select ? `,select='${select}'` : ''},setpts=N/${OUT_FPS}/TB[base]`
  const graph = [video, layoutFilter(opts.layout, source.width, source.height, { cmdFile, firstCrop })]
  graph.push(overlay ? '[v][1:v]overlay=0:0:format=auto:eof_action=pass,format=yuv420p[out]' : '[v]format=yuv420p[out]')
  if (source.hasAudio) graph.push(`[0:a]${select ? `aselect='${select}',asetpts=N/SR/TB` : 'anull'}[aout]`)

  const encode =
    encoder === 'h264_videotoolbox'
      ? ['-c:v', 'h264_videotoolbox', '-b:v', '10M', '-maxrate', '14M', '-profile:v', 'high', '-allow_sw', '1']
      : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-profile:v', 'high']
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-y',
    '-ss', sec(t0), '-t', sec(span), '-i', opts.src,
    ...(overlay ? ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${OUT_W}x${OUT_H}`, '-r', String(OUT_FPS), '-i', 'pipe:0'] : []),
    '-filter_complex', graph.join(';'),
    '-map', '[out]',
    ...(source.hasAudio ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : []),
    ...encode,
    '-r', String(OUT_FPS), '-frames:v', String(frames), '-t', sec(durationMs),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    opts.out,
  ]

  const ffmpegPath = (await findExecutable('ffmpeg')) ?? 'ffmpeg'
  const child = spawn(ffmpegPath, args, { stdio: [overlay ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
  const stderr: string[] = []
  child.stderr!.on('data', (d: Buffer) => {
    stderr.push(...d.toString().split('\n').filter(Boolean))
    if (stderr.length > 30) stderr.splice(0, stderr.length - 30)
  })
  let lastFraction = 0
  const report = (f: number) => {
    if (f > lastFraction + 0.005 || f >= 1) {
      lastFraction = f
      opts.onProgress?.(Math.min(1, f))
    }
  }
  if (!overlay) {
    child.stdout!.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n')) {
        const s = parseFfmpegProgress(line)
        if (s !== null) report(s / (durationMs / 1000))
      }
    })
  } else {
    child.stdout!.resume()
  }

  const onAbort = () => child.kill('SIGTERM')
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  const exited = new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? -1))
  })

  try {
    if (overlay) await streamOverlay(child.stdin!, opts, frames, report)
    const code = await exited
    if (opts.signal?.aborted) throw new AbortError()
    if (code !== 0) throw new Error(`Export failed: ${stderr.slice(-3).join(' ') || `ffmpeg exited with code ${code}`}`)
    report(1)
    return { durationMs, frames, encoder }
  } catch (error) {
    child.kill('SIGTERM')
    await rm(opts.out, { force: true })
    throw opts.signal?.aborted ? new AbortError() : error
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
    if (cmdFile) await rm(cmdFile, { force: true })
  }
}

/** Draws every frame's captions and hook and writes them to ffmpeg, waiting when its input is full. */
async function streamOverlay(
  stdin: NodeJS.WritableStream,
  opts: RenderClipOptions,
  frames: number,
  report: (f: number) => void,
): Promise<void> {
  const canvas = createCanvas(OUT_W, OUT_H)
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
  const pages = opts.captions ? paginate(ctx, opts.captions.words, opts.captions.style) : []
  const blank = Buffer.alloc(OUT_W * OUT_H * 4)
  let broken: Error | null = null
  stdin.on('error', (e: Error) => (broken = e))

  for (let i = 0; i < frames; i++) {
    if (opts.signal?.aborted) throw new AbortError()
    if (broken) throw broken
    const t = (i * 1000) / OUT_FPS
    const hookOn = !!opts.hook?.enabled && t <= opts.hook.durationMs
    let frame = blank
    if (hookOn || (opts.captions && pageAt(pages, t))) {
      ctx.clearRect(0, 0, OUT_W, OUT_H)
      if (opts.captions) drawCaptions(ctx, pages, opts.captions.style, t)
      if (opts.hook) drawHook(ctx, opts.hook, t)
      frame = Buffer.from(ctx.getImageData(0, 0, OUT_W, OUT_H).data.buffer)
    }
    if (!stdin.write(frame)) await new Promise<void>((resolve) => stdin.once('drain', () => resolve()))
    report((i + 1) / frames)
  }
  stdin.end()
}

