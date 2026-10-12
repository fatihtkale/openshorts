import { run } from './process'

export interface ProbeResult {
  durationMs: number
  /** Display size, with rotation already applied (phone videos are often stored sideways). */
  width: number
  height: number
  fps: number
  videoCodec: string
  hasAudio: boolean
  audioCodec: string | null
  formatName: string
}

interface RawStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  duration?: string
  disposition?: { attached_pic?: number }
  tags?: { rotate?: string }
  side_data_list?: { rotation?: number }[]
}

interface RawProbe {
  streams?: RawStream[]
  format?: { duration?: string; format_name?: string }
}

function parseRate(rate: string | undefined): number | null {
  if (!rate) return null
  const [num, den] = rate.split('/').map(Number)
  if (!num || !Number.isFinite(num)) return null
  const value = den ? num / den : num
  return Number.isFinite(value) && value > 0 && value < 1000 ? Math.round(value * 1000) / 1000 : null
}

export function parseProbe(raw: RawProbe): ProbeResult {
  const streams = raw.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  if (!video?.width || !video.height) throw new Error('This file has no video track.')
  const audio = streams.find((s) => s.codec_type === 'audio')

  const rotation = Math.abs(
    Number(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0),
  ) % 180
  const sideways = rotation === 90

  const durationSec = Number(raw.format?.duration ?? video.duration)
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error('Could not read the length of this video.')

  return {
    durationMs: Math.round(durationSec * 1000),
    width: sideways ? video.height : video.width,
    height: sideways ? video.width : video.height,
    fps: parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate) ?? 30,
    videoCodec: video.codec_name ?? 'unknown',
    hasAudio: !!audio,
    audioCodec: audio?.codec_name ?? null,
    formatName: raw.format?.format_name ?? 'unknown',
  }
}

export async function probe(path: string, signal?: AbortSignal): Promise<ProbeResult> {
  const { stdout } = await run(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    { signal },
  )
  return parseProbe(JSON.parse(stdout) as RawProbe)
}
