import { describe, expect, it } from 'vitest'
import { findHotSpots, groupMoments, heatStrip, HOTSPOT_LEAD_IN_SEC, type HighlightsData } from './highlights'

/** Ten minutes of steady -30 dB with loud bursts at the given seconds (+18 dB for 4 s). */
function loudness(bursts: number[]): number[] {
  return Array.from({ length: 600 }, (_, t) => (bursts.some((b) => t >= b && t < b + 4) ? -12 : -30))
}
const base = (over: Partial<HighlightsData> = {}): HighlightsData => ({
  version: 1,
  loudness: loudness([]),
  viewerClips: [],
  viewerClipsStatus: 'not-twitch',
  computedAt: 0,
  ...over,
})

describe('hot spots', () => {
  it('finds loud bursts and starts each one a few seconds early', () => {
    const spots = findHotSpots(base({ loudness: loudness([120, 400]) }), 600)
    expect(spots.map((s) => s.peakSec >= 118 && s.peakSec <= 125 ? 'a' : s.peakSec >= 398 && s.peakSec <= 405 ? 'b' : '?').sort()).toEqual(['a', 'b'])
    const a = spots.find((s) => s.peakSec < 200)!
    expect(a.startSec).toBeLessThanOrEqual(120 - HOTSPOT_LEAD_IN_SEC + 2)
    expect(a.reasons[0]).toMatch(/dB louder/)
  })

  it('ranks what viewers clipped (weighted by views) above loudness', () => {
    const spots = findHotSpots(
      base({
        loudness: loudness([120]),
        viewerClips: [
          { title: 'insane', url: 'u', views: 5000, startSec: 300, durationSec: 30 },
          { title: 'lol', url: 'u', views: 40, startSec: 302, durationSec: 25 },
        ],
        viewerClipsStatus: 'ok',
      }),
      600,
    )
    expect(spots[0]!.peakSec).toBeGreaterThanOrEqual(300)
    expect(spots[0]!.peakSec).toBeLessThan(332)
    expect(spots[0]).toMatchObject({ viewerClips: 2, views: 5040 })
    expect(spots[0]!.reasons[0]).toBe('2 viewer clips (5,040 views)')
  })

  it('finds nothing in a video that is equally loud throughout', () => {
    expect(findHotSpots(base(), 600)).toEqual([])
    expect(heatStrip(base(), 600, 60).every((v) => v === 0)).toBe(true)
  })
})

describe('Smart import moments', () => {
  it('groups nearby viewer clips, pads them with context and puts the most viewed first', () => {
    const c = (offset: number | null, views: number, title: string) => ({ vodOffsetSec: offset, durationSec: 30, viewCount: views, title })
    const moments = groupMoments([c(1000, 50, 'small'), c(1040, 400, 'big one'), c(5000, 900, 'solo'), c(null, 99_999, 'lost')], 7200)
    expect(moments).toEqual([
      { startSec: 4940, endSec: 5060, clips: 1, views: 900, title: 'solo' },
      // 1000 and 1040 overlap within 30 s: one moment, a minute before the first, 30 s after the last.
      { startSec: 940, endSec: 1100, clips: 2, views: 450, title: 'big one' },
    ])
  })
})
