import { describe, expect, it } from 'vitest'
import { autoFrame, faceCoverage, resolveLayout, type FaceBox, type FaceTrack } from './faces'
import { centreAt } from './layout'
import { defaultEdit } from './presets'

const face = (cx: number, size = 0.1, score = 0.95): FaceBox => ({ x: cx - size / 2, y: 0.3, w: size, h: size * 1.6, score })

/** 10 s at 5 samples/s; the speaker walks from x=0.3 to x=0.7, then a cut to someone at x=0.2. */
function walkingTrack(): FaceTrack {
  const frames: FaceBox[][] = []
  for (let i = 0; i < 50; i++) {
    if (i < 30) frames.push([face(0.3 + (0.4 * i) / 29)])
    else frames.push([face(0.2)])
  }
  return { version: 1, sampleMs: 200, frames, cuts: [6000] }
}

describe('autoFrame', () => {
  it('follows a moving face smoothly and jumps at a scene cut', () => {
    const kf = autoFrame(walkingTrack(), { start: 0, end: 10_000 })
    expect(kf[0]).toMatchObject({ t: 0 })
    expect(kf[0]!.x).toBeCloseTo(0.3, 1)
    // Before the cut the window has travelled most of the way to 0.7.
    expect(centreAt(kf, 5800).x).toBeGreaterThan(0.55)
    // Right after the cut it's on the new face, without sliding through the middle.
    expect(centreAt(kf, 6000).x).toBeCloseTo(0.2, 1)
    expect(centreAt(kf, 5999).x).toBeGreaterThan(0.55)
    expect(kf.every((k) => k.ease === 'linear' || k.ease === undefined)).toBe(true)
  })

  it('ignores small jitter inside the dead zone', () => {
    const frames = Array.from({ length: 25 }, (_, i) => [face(0.5 + (i % 2 ? 0.01 : -0.01))])
    const kf = autoFrame({ version: 1, sampleMs: 200, frames, cuts: [] }, { start: 0, end: 5000 })
    expect(new Set(kf.map((k) => k.x)).size).toBe(1)
  })

  it('stays on the current speaker unless someone is much bigger', () => {
    const frames = Array.from({ length: 20 }, () => [face(0.25, 0.1), face(0.75, 0.12)])
    const kf = autoFrame({ version: 1, sampleMs: 200, frames, cuts: [] }, { start: 0, end: 4000 })
    // Picks the bigger one first and keeps it.
    expect(centreAt(kf, 3000).x).toBeCloseTo(0.75, 1)
  })

  it('holds through gaps and falls back to the centre with no faces at all', () => {
    const frames: FaceBox[][] = [[face(0.7)], [], [], [face(0.7)]]
    expect(centreAt(autoFrame({ version: 1, sampleMs: 200, frames, cuts: [] }, { start: 0, end: 800 }), 400).x).toBeCloseTo(0.7, 1)
    const empty = autoFrame({ version: 1, sampleMs: 200, frames: [[], [], []], cuts: [] }, { start: 0, end: 600 })
    expect(empty[0]).toMatchObject({ t: 0, x: 0.5 })
  })

  it('works for a clip in the middle of the video', () => {
    const kf = autoFrame(walkingTrack(), { start: 7000, end: 9000 })
    expect(kf[0]!.t).toBe(0)
    expect(kf[0]!.x).toBeCloseTo(0.2, 1)
  })
})

describe('faceCoverage and resolveLayout', () => {
  it('measures how much of a clip has a face', () => {
    const track: FaceTrack = { version: 1, sampleMs: 200, frames: [[face(0.5)], [], [face(0.5, 0.1, 0.3)], [face(0.5)]], cuts: [] }
    expect(faceCoverage(track, { start: 0, end: 600 })).toBe(0.5)
  })

  it('only replaces keyframes in fill mode with following on', () => {
    const layout = defaultEdit().layout
    const track = walkingTrack()
    expect(resolveLayout(layout, track, { start: 0, end: 10_000 }).keyframes.length).toBeGreaterThan(2)
    expect(resolveLayout({ ...layout, auto: false }, track, { start: 0, end: 10_000 })).toEqual({ ...layout, auto: false })
    expect(resolveLayout({ ...layout, mode: 'fit' }, track, { start: 0, end: 10_000 }).keyframes).toEqual(layout.keyframes)
    expect(resolveLayout(layout, null, { start: 0, end: 10_000 })).toBe(layout)
  })
})
