import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ffmpeg } from './ffmpeg'
import { probe } from './ffprobe'
import { makeProxyAndAudio, makeThumbnail } from './prepare'
import { findExecutable } from './tools'

// Runs the real ffmpeg; skipped on machines without it.
const hasFfmpeg = !!(await findExecutable('ffmpeg')) && !!(await findExecutable('ffprobe'))

describe.skipIf(!hasFfmpeg)('prepare pipeline (real ffmpeg)', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'clipstudio-media-'))
    // A 3 s 1080p test pattern with a tone, plus a vertical one without sound.
    await ffmpeg([
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(dir, 'landscape.mp4'),
    ])
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=25', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'vertical.mp4')])
  }, 60_000)

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('probes, makes a cover, a 720p preview and 16 kHz audio', async () => {
    const src = join(dir, 'landscape.mp4')
    const info = await probe(src)
    expect(info).toMatchObject({ width: 1920, height: 1080, fps: 30, hasAudio: true })
    expect(info.durationMs).toBeGreaterThan(2900)

    await makeThumbnail(src, join(dir, 'thumb.jpg'), info)
    expect((await stat(join(dir, 'thumb.jpg'))).size).toBeGreaterThan(1000)

    const fractions: number[] = []
    await makeProxyAndAudio({
      src,
      proxyOut: join(dir, 'proxy.mp4'),
      audioOut: join(dir, 'audio.wav'),
      info,
      onProgress: (f) => fractions.push(f),
    })
    const proxy = await probe(join(dir, 'proxy.mp4'))
    expect(proxy).toMatchObject({ width: 1280, height: 720, hasAudio: true, videoCodec: 'h264' })
    expect(fractions.at(-1)).toBeGreaterThan(0.9)

    const audio = await probe(join(dir, 'audio.wav')).catch((e: Error) => e)
    // A WAV has no video track, so probe() refuses it; the file itself must exist and hold ~3 s of 16 kHz mono.
    expect(audio).toBeInstanceOf(Error)
    const bytes = (await stat(join(dir, 'audio.wav'))).size
    expect(bytes).toBeGreaterThan(3 * 16_000 * 2 * 0.9)
  }, 60_000)

  it('keeps vertical video vertical and skips audio when there is none', async () => {
    const src = join(dir, 'vertical.mp4')
    const info = await probe(src)
    expect(info).toMatchObject({ width: 1080, height: 1920, hasAudio: false })
    await makeProxyAndAudio({ src, proxyOut: join(dir, 'vproxy.mp4'), audioOut: null, info })
    expect(await probe(join(dir, 'vproxy.mp4'))).toMatchObject({ width: 720, height: 1280 })
  }, 60_000)
})
