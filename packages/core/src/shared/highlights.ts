// Safe to import from the browser: no Node or database dependencies.

/** A viewer-made Twitch clip, placed on the project's own timeline (seconds from the project's start). */
export interface HighlightClip {
  title: string
  url: string
  views: number
  startSec: number
  durationSec: number
}

/** What the highlights job stores per project (highlights.json). */
export interface HighlightsData {
  version: 1
  /** Loudness per second (dBFS), from the project's audio. */
  loudness: number[]
  /** Viewer clips that fall inside this project; empty when unknown. */
  viewerClips: HighlightClip[]
  /** Why viewer clips are (or aren't) there, so the page can say what to do. */
  viewerClipsStatus: 'ok' | 'none' | 'no-keys' | 'not-twitch' | 'error'
  viewerClipsError?: string
  computedAt: number
}

export interface HotSpot {
  /** Where a clip should start: 3 s before the moment, so viewers see it coming. */
  startSec: number
  endSec: number
  /** The loudest / most-clipped second. */
  peakSec: number
  /** 0–1, relative to the best moment of this video. */
  score: number
  viewerClips: number
  views: number
  /** How much louder than the minutes around it, in dB (null when it isn't a loud moment). */
  loudLiftDb: number | null
  reasons: string[]
}

/** Seconds of build-up kept before each hot spot (the user's standing lead-in rule: 1–3 s). */
export const HOTSPOT_LEAD_IN_SEC = 3
const MIN_GAP_SEC = 45
const MAX_SPOTS = 40

function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[s.length >> 1]!
}

/** Moving average over ±r seconds. */
function smooth(values: number[], r: number): number[] {
  const out = new Array<number>(values.length)
  let sum = 0
  let n = 0
  for (let i = 0; i < Math.min(values.length, r); i++) {
    sum += values[i]!
    n++
  }
  for (let i = 0; i < values.length; i++) {
    if (i + r < values.length) {
      sum += values[i + r]!
      n++
    }
    if (i - r - 1 >= 0) {
      sum -= values[i - r - 1]!
      n--
    }
    out[i] = sum / n
  }
  return out
}

/**
 * How much louder each second is than the couple of minutes around it (dB above the local median).
 * Local, so a loud game or music bed doesn't count as a highlight on its own; only jumps do (shouting, laughter, hype).
 */
export function loudnessLift(loudness: number[]): number[] {
  const short = smooth(loudness, 1)
  const out = new Array<number>(loudness.length).fill(0)
  const step = 10
  // A median every 10 s over ±90 s, held in between: fast enough for 8-hour VODs.
  let base = 0
  for (let i = 0; i < loudness.length; i++) {
    if (i % step === 0) base = median(loudness.slice(Math.max(0, i - 90), i + 90).filter((v) => v > -80))
    out[i] = short[i]! > -80 ? Math.max(0, short[i]! - base) : 0
  }
  return out
}

/**
 * The moments worth clipping, best first: what viewers clipped (weighted by views) and sudden loud moments.
 * Each spot runs from a short build-up before the peak to where the excitement fades, at most about a minute.
 */
export function findHotSpots(data: HighlightsData, durationSec: number): HotSpot[] {
  const n = Math.max(1, Math.ceil(durationSec), data.loudness.length)
  const lift = data.loudness.length ? loudnessLift(data.loudness) : new Array<number>(n).fill(0)
  const loud = lift.map((v) => Math.min(1, v / 12))

  const clipped = new Array<number>(n).fill(0)
  const maxViews = Math.max(1, ...data.viewerClips.map((c) => c.views))
  for (const c of data.viewerClips) {
    const w = 0.3 + 0.7 * (Math.log10(1 + c.views) / Math.log10(1 + maxViews))
    for (let t = Math.max(0, Math.floor(c.startSec)); t < Math.min(n, Math.ceil(c.startSec + c.durationSec)); t++) clipped[t]! += w
  }
  const maxClipped = Math.max(1e-9, ...clipped)
  const hasClips = data.viewerClips.length > 0
  const signal = smooth(
    Array.from({ length: n }, (_, t) => (hasClips ? 0.65 * (clipped[t]! / maxClipped) + 0.35 * (loud[t] ?? 0) : (loud[t] ?? 0))),
    2,
  )

  const order = signal.map((v, t) => [v, t] as const).sort((a, b) => b[0] - a[0])
  const top = order[0]?.[0] ?? 0
  if (top <= 0.05) return []
  const spots: HotSpot[] = []
  for (const [v, peak] of order) {
    if (spots.length >= MAX_SPOTS || v < top * 0.3) break
    if (spots.some((s) => Math.abs(s.peakSec - peak) < MIN_GAP_SEC)) continue
    let a = peak
    let b = peak
    while (a > 0 && peak - a < 40 && signal[a - 1]! > v * 0.35) a--
    while (b < n - 1 && b - peak < 40 && signal[b + 1]! > v * 0.35) b++
    const inside = data.viewerClips.filter((c) => c.startSec < b + 1 && c.startSec + c.durationSec > a)
    const views = inside.reduce((sum, c) => sum + c.views, 0)
    const liftDb = Math.max(...lift.slice(a, b + 1))
    const reasons: string[] = []
    if (inside.length) reasons.push(`${inside.length} viewer clip${inside.length === 1 ? '' : 's'} (${views.toLocaleString('en-US')} views)`)
    if (liftDb >= 6) reasons.push(`${Math.round(liftDb)} dB louder than the minutes around it`)
    if (!reasons.length) continue
    spots.push({
      startSec: Math.max(0, a - HOTSPOT_LEAD_IN_SEC),
      endSec: Math.min(durationSec, b + 2),
      peakSec: peak,
      score: Math.round((v / top) * 100) / 100,
      viewerClips: inside.length,
      views,
      loudLiftDb: liftDb >= 6 ? Math.round(liftDb * 10) / 10 : null,
      reasons,
    })
  }
  return spots
}

/** The excitement curve squeezed into `bins` values (0–1) for drawing a heat strip. */
export function heatStrip(data: HighlightsData, durationSec: number, bins = 240): number[] {
  const n = Math.max(1, Math.ceil(durationSec))
  const lift = data.loudness.length ? loudnessLift(data.loudness) : []
  const per = new Array<number>(n).fill(0)
  for (let t = 0; t < n; t++) per[t] = Math.min(1, (lift[t] ?? 0) / 12) * (data.viewerClips.length ? 0.35 : 1)
  if (data.viewerClips.length) {
    const maxViews = Math.max(1, ...data.viewerClips.map((c) => c.views))
    for (const c of data.viewerClips) {
      const w = 0.65 * (0.3 + 0.7 * (Math.log10(1 + c.views) / Math.log10(1 + maxViews)))
      for (let t = Math.max(0, Math.floor(c.startSec)); t < Math.min(n, Math.ceil(c.startSec + c.durationSec)); t++) per[t] = Math.min(1, per[t]! + w)
    }
  }
  const out: number[] = []
  for (let i = 0; i < bins; i++) {
    const a = Math.floor((i * n) / bins)
    const b = Math.max(a + 1, Math.floor(((i + 1) * n) / bins))
    out.push(Math.max(...per.slice(a, b)))
  }
  return out
}

/** A stretch of a VOD worth downloading for Smart import: one or more viewer clips close together, with context. */
export interface VodMoment {
  /** Where to start downloading (VOD seconds): a minute before the first clip, for build-up and context. */
  startSec: number
  endSec: number
  clips: number
  views: number
  /** The most-viewed clip's title, to name the project. */
  title: string
}

/** Context kept around viewer clips in Smart import (seconds). */
export const MOMENT_BEFORE_SEC = 60
export const MOMENT_AFTER_SEC = 30

/**
 * Groups viewer clips into downloadable moments: clips that overlap or sit within 30 s of each other become one
 * moment, padded with context. Most viewed first.
 */
export function groupMoments(
  clips: { vodOffsetSec: number | null; durationSec: number; viewCount: number; title: string }[],
  vodDurationSec: number,
): VodMoment[] {
  const placed = clips
    .filter((c): c is typeof c & { vodOffsetSec: number } => c.vodOffsetSec !== null)
    .sort((a, b) => a.vodOffsetSec - b.vodOffsetSec)
  const groups: (typeof placed)[] = []
  for (const c of placed) {
    const last = groups.at(-1)
    const lastEnd = last ? Math.max(...last.map((x) => x.vodOffsetSec + x.durationSec)) : -Infinity
    if (last && c.vodOffsetSec <= lastEnd + 30) last.push(c)
    else groups.push([c])
  }
  return groups
    .map((g) => {
      const top = g.reduce((a, b) => (b.viewCount > a.viewCount ? b : a))
      const start = Math.min(...g.map((c) => c.vodOffsetSec))
      const end = Math.max(...g.map((c) => c.vodOffsetSec + c.durationSec))
      return {
        startSec: Math.max(0, Math.floor(start - MOMENT_BEFORE_SEC)),
        endSec: Math.min(vodDurationSec || Infinity, Math.ceil(end + MOMENT_AFTER_SEC)),
        clips: g.length,
        views: g.reduce((sum, c) => sum + c.viewCount, 0),
        title: top.title,
      }
    })
    .sort((a, b) => b.views - a.views)
}
