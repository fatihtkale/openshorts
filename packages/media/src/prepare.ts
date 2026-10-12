import { ffmpeg } from './ffmpeg'
import type { ProbeResult } from './ffprobe'

/** Shorter side capped at `max`, never upscaled, even dimensions. Works for landscape and portrait. */
export function scaleShortSide(max: number): string {
  return `scale=w='if(gte(iw,ih),-2,min(${max},iw))':h='if(gte(iw,ih),min(${max},ih),-2)'`
}

/** Where in the video to grab the cover frame: 20% in, at most 10 s, so it skips black intros. */
export function thumbnailTime(durationMs: number): number {
  return Math.min((durationMs / 1000) * 0.2, 10)
}

export async function makeThumbnail(src: string, out: string, info: ProbeResult, signal?: AbortSignal): Promise<void> {
  await ffmpeg(
    ['-ss', thumbnailTime(info.durationMs).toFixed(2), '-i', src, '-frames:v', '1', '-vf', scaleShortSide(720), '-q:v', '3', out],
    { signal },
  )
}

export interface ProxyOptions {
  src: string
  proxyOut: string
  /** 16 kHz mono WAV for transcription; skipped when the source has no audio. */
  audioOut: string | null
  info: ProbeResult
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

export type VideoEncoder = 'h264_videotoolbox' | 'libx264'

export function proxyArgs(opts: ProxyOptions, encoder: VideoEncoder): string[] {
  // A keyframe every second keeps scrubbing in the editor snappy.
  const gop = String(Math.max(1, Math.round(opts.info.fps)))
  const video =
    encoder === 'h264_videotoolbox'
      ? ['-c:v', 'h264_videotoolbox', '-b:v', '3M', '-allow_sw', '1']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']
  const args = [
    '-i',
    opts.src,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    `${scaleShortSide(720)},format=yuv420p`,
    ...video,
    '-g',
    gop,
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    opts.proxyOut,
  ]
  if (opts.audioOut) {
    args.push('-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', opts.audioOut)
  }
  return args
}

/**
 * One ffmpeg pass that writes the 720p preview and the transcription audio.
 * Uses the Apple hardware encoder, falling back to x264 if it isn't available.
 */
export async function makeProxyAndAudio(opts: ProxyOptions): Promise<VideoEncoder> {
  const run = (encoder: VideoEncoder) =>
    ffmpeg(proxyArgs(opts, encoder), { durationMs: opts.info.durationMs, signal: opts.signal, onProgress: opts.onProgress })
  try {
    await run('h264_videotoolbox')
    return 'h264_videotoolbox'
  } catch (error) {
    if (opts.signal?.aborted) throw error
    await run('libx264')
    return 'libx264'
  }
}
