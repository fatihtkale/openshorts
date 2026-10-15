import type { ClipLayout, CropKeyframe, PanelWindow, ScreenLayout } from './types'
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

export const DEFAULT_SCREEN: ScreenLayout = {
  screen: { x: 0.5, y: 0.5, zoom: 1 },
  face: { x: 0.5, y: 0.5, zoom: 1 },
  faceOnTop: false,
}

/** Without a chosen size the screen keeps its own shape, but never under a quarter or over 60% of the height. */
const SCREEN_MIN_H = 480
const SCREEN_MAX_H = 1152
/** The range a chosen screen size may take (share of the frame height). */
export const SCREEN_SHARE_MIN = 0.2
export const SCREEN_SHARE_MAX = 0.8

/** Share of the frame height the screen takes: the chosen size, or the source's own shape at full width. */
export function screenShare(layout: ClipLayout, srcW: number, srcH: number): number {
  const chosen = layout.screen?.screenShare
  if (chosen !== undefined) return clamp(chosen, SCREEN_SHARE_MIN, SCREEN_SHARE_MAX)
  return clamp((OUT_W * srcH) / srcW, SCREEN_MIN_H, SCREEN_MAX_H) / OUT_H
}

/**
 * Screen mode: where each part comes from in the source and where it lands in the 1080×1920 output. A screen part
 * taller than the source's shape crops its sides (zoom crops further).
 */
export function screenPanels(layout: ClipLayout, srcW: number, srcH: number): { screen: { src: Rect; out: Rect }; face: { src: Rect; out: Rect } } {
  const s = layout.screen ?? DEFAULT_SCREEN
  const screenH = Math.round((screenShare(layout, srcW, srcH) * OUT_H) / 2) * 2
  const faceH = OUT_H - screenH
  return {
    screen: {
      src: windowRect(srcW, srcH, OUT_W / screenH, s.screen.x, s.screen.y, s.screen.zoom),
      out: { x: 0, y: s.faceOnTop ? faceH : 0, w: OUT_W, h: screenH },
    },
    face: {
      src: windowRect(srcW, srcH, OUT_W / faceH, s.face.x, s.face.y, s.face.zoom),
      out: { x: 0, y: s.faceOnTop ? 0 : screenH, w: OUT_W, h: faceH },
    },
  }
}
