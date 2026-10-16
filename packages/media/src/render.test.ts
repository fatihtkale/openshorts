import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CAPTION_PRESETS, defaultEdit, drawCaptions, drawCredit, OUT_H, OUT_W, pageAt, paginate, type CaptionWord } from '@clipstudio/captions'
import { createCanvas } from '@napi-rs/canvas'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { joinParts, loudnessGain, measureLoudness, parseIntegratedLoudness, renderCompilationPart } from './compilation'
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

  for (const mode of ['fill', 'fit', 'split', 'screen'] as const) {
    it(`exports a vertical ${mode} clip with a cut, captions and a hook`, async () => {
      const edit = defaultEdit({ hook: 'Watch this' })
      edit.layout.mode = mode
      if (mode === 'screen') edit.layout.screen = { screen: { x: 0.5, y: 0.5, zoom: 1 }, face: { x: 0.9, y: 0.85, zoom: 4 }, faceOnTop: true }
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

describe.skipIf(!hasFfmpeg)('compilation parts (real ffmpeg)', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'clipstudio-compilation-'))
    await ffmpeg([
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
      '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(dir, 'wide.mp4'),
    ])
    // A silent 4:3 source: gets black bars and a silent track, so it still joins with the others.
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=25', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'square.mp4')])
  }, 60_000)

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('renders landscape parts with a credit banner and joins them', async () => {
    const base = { width: 1920, height: 1080, encoder: 'libx264' as const }
    const lufs = await measureLoudness(join(dir, 'wide.mp4'), [{ start: 500, end: 3500 }])
    expect(lufs).toBeGreaterThan(-30)
    expect(lufs).toBeLessThan(0)
    expect(await measureLoudness(join(dir, 'square.mp4'), [{ start: 0, end: 2000 }])).toBeNull()
    const a = join(dir, 'a.mp4')
    const b = join(dir, 'b.mp4')
    await renderCompilationPart({
      ...base,
      src: join(dir, 'wide.mp4'),
      source: { width: 1280, height: 720, hasAudio: true },
      segments: [{ start: 500, end: 1500 }, { start: 2000, end: 3500 }],
      gainDb: loudnessGain(lufs),
      banner: { credit: { platform: 'twitch', name: 'omie', line: 'twitch.tv/omie' }, durationMs: 1500 },
      out: a,
    })
    await renderCompilationPart({ ...base, src: join(dir, 'square.mp4'), source: { width: 640, height: 480, hasAudio: false }, segments: [{ start: 0, end: 2000 }], gainDb: 0, banner: null, out: b })
    const out = join(dir, 'all.mp4')
    await joinParts([a, b], out, dir)
    const info = await probe(out)
    expect(info).toMatchObject({ width: 1920, height: 1080, hasAudio: true })
    expect(info.durationMs).toBeGreaterThan(4300)
    expect(info.durationMs).toBeLessThan(4800)
  }, 120_000)

  it('reads loudness and caps the gain', () => {
    expect(parseIntegratedLoudness('  Integrated loudness:\n    I:         -23.4 LUFS\n')).toBe(-23.4)
    expect(parseIntegratedLoudness('I: -70.0 LUFS')).toBeNull()
    expect(parseIntegratedLoudness('nothing')).toBeNull()
    expect(loudnessGain(-23.4)).toBeCloseTo(7.4)
    expect(loudnessGain(-60)).toBe(15)
    expect(loudnessGain(null)).toBe(0)
  })

  it('draws every platform banner without throwing', () => {
    registerCaptionFonts()
    const ctx = createCanvas(1920, 1080).getContext('2d') as unknown as CanvasRenderingContext2D
    for (const platform of ['twitch', 'youtube', 'kick', 'tiktok', 'other']) {
      for (const t of [0, 200, 2000, 3900]) drawCredit(ctx, { platform, name: 'Streamer', line: 'site/streamer' }, t, 4000, 1920, 1080)
    }
  })
})
