// Safe to import from the browser: no Node or database dependencies.
import type { ClipDto, RenderDto } from './clips'
import type { YoutubeMeta } from './projects'

/** Where a streamer streams, for the credit banner. */
export const CREDIT_PLATFORMS = ['twitch', 'youtube', 'kick', 'tiktok', 'other'] as const
export type CreditPlatform = (typeof CREDIT_PLATFORMS)[number]

export const CREDIT_PLATFORM_LABELS: Record<CreditPlatform, string> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  kick: 'Kick',
  tiktok: 'TikTok',
  other: 'Other',
}

/** Who to shout out for a clip: the name shown big, and the handle (login) that makes the link. */
export interface Credit {
  platform: CreditPlatform
  name: string
  handle: string
}

export interface CompilationItem {
  clipId: string
  credit: Credit
}

/** Where each clip starts in the finished video (for YouTube chapters). */
export interface CompilationChapter {
  atMs: number
  title: string
  credit: Credit
}

export const COMPILATION_STATUSES = ['draft', 'queued', 'running', 'done', 'failed'] as const
export type CompilationStatus = (typeof COMPILATION_STATUSES)[number]

/** Limits: enough for a long video, small enough to export in one go on a laptop. */
export const COMPILATION_MAX_ITEMS = 60
/** How long the credit banner stays up at the start of each clip. */
export const CREDIT_BANNER_MS = 4_000

export interface CompilationDto {
  id: string
  title: string
  items: CompilationItem[]
  status: CompilationStatus
  error: string | null
  /** Goes up on every saved change; the export records the version it shows. */
  version: number
  renderedVersion: number | null
  durationMs: number | null
  chapters: CompilationChapter[]
  /** The project that holds the finished video (made on the first export). */
  projectId: string | null
  /** Its "Full video" clip and newest export: what gets posted. */
  clip: ClipDto | null
  render: RenderDto | null
  createdAt: number
  updatedAt: number
}

/** A clip as the compilation page shows it, with where it comes from. */
export interface CompilationClipInfo {
  clipId: string
  title: string
  projectId: string
  projectName: string
  startMs: number
  endMs: number
  /** 0–10: the evaluation's total, or the proposal's score; null when it was never scored. */
  score: number | null
  /** Gone (deleted, rejected) since it was added. */
  missing: boolean
}

export interface CompilationDetail extends CompilationDto {
  clips: Record<string, CompilationClipInfo>
}

/** A clip's score on the 0–10 scale shown in the app: its evaluation's total, else its proposal score (0–100) / 10. */
export function clipScore(clip: { evaluation: { total: number } | null; score: number | null }): number | null {
  if (clip.evaluation) return clip.evaluation.total
  return clip.score === null ? null : clip.score / 10
}

/** "twitch.tv/omie", "youtube.com/@name", … The handle on its own when there's no known site. */
export function creditLine(c: Credit): string {
  const h = c.handle.trim().replace(/^@/, '')
  if (!h) return ''
  switch (c.platform) {
    case 'twitch':
      return `twitch.tv/${h}`
    case 'youtube':
      return `youtube.com/@${h}`
    case 'kick':
      return `kick.com/${h}`
    case 'tiktok':
      return `tiktok.com/@${h}`
    default:
      return h
  }
}

/** A full link for the description, when there is one. */
export function creditUrl(c: Credit): string | null {
  const line = creditLine(c)
  return line && c.platform !== 'other' ? `https://${line}` : null
}

/** The credit a project's source suggests: the Twitch channel, or the YouTube channel name. */
export function defaultCredit(sourceType: string, meta: YoutubeMeta | null | undefined): Credit {
  if (sourceType === 'twitch' && meta?.twitch?.channelLogin) {
    return { platform: 'twitch', name: meta.channel || meta.twitch.channelLogin, handle: meta.twitch.channelLogin }
  }
  if (sourceType === 'youtube' && meta?.channel) return { platform: 'youtube', name: meta.channel, handle: '' }
  return { platform: 'other', name: meta?.channel ?? '', handle: '' }
}

/** 75_000 → "1:15", 3_725_000 → "1:02:05" (YouTube's chapter format). */
export function chapterTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/**
 * YouTube shows chapters when the first starts at 0:00, there are at least three, and each lasts at least 10 s.
 * Returns whether these chapters qualify.
 */
export function chaptersValid(chapters: CompilationChapter[], totalMs: number): boolean {
  if (chapters.length < 3 || chapters[0]!.atMs !== 0) return false
  return chapters.every((c, i) => (chapters[i + 1]?.atMs ?? totalMs) - c.atMs >= 10_000)
}

/**
 * Chapters YouTube will accept: a clip shorter than 10 s is folded into the chapter before it (or, at the very start,
 * the next clip is folded into the first), so one short clip doesn't switch chapters off for the whole video.
 */
export function youtubeChapters(chapters: CompilationChapter[], totalMs: number): CompilationChapter[] {
  if (!chapters.length) return []
  const kept: CompilationChapter[] = [{ ...chapters[0]!, atMs: 0 }]
  for (let i = 1; i < chapters.length; i++) {
    const c = chapters[i]!
    const end = chapters[i + 1]?.atMs ?? totalMs
    if (c.atMs - kept.at(-1)!.atMs < 10_000 || end - c.atMs < 10_000) continue
    kept.push(c)
  }
  while (kept.length > 1 && totalMs - kept.at(-1)!.atMs < 10_000) kept.pop()
  return kept
}

/**
 * Suggested post text for a finished compilation: chapters (one per clip, with who it is) and a list of every
 * streamer featured with a link, so each gets a shoutout in the description too.
 */
export function suggestCompilationText(title: string, chapters: CompilationChapter[], totalMs: number): { title: string; description: string; tags: string[] } {
  const lines: string[] = []
  const usable = youtubeChapters(chapters, totalMs)
  if (chaptersValid(usable, totalMs)) {
    for (const c of usable) {
      const who = c.credit.name.trim()
      lines.push(`${chapterTime(c.atMs)} ${c.title}${who ? ` (${who})` : ''}`)
    }
  }
  const seen = new Set<string>()
  const featured: string[] = []
  for (const c of chapters) {
    const key = `${c.credit.platform}:${(c.credit.handle || c.credit.name).toLowerCase()}`
    if (seen.has(key) || !(c.credit.name || c.credit.handle)) continue
    seen.add(key)
    const url = creditUrl(c.credit)
    featured.push(`• ${c.credit.name || c.credit.handle}${url ? ` ${url}` : ''}`)
  }
  const parts = [lines.join('\n'), featured.length ? `Streamers featured (go show them some love):\n${featured.join('\n')}` : '']
  return { title: title.trim(), description: parts.filter(Boolean).join('\n\n'), tags: [] }
}
