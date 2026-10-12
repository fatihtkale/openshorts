import type { ClipLayout, CropKeyframe, Range } from './types'

/** A detected face, in 0..1 of the source frame. */
export interface FaceBox {
  x: number
  y: number
  w: number
  h: number
  score: number
}

/** Faces found in a whole source video, sampled at a fixed interval, plus where the shots change. */
export interface FaceTrack {
  version: 1
  /** Milliseconds between samples. */
  sampleMs: number
  /** One entry per sample: the faces in that frame (may be empty). */
  frames: FaceBox[][]
  /** Scene cuts, in source milliseconds. */
  cuts: number[]
}

const MIN_SCORE = 0.6
/** The window only starts moving when the face drifts this far (share of the frame width) from where it points. */
const DEAD_ZONE = 0.035
/** How quickly the window catches up per sample (0..1). */
const FOLLOW = 0.22
/** Simplification tolerance for the resulting path, as a share of the frame. */
const TOLERANCE = 0.006

interface Target {
  x: number
  y: number
}

/** The face to follow in one frame: stay on the previous one unless another is clearly bigger. */
function pickFace(faces: FaceBox[], previous: Target | null): Target | null {
  const usable = faces.filter((f) => f.score >= MIN_SCORE)
  if (!usable.length) return null
  const centre = (f: FaceBox) => ({ x: f.x + f.w / 2, y: f.y + f.h / 2 })
  const largest = usable.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a))
  if (previous) {
    const near = usable
      .map((f) => ({ f, d: Math.hypot(centre(f).x - previous.x, centre(f).y - previous.y) }))
      .filter((n) => n.d < 0.15)
      .sort((a, b) => a.d - b.d)[0]
    if (near && largest.w * largest.h < near.f.w * near.f.h * 1.8) return centre(near.f)
  }
  return centre(largest)
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

/** Drops points that lie (nearly) on the line between their neighbours. */
function simplify(points: CropKeyframe[], tolerance: number): CropKeyframe[] {
  if (points.length <= 2) return points
  const first = points[0]!
  const last = points.at(-1)!
  let worst = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!
    const k = (p.t - first.t) / Math.max(1, last.t - first.t)
    const d = Math.max(Math.abs(p.x - (first.x + (last.x - first.x) * k)), Math.abs(p.y - (first.y + (last.y - first.y) * k)))
    if (d > worst) {
      worst = d
      index = i
    }
  }
  if (worst <= tolerance) return [first, last]
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)]
}

/**
 * A smooth camera path that keeps the main face in frame, for a clip. Keyframes are relative to the clip start
 * and interpolate linearly (the path is already smoothed). At a scene cut the window jumps instead of sliding.
 */
export function autoFrame(track: FaceTrack, clip: Range): CropKeyframe[] {
  const step = track.sampleMs
  const first = Math.max(0, Math.floor(clip.start / step))
  const last = Math.min(track.frames.length - 1, Math.ceil(clip.end / step))
  if (last < first) return [{ t: 0, x: 0.5, y: 0.5 }]

  // Split the clip into shots.
  const cuts = track.cuts.filter((c) => c > clip.start && c < clip.end)
  const shots: number[][] = [[]]
  for (let i = first; i <= last; i++) {
    const t = i * step
    if (cuts.some((c) => c > t - step && c <= t) && shots.at(-1)!.length) shots.push([])
    shots.at(-1)!.push(i)
  }

  const out: CropKeyframe[] = []
  let carried: Target | null = null
  for (const shot of shots) {
    // Raw targets, holding the last seen face through gaps.
    let previous: Target | null = null
    const raw: (Target | null)[] = shot.map((i) => {
      const target = pickFace(track.frames[i] ?? [], previous)
      if (target) previous = target
      return target
    })
    const firstSeen: Target = raw.find((r): r is Target => !!r) ?? carried ?? { x: 0.5, y: 0.5 }
    let hold: Target = firstSeen
    const filled: Target[] = raw.map((r) => (r ? (hold = r) : hold))

    // Median filter against detector jitter, then follow with a dead zone and easing.
    const xs = filled.map((_, i) => median(filled.slice(Math.max(0, i - 2), i + 3).map((f) => f.x)))
    const ys = filled.map((_, i) => median(filled.slice(Math.max(0, i - 2), i + 3).map((f) => f.y)))
    let cx = xs[0]!
    let cy = ys[0]!
    const points: CropKeyframe[] = []
    shot.forEach((sample, k) => {
      const dx = xs[k]! - cx
      const dy = ys[k]! - cy
      if (Math.abs(dx) > DEAD_ZONE) cx += (dx - Math.sign(dx) * DEAD_ZONE) * FOLLOW
      if (Math.abs(dy) > DEAD_ZONE * 2) cy += (dy - Math.sign(dy) * DEAD_ZONE * 2) * FOLLOW
      const t = Math.max(0, Math.round(sample * step - clip.start))
      points.push({ t, x: round(cx), y: round(cy), ease: 'linear' })
    })

    const simple = simplify(points, TOLERANCE)
    if (out.length && simple.length) {
      // Hard cut: hold the old position until just before the new shot starts.
      const start = simple[0]!.t
      out.push({ ...out.at(-1)!, t: Math.max(out.at(-1)!.t, start - 1) })
    }
    out.push(...simple)
    carried = { x: cx, y: cy }
  }
  if (!out.length || out[0]!.t > 0) out.unshift({ ...(out[0] ?? { x: 0.5, y: 0.5 }), t: 0, ease: 'linear' })
  return out
}

const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000

/** Share of the clip's samples in which a usable face was found, 0..1. */
export function faceCoverage(track: FaceTrack, clip: Range): number {
  const first = Math.max(0, Math.floor(clip.start / track.sampleMs))
  const last = Math.min(track.frames.length - 1, Math.floor(clip.end / track.sampleMs))
  if (last < first) return 0
  let hits = 0
  for (let i = first; i <= last; i++) if ((track.frames[i] ?? []).some((f) => f.score >= MIN_SCORE)) hits++
  return hits / (last - first + 1)
}

/** The layout to draw: with "follow faces" on (fill mode), its keyframes come from the face track. */
export function resolveLayout(layout: ClipLayout, track: FaceTrack | null, clip: Range): ClipLayout {
  if (layout.mode !== 'fill' || !layout.auto || !track) return layout
  return { ...layout, keyframes: autoFrame(track, clip) }
}
