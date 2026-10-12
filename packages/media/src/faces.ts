import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { FaceBox, FaceTrack } from '@clipstudio/captions'
import { downloadFile } from './download'
import { AbortError } from './process'
import { findExecutable } from './tools'

/**
 * Face detector: Ultra-Light-Fast-Generic-Face-Detector (RFB-320, MIT licence) from the ONNX model zoo.
 * 1.3 MB, ~4 ms per frame on Apple Silicon. Downloaded on first use and checked against this hash.
 */
export const FACE_MODEL = {
  file: 'ultraface-rfb-320.onnx',
  url: 'https://media.githubusercontent.com/media/onnx/models/main/validated/vision/body_analysis/ultraface/models/version-RFB-320.onnx',
  bytes: 1_270_727,
  sha256: '34cd7e60aeff28744c657de7a3dc64e872d506741de66987f3426f2b79f88017',
}

const IN_W = 320
const IN_H = 240
const FRAME_BYTES = IN_W * IN_H * 3

export async function ensureFaceModel(modelsDir: string, signal?: AbortSignal): Promise<string> {
  const path = join(modelsDir, FACE_MODEL.file)
  if (existsSync(path) && statSync(path).size === FACE_MODEL.bytes) return path
  await downloadFile({ url: FACE_MODEL.url, dest: path, expectedBytes: FACE_MODEL.bytes, sha256: FACE_MODEL.sha256, signal })
  return path
}

function iou(a: FaceBox, b: FaceBox): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  return inter / (a.w * a.h + b.w * b.h - inter || 1)
}

/** Turns the model's 4420 candidate boxes into faces: confident ones, overlaps removed, biggest six kept. */
export function decodeFaces(scores: Float32Array, boxes: Float32Array, threshold = 0.6): FaceBox[] {
  const candidates: FaceBox[] = []
  for (let i = 0; i < scores.length / 2; i++) {
    const score = scores[i * 2 + 1]!
    if (score < threshold) continue
    const x1 = Math.max(0, boxes[i * 4]!)
    const y1 = Math.max(0, boxes[i * 4 + 1]!)
    const x2 = Math.min(1, boxes[i * 4 + 2]!)
    const y2 = Math.min(1, boxes[i * 4 + 3]!)
    if (x2 > x1 && y2 > y1) candidates.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1, score })
  }
  candidates.sort((a, b) => b.score - a.score)
  const kept: FaceBox[] = []
  for (const c of candidates) if (kept.every((k) => iou(k, c) < 0.3)) kept.push(c)
  return kept
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, 6)
    .map((f) => ({ x: r4(f.x), y: r4(f.y), w: r4(f.w), h: r4(f.h), score: Math.round(f.score * 100) / 100 }))
}

const r4 = (v: number) => Math.round(v * 10000) / 10000

/** Where a w×h frame sits inside the 320×240 input when fitted without stretching (even sizes for ffmpeg). */
export function letterbox(w: number, h: number): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(IN_W / w, IN_H / h)
  const fw = Math.min(IN_W, Math.round((w * scale) / 2) * 2)
  const fh = Math.min(IN_H, Math.round((h * scale) / 2) * 2)
  return { x: (IN_W - fw) / 2, y: (IN_H - fh) / 2, w: fw, h: fh }
}

/** Maps boxes from the padded input back to 0..1 of the source frame. */
export function unpad(faces: FaceBox[], fit: { x: number; y: number; w: number; h: number }): FaceBox[] {
  return faces
    .map((f) => ({
      ...f,
      x: r4((f.x * IN_W - fit.x) / fit.w),
      y: r4((f.y * IN_H - fit.y) / fit.h),
      w: r4((f.w * IN_W) / fit.w),
      h: r4((f.h * IN_H) / fit.h),
    }))
    .filter((f) => f.x + f.w > 0 && f.x < 1 && f.y + f.h > 0 && f.y < 1)
}

/** Mean absolute difference of two small grey thumbnails, 0..255: a big jump means a new shot. */
export function frameDifference(a: Uint8Array, b: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!)
  return sum / a.length
}

/** 80×60 greyscale thumbnail of an RGB frame (every 4th pixel). */
function thumbnail(rgb: Buffer): Uint8Array {
  const out = new Uint8Array(80 * 60)
  for (let y = 0; y < 60; y++) {
    for (let x = 0; x < 80; x++) {
      const i = (y * 4 * IN_W + x * 4) * 3
      out[y * 80 + x] = (rgb[i]! * 77 + rgb[i + 1]! * 150 + rgb[i + 2]! * 29) >> 8
    }
  }
  return out
}

export interface DetectFacesOptions {
  /** The preview copy (720p is plenty). */
  src: string
  /** Display size of the source, to keep its shape when fitting it into the model's 320×240 input. */
  width: number
  height: number
  durationMs: number
  modelPath: string
  sampleMs?: number
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

/** Samples the video, finds faces in each sample, and marks scene cuts. */
export async function detectFaces(opts: DetectFacesOptions): Promise<FaceTrack> {
  const sampleMs = opts.sampleMs ?? 200
  // Imported here so the rest of the media package works without loading the native runtime.
  const ort = await import('onnxruntime-node')
  const session = await ort.InferenceSession.create(opts.modelPath, { logSeverityLevel: 3 })
  const ffmpegPath = (await findExecutable('ffmpeg')) ?? 'ffmpeg'
  const fit = letterbox(opts.width, opts.height)
  const child = spawn(
    ffmpegPath,
    [
      '-hide_banner', '-loglevel', 'error', '-i', opts.src,
      // Fit without stretching (faces stay face-shaped), padding the rest.
      '-vf', `fps=${1000 / sampleMs},scale=${fit.w}:${fit.h},pad=${IN_W}:${IN_H}:${fit.x}:${fit.y}`,
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const onAbort = () => child.kill('SIGTERM')
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  const stderr: string[] = []
  child.stderr.on('data', (d: Buffer) => stderr.push(d.toString()))
  const exited = new Promise<number>((resolve) => child.on('close', (code) => resolve(code ?? -1)))

  const total = Math.max(1, Math.ceil(opts.durationMs / sampleMs))
  const frames: FaceBox[][] = []
  const cuts: number[] = []
  const input = new Float32Array(3 * IN_W * IN_H)
  let pending: Buffer = Buffer.alloc(0)
  let previousThumb: Uint8Array | null = null
  const diffs: number[] = []

  try {
    for await (const chunk of child.stdout) {
      pending = pending.length ? Buffer.concat([pending, chunk as Buffer]) : (chunk as Buffer)
      while (pending.length >= FRAME_BYTES) {
        const frame = pending.subarray(0, FRAME_BYTES)
        // Planar, normalised as the model expects: (value − 127) / 128.
        const plane = IN_W * IN_H
        for (let p = 0; p < plane; p++) {
          input[p] = (frame[p * 3]! - 127) / 128
          input[plane + p] = (frame[p * 3 + 1]! - 127) / 128
          input[plane * 2 + p] = (frame[p * 3 + 2]! - 127) / 128
        }
        const out = await session.run({ input: new ort.Tensor('float32', input, [1, 3, IN_H, IN_W]) })
        frames.push(unpad(decodeFaces(out.scores!.data as Float32Array, out.boxes!.data as Float32Array), fit))

        const thumb = thumbnail(frame)
        if (previousThumb) {
          const diff = frameDifference(previousThumb, thumb)
          // A cut is a jump well above the recent motion level.
          const recent = diffs.slice(-10)
          const baseline = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0
          if (diff > 28 && diff > baseline * 3) cuts.push(frames.length * sampleMs - sampleMs)
          diffs.push(diff)
        }
        previousThumb = thumb
        pending = Buffer.from(pending.subarray(FRAME_BYTES))
        if (frames.length % 10 === 0) opts.onProgress?.(Math.min(1, frames.length / total))
      }
      if (opts.signal?.aborted) throw new AbortError()
    }
    const code = await exited
    if (opts.signal?.aborted) throw new AbortError()
    if (code !== 0) throw new Error(`Reading the video for faces failed: ${stderr.join(' ').trim().slice(-200)}`)
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
    child.kill('SIGTERM')
    await session.release()
  }
  opts.onProgress?.(1)
  return { version: 1, sampleMs, frames, cuts }
}
