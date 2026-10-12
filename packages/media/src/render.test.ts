import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CAPTION_PRESETS, defaultEdit, drawCaptions, OUT_H, OUT_W, pageAt, paginate, type CaptionWord } from '@clipstudio/captions'
import { createCanvas } from '@napi-rs/canvas'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ffmpeg } from './ffmpeg'
import { probe } from './ffprobe'
import { cropCommands, registerCaptionFonts, renderClip, selectExpression } from './render'
import { findExecutable } from './tools'

const words: CaptionWord[] = 'This is a fairly long sentence for testing. And here is another one'
  .split(' ')
  .map((text, i) => ({ text, start: i * 300, end: i * 300 + 250 }))

describe('caption layout (Node canvas)', () => {
  registerCaptionFonts()
  const ctx = createCanvas(OUT_W, OUT_H).getContext('2d') as unknown as CanvasRenderingContext2D

  it('breaks pages at sentence ends and respects line limits', () => {
    const style = CAPTION_PRESETS.find((p) => p.id === 'karaoke')!.style
    const pages = paginate(ctx, words, style)
    for (const page of pages) {
      expect(page.lines.length).toBeLessThanOrEqual(style.maxLines)
      for (const line of page.lines) expect(line.length).toBeLessThanOrEqual(style.maxWordsPerLine)
    }
    // "testing." ends a sentence, so "And" starts a new page.
    expect(pages.some((p) => p.words[0]!.text === 'And')).toBe(true)
    expect(pageAt(pages, 0)?.words[0]!.text).toBe('This')
    expect(pageAt(pages, 99_999)).toBeNull()
  })

  it('shows one word per page in the one-word preset', () => {
    const style = CAPTION_PRESETS.find((p) => p.id === 'one-word')!.style
    expect(paginate(ctx, words, style)).toHaveLength(words.length)
  })

  it('draws every preset without throwing', () => {
    for (const preset of CAPTION_PRESETS) {
      const pages = paginate(ctx, words, preset.style)
      for (const t of [0, 140, 700, 2000]) drawCaptions(ctx, pages, preset.style, t)
    }
  })
})

describe('ffmpeg graph pieces', () => {
  it('selects kept segments relative to the first', () => {
    expect(selectExpression([{ start: 1000, end: 2000 }])).toBeNull()
    expect(selectExpression([{ start: 1000, end: 2000 }, { start: 3000, end: 3500 }])).toBe('between(t,0.000,1.000)+between(t,2.000,2.500)')
  })

  it('writes crop commands only when the window moves', () => {
    const layout = { ...defaultEdit().layout, keyframes: [{ t: 0, x: 0, y: 0.5 }, { t: 1000, x: 1, y: 0.5 }] }
    const lines = cropCommands(layout, 1920, 1080, [{ start: 0, end: 2000 }], 0, 60).split('\n')
    expect(lines[0]).toBe('0.0000 crop@c x 0, crop@c y 0;')
    expect(lines.at(-1)).toMatch(/crop@c x 1313, crop@c y 0;$/)
    // After the last keyframe (1 s = frame 30) nothing moves.
    expect(lines.length).toBeLessThanOrEqual(31)
  })
})

const hasFfmpeg = !!(await findExecutable('ffmpeg'))

describe.skipIf(!hasFfmpeg)('renderClip (real ffmpeg)', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'clipstudio-render-'))
    await ffmpeg([
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(dir, 'src.mp4'),
    ])
  }, 60_000)

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  for (const mode of ['fill', 'fit', 'split'] as const) {
    it(`exports a vertical ${mode} clip with a cut, captions and a hook`, async () => {
      const edit = defaultEdit({ hook: 'Watch this' })
      edit.layout.mode = mode
      const out = join(dir, `${mode}.mp4`)
      const result = await renderClip({
        src: join(dir, 'src.mp4'),
        source: { width: 1280, height: 720, hasAudio: true },
        segments: [{ start: 500, end: 1500 }, { start: 2500, end: 3500 }],
        clipStartMs: 500,
        layout: edit.layout,
        captions: { style: edit.captions.style, words: words.slice(0, 6) },
        hook: edit.hook,
        out,
        workDir: dir,
      })
      expect(result.durationMs).toBe(2000)
      expect(result.frames).toBe(60)
      const info = await probe(out)
      expect(info).toMatchObject({ width: 1080, height: 1920, hasAudio: true })
      expect(info.durationMs).toBeGreaterThan(1900)
      expect(info.durationMs).toBeLessThan(2200)
    }, 60_000)
  }
})
