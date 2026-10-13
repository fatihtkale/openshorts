// Safe to import from the browser: no Node or database dependencies.
import type { TranscriptSummary } from './transcripts'

export const PROJECT_STATUSES = ['importing', 'processing', 'ready', 'failed'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const SOURCE_TYPES = ['youtube', 'upload', 'twitch'] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export const ASSET_KINDS = ['source', 'proxy', 'audio', 'thumbnail', 'faces', 'highlights'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const DOWNLOAD_QUALITIES = ['1080', '720', 'best'] as const
export type DownloadQuality = (typeof DOWNLOAD_QUALITIES)[number]

export const UPLOAD_EXTENSIONS = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi'] as const

export type LinkPlatform = 'youtube' | 'twitch'

/** Twitch-only details: a VOD (a past broadcast) or a clip (a short moment someone clipped). */
export interface TwitchDetails {
  kind: 'vod' | 'clip'
  /** The channel's login name (twitch.tv/<login>). */
  channelLogin: string | null
  viewCount: number | null
}

/** What we keep from yt-dlp's metadata (YouTube videos and Twitch VODs and clips). */
export interface YoutubeMeta {
  /** YouTube video id, Twitch VOD id ("v123…") or Twitch clip slug. */
  videoId: string
  title: string
  channel: string | null
  durationSec: number | null
  uploadDate: string | null
  thumbnailUrl: string
  license: string | null
  isLive: boolean
  maxHeight: number | null
  /** Missing on projects imported before Twitch support: YouTube. */
  platform?: LinkPlatform
  twitch?: TwitchDetails
  /** Twitch clips: score the clip with in-app AI once its transcript is ready (chosen, with its cost, at import). */
  autoEvaluate?: boolean
  /** The part of the source that was downloaded (seconds), when only a part was; maps VOD times onto the project. */
  importRange?: TimeRange
}
export type VideoMeta = YoutubeMeta

export interface YoutubePreview {
  input: string
  platform?: LinkPlatform
  url: string | null
  meta: YoutubeMeta | null
  error: string | null
  /** Projects (not in Trash) that already hold this video. */
  existing: { id: string; name: string }[]
}

export interface TimeRange {
  start: number
  end: number
}

export interface ProjectDto {
  id: string
  name: string
  sourceType: SourceType
  sourceUrl: string | null
  sourceMeta: YoutubeMeta | null
  status: ProjectStatus
  error: string | null
  durationMs: number | null
  width: number | null
  height: number | null
  fps: number | null
  hasAudio: boolean | null
  /** Bytes on disk across all of the project's files. */
  storageBytes: number
  assets: Partial<Record<AssetKind, { bytes: number; updatedAt: number }>>
  transcript: TranscriptSummary | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
])
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/** Accepts the common YouTube URL shapes and returns the video id and a canonical URL, or null. */
export function parseYoutubeUrl(input: string): { videoId: string; url: string } | null {
  let parsed: URL
  try {
    parsed = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (!YOUTUBE_HOSTS.has(host)) return null

  let id: string | null = null
  if (host === 'youtu.be') {
    id = parsed.pathname.split('/')[1] ?? null
  } else if (parsed.pathname === '/watch') {
    id = parsed.searchParams.get('v')
  } else {
    const match = /^\/(?:shorts|live|embed|v)\/([^/?#]+)/.exec(parsed.pathname)
    id = match?.[1] ?? null
  }
  if (!id || !VIDEO_ID.test(id)) return null
  return { videoId: id, url: `https://www.youtube.com/watch?v=${id}` }
}

const TWITCH_HOSTS = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'clips.twitch.tv'])
const CLIP_SLUG = /^[A-Za-z0-9_-]{3,100}$/

/**
 * Twitch VODs (twitch.tv/videos/123) and clips (twitch.tv/<channel>/clip/<slug>, clips.twitch.tv/<slug>).
 * Returns the id and a canonical URL, or null.
 */
export function parseTwitchUrl(input: string): { kind: 'vod' | 'clip'; id: string; url: string } | null {
  let parsed: URL
  try {
    parsed = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (!TWITCH_HOSTS.has(host)) return null
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (host === 'clips.twitch.tv') {
    const slug = parts[0] === 'embed' ? parsed.searchParams.get('clip') : parts[0]
    return slug && CLIP_SLUG.test(slug) ? { kind: 'clip', id: slug, url: `https://clips.twitch.tv/${slug}` } : null
  }
  if (parts[0] === 'videos' && /^\d+$/.test(parts[1] ?? '')) {
    return { kind: 'vod', id: `v${parts[1]}`, url: `https://www.twitch.tv/videos/${parts[1]}` }
  }
  if (parts[1] === 'clip' && parts[2] && CLIP_SLUG.test(parts[2])) {
    return { kind: 'clip', id: parts[2], url: `https://clips.twitch.tv/${parts[2]}` }
  }
  return null
}

/** Any link the app can import: YouTube videos, Twitch VODs and Twitch clips. */
export function parseVideoLink(input: string): { platform: LinkPlatform; kind: 'video' | 'vod' | 'clip'; id: string; url: string } | null {
  const yt = parseYoutubeUrl(input)
  if (yt) return { platform: 'youtube', kind: 'video', id: yt.videoId, url: yt.url }
  const tw = parseTwitchUrl(input)
  return tw ? { platform: 'twitch', ...tw } : null
}

/** Splits pasted text into candidate links (one per line, or separated by spaces/commas). */
export function splitLinks(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))]
}

/** Parses "1:02:03", "62:03", "45" or "45.5" into seconds. Returns null for anything else. */
export function parseTimecode(input: string): number | null {
  const trimmed = input.trim()
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(trimmed)) return null
  const parts = trimmed.split(':').map(Number)
  if (parts.slice(1).some((p) => p >= 60)) return null
  return parts.reduce((total, part) => total * 60 + part, 0)
}

/** 3725 → "1:02:05", 65 → "1:05". */
export function formatTimecode(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** A safe-ish project name from a file name: drops the extension and tidies separators. */
export function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim()
  return base.slice(0, 200) || 'Untitled video'
}
