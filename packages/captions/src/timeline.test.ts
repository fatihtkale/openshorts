import { describe, expect, it } from 'vitest'
import { centreAt, fillRect, fitRect, isVertical, panelRect, windowRect } from './layout'
import { defaultEdit, presetById } from './presets'
import {
  effectiveCuts,
  keptSegments,
  mergeRanges,
  nextKept,
  outputDuration,
  outputToSource,
  sourceToOutput,
  wordsToOutput,
  type SourceWord,
} from './timeline'

const words: SourceWord[] = [
  { text: 'So', start: 1000, end: 1200 },
  { text: 'um,', start: 1300, end: 1600 },
  { text: 'this', start: 1700, end: 1900 },
  // a 2.1 s pause
  { text: 'works.', start: 4000, end: 4500 },
]
const clip = { start: 1000, end: 5000 }
const trim = { cuts: [], removePauses: false, pauseMs: 700, removeFillers: false }

describe('ranges and segments', () => {
  it('merges overlapping ranges', () => {
    expect(mergeRanges([{ start: 5, end: 9 }, { start: 0, end: 3 }, { start: 2, end: 6 }, { start: 7, end: 7 }])).toEqual([{ start: 0, end: 9 }])
  })

  it('keeps what is not cut', () => {
    const segs = keptSegments(clip, [{ start: 2000, end: 3000 }, { start: 4800, end: 6000 }])
    expect(segs).toEqual([
      { start: 1000, end: 2000 },
      { start: 3000, end: 4800 },
    ])
    expect(outputDuration(segs)).toBe(2800)
  })

  it('maps times between source and output', () => {
    const segs = keptSegments(clip, [{ start: 2000, end: 3000 }])
    expect(sourceToOutput(segs, 1500)).toBe(500)
    expect(sourceToOutput(segs, 2500)).toBeNull()
    expect(sourceToOutput(segs, 3500)).toBe(1500)
    expect(outputToSource(segs, 1500)).toBe(3500)
    expect(outputToSource(segs, 99_999)).toBe(5000)
    expect(nextKept(segs, 2500)).toBe(3000)
    expect(nextKept(segs, 6000)).toBeNull()
  })
})

describe('effectiveCuts', () => {
  it('shortens long pauses, keeping some air', () => {
    expect(effectiveCuts(words, clip, { ...trim, removePauses: true })).toEqual([{ start: 2050, end: 3850 }])
  })

  it('removes filler words', () => {
    expect(effectiveCuts(words, clip, { ...trim, removeFillers: true })).toEqual([{ start: 1300, end: 1700 }])
  })

  it('keeps hand-made cuts inside the clip', () => {
    expect(effectiveCuts(words, clip, { ...trim, cuts: [{ start: 0, end: 1250 }] })).toEqual([{ start: 1000, end: 1250 }])
  })
})

describe('wordsToOutput', () => {
  it('moves words onto the output timeline and drops cut ones', () => {
    const segs = keptSegments(clip, effectiveCuts(words, clip, { ...trim, removeFillers: true, removePauses: true }))
    const out = wordsToOutput(words, segs, { keywords: ['Works'], emojis: { works: '✅' } })
    expect(out.map((w) => w.text)).toEqual(['So', 'this', 'works.'])
    expect(out[1]).toMatchObject({ start: 300, end: 500 })
    expect(out[2]).toMatchObject({ keyword: true, emoji: '✅' })
    // After the 400 ms filler cut and the 1800 ms pause cut, "works." starts 2200 ms earlier.
    expect(out[2]!.start).toBe(4000 - 1000 - 400 - 1800)
  })
})

describe('layout', () => {
  it('fits a 9:16 window in a landscape frame and keeps it inside', () => {
    expect(windowRect(1920, 1080, 9 / 16, 0.5, 0.5)).toEqual({ x: 656.25, y: 0, w: 607.5, h: 1080 })
    expect(windowRect(1920, 1080, 9 / 16, 0, 0.5).x).toBe(0)
    expect(windowRect(1920, 1080, 9 / 16, 1, 0.5).x).toBe(1920 - 607.5)
    expect(windowRect(1920, 1080, 9 / 16, 0.5, 0.5, 2)).toMatchObject({ w: 303.75, h: 540, y: 270 })
  })

  it('eases between keyframes', () => {
    const kf = [{ t: 0, x: 0, y: 0.5 }, { t: 1000, x: 1, y: 0.5 }]
    expect(centreAt(kf, -50).x).toBe(0)
    expect(centreAt(kf, 500).x).toBeCloseTo(0.5)
    expect(centreAt(kf, 250).x).toBeLessThan(0.25)
    expect(centreAt(kf, 5000).x).toBe(1)
  })

  it('computes fill, split and fit rectangles', () => {
    const edit = defaultEdit()
    expect(fillRect(edit.layout, 1920, 1080, 0).w).toBe(607.5)
    expect(panelRect({ x: 0.5, y: 0.5, zoom: 1 }, 1920, 1080)).toMatchObject({ w: 1215, h: 1080 })
    expect(fitRect(1920, 1080)).toEqual({ x: 0, y: 656.25, w: 1080, h: 607.5 })
    expect(isVertical(1080, 1920)).toBe(true)
    expect(isVertical(1920, 1080)).toBe(false)
  })
})

describe('defaultEdit', () => {
  it('turns the hook on only when there is text', () => {
    expect(defaultEdit({ hook: 'Big news' }).hook).toMatchObject({ enabled: true, text: 'Big news' })
    expect(defaultEdit().hook.enabled).toBe(false)
    expect(defaultEdit({ presetId: 'nope' }).captions.preset).toBe('karaoke')
    expect(presetById('classic').style.animation).toBe('classic')
  })
})
