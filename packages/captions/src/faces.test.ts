import { describe, expect, it } from 'vitest'
import { autoFrame, facecamWindow, faceCoverage, resolveLayout, type FaceBox, type FaceTrack } from './faces'
import { centreAt, screenPanels, screenShare, windowRect } from './layout'
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

describe('screen layout', () => {
  it('keeps a 16:9 screen at full width and gives the face the rest', () => {
    const layout = { ...defaultEdit().layout, mode: 'screen' as const }
    const p = screenPanels(layout, 1920, 1080)
    expect(p.screen.out).toEqual({ x: 0, y: 0, w: 1080, h: 608 })
    expect(p.face.out).toEqual({ x: 0, y: 608, w: 1080, h: 1312 })
    // At zoom 1 the screen part is (almost exactly) the whole frame.
    expect(p.screen.src.w).toBeCloseTo(1920, -1)
    // Swapped: face on top.
    const swapped = screenPanels({ ...layout, screen: { screen: { x: 0.5, y: 0.5, zoom: 1 }, face: { x: 0.5, y: 0.5, zoom: 1 }, faceOnTop: true } }, 1920, 1080)
    expect(swapped.face.out.y).toBe(0)
    expect(swapped.screen.out.y).toBe(1312)
    // A 4:3 screen is capped so the face keeps at least 40% of the height.
    expect(screenPanels(layout, 1440, 1080).screen.out.h).toBe(810)
    expect(screenPanels(layout, 1080, 1920).screen.out.h).toBe(1152)
  })

  it('lets the screen take a chosen share of the height', () => {
    const base = { ...defaultEdit().layout, mode: 'screen' as const }
    const pick = (share: number) => ({ ...base, screen: { screen: { x: 0.5, y: 0.5, zoom: 1 }, face: { x: 0.5, y: 0.5, zoom: 1 }, faceOnTop: false, screenShare: share } })
    expect(screenShare(base, 1920, 1080)).toBeCloseTo(608 / 1920, 2)
    const half = screenPanels(pick(0.5), 1920, 1080)
    expect(half.screen.out.h).toBe(960)
    expect(half.face.out).toEqual({ x: 0, y: 960, w: 1080, h: 960 })
    // Taller than 16:9 at full width: the screen part crops the source's sides instead of stretching.
    expect(half.screen.src.h).toBeCloseTo(1080, -1)
    expect(half.screen.src.w / half.screen.src.h).toBeCloseTo(1080 / 960, 2)
    // Out-of-range values are held to the limits.
    expect(screenPanels(pick(0.05), 1920, 1080).screen.out.h).toBe(384)
    expect(screenPanels(pick(0.95), 1920, 1080).screen.out.h).toBe(1536)
  })

  it('finds the facecam in a corner and zooms in on it', () => {
    // A small face in the bottom-right corner, steady through the clip.
    const cam = (): FaceBox => ({ x: 0.84, y: 0.74, w: 0.06, h: 0.1, score: 0.9 })
    const track: FaceTrack = { version: 1, sampleMs: 200, frames: Array.from({ length: 50 }, () => [cam()]), cuts: [] }
    const aspect = 1080 / 1312
    const w = facecamWindow(track, { start: 0, end: 10_000 }, aspect, 1920, 1080)!
    expect(w.x).toBeCloseTo(0.87)
    expect(w.y).toBeCloseTo(0.79)
    // The face (108 px tall) fills about 40% of the window.
    const r = windowRect(1920, 1080, aspect, w.x, w.y, w.zoom)
    expect(108 / r.h).toBeGreaterThan(0.35)
    expect(108 / r.h).toBeLessThan(0.45)
    expect(facecamWindow({ ...track, frames: [] }, { start: 0, end: 10_000 }, aspect, 1920, 1080)).toBeNull()
  })
})
