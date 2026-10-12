import type { ClipLayout, CropKeyframe, PanelWindow } from './types'
import { OUT_H, OUT_W } from './types'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/**
 * A window of aspect `aspect` (w/h) inside a srcW×srcH frame, centred on (cx, cy) in 0..1,
 * as large as fits at zoom 1, and kept fully inside the frame.
 */
export function windowRect(srcW: number, srcH: number, aspect: number, cx: number, cy: number, zoom = 1): Rect {
  let h = srcH
  let w = h * aspect
  if (w > srcW) {
    w = srcW
    h = w / aspect
  }
  w /= Math.max(1, zoom)
  h /= Math.max(1, zoom)
  const x = clamp(cx * srcW - w / 2, 0, srcW - w)
  const y = clamp(cy * srcH - h / 2, 0, srcH - h)
  return { x, y, w, h }
}

/** The fill window centre at `t` (ms from the clip start), easing between keyframes. */
export function centreAt(keyframes: CropKeyframe[], t: number): { x: number; y: number } {
  if (!keyframes.length) return { x: 0.5, y: 0.5 }
  const sorted = [...keyframes].sort((a, b) => a.t - b.t)
  if (t <= sorted[0]!.t) return { x: sorted[0]!.x, y: sorted[0]!.y }
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i]!
    const b = sorted[i + 1]!
    if (t < b.t) {
      const linear = (t - a.t) / Math.max(1, b.t - a.t)
      const p = a.ease === 'linear' ? linear : easeInOut(linear)
      return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p }
    }
  }
  const last = sorted.at(-1)!
  return { x: last.x, y: last.y }
}

/** The 9:16 source window for fill mode at `t`. */
export function fillRect(layout: ClipLayout, srcW: number, srcH: number, t: number): Rect {
  const c = centreAt(layout.keyframes, t)
  return windowRect(srcW, srcH, OUT_W / OUT_H, c.x, c.y, layout.zoom)
}

/** Split mode: each half is 1080×960 (9:8). */
export const SPLIT_ASPECT = OUT_W / (OUT_H / 2)

export function panelRect(panel: PanelWindow, srcW: number, srcH: number): Rect {
  return windowRect(srcW, srcH, SPLIT_ASPECT, panel.x, panel.y, panel.zoom)
}

/** Fit mode: the whole frame, as wide as the output, centred vertically. */
export function fitRect(srcW: number, srcH: number): Rect {
  const scale = Math.min(OUT_W / srcW, OUT_H / srcH)
  const w = srcW * scale
  const h = srcH * scale
  return { x: (OUT_W - w) / 2, y: (OUT_H - h) / 2, w, h }
}

/** Whether a source is already vertical (9:16 or taller), in which case fill needs no cropping choices. */
export function isVertical(srcW: number, srcH: number): boolean {
  return srcW / srcH <= OUT_W / OUT_H + 0.01
}
