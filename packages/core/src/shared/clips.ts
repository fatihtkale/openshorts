// Safe to import from the browser: no Node or database dependencies.
import type { DownloadQuality, TimeRange, YoutubeMeta } from './projects'
import type { Word } from './transcripts'

export const CLIP_STATUSES = ['proposed', 'approved', 'rejected'] as const
export type ClipStatus = (typeof CLIP_STATUSES)[number]

export const CLIP_ORIGINS = ['claude', 'manual'] as const
export type ClipOrigin = (typeof CLIP_ORIGINS)[number]

/** Hard limits for a clip; the sweet spot for Shorts/TikTok is 15–60 s. */
export const CLIP_MIN_MS = 3_000
export const CLIP_MAX_MS = 180_000
export const CLIP_IDEAL_MIN_MS = 15_000
export const CLIP_IDEAL_MAX_MS = 60_000

export interface ClipDto {
  id: string
  projectId: string
  proposalId: string | null
  startMs: number
  endMs: number
  title: string
  hook: string | null
  reason: string | null
  /** 0–100, how likely Claude thinks it is to do well. */
  score: number | null
  keywords: string[]
  origin: ClipOrigin
  status: ClipStatus
  createdAt: number
  updatedAt: number
}

export const PROPOSAL_KINDS = ['clips', 'import'] as const
export type ProposalKind = (typeof PROPOSAL_KINDS)[number]

export const PROPOSAL_STATUSES = ['pending', 'done', 'dismissed'] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

export interface ImportProposalPayload {
  url: string
  meta: YoutubeMeta
  quality: DownloadQuality
  range?: TimeRange
}

export interface ProposalDto {
  id: string
  kind: ProposalKind
  status: ProposalStatus
  title: string
  /** What Claude wrote to explain the proposal. */
  note: string | null
  /** The MCP client that sent it, e.g. "claude-code". */
  client: string | null
  projectId: string | null
  projectName: string | null
  clips: ClipDto[]
  import: ImportProposalPayload | null
  /** For an approved import: the project it created. */
  resultProjectId: string | null
  createdAt: number
  decidedAt: number | null
}

/**
 * Moves clip edges onto word boundaries so a clip never starts or ends mid-word:
 * the start goes to the first word that overlaps it, the end to the last word that overlaps it,
 * with a little breathing room on both sides.
 */
export function snapToWords(words: Word[], startMs: number, endMs: number, durationMs: number): { startMs: number; endMs: number } {
  const inside = words.filter((w) => w.end > startMs && w.start < endMs)
  if (!inside.length) return { startMs: Math.max(0, startMs), endMs: Math.min(durationMs, endMs) }
  const first = inside[0]!
  const last = inside.at(-1)!
  return {
    startMs: Math.max(0, first.start - 100),
    endMs: Math.min(durationMs, last.end + 250),
  }
}

/** Share of the shorter range covered by both, 0..1. */
export function overlapRatio(a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }): number {
  const overlap = Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs)
  const shorter = Math.min(a.endMs - a.startMs, b.endMs - b.startMs)
  return overlap > 0 && shorter > 0 ? overlap / shorter : 0
}

export interface Sentence {
  start: number
  end: number
  text: string
}

const SENTENCE_END = /[.!?…]["')\]]?$/

/** Sentences with times, for reading a transcript (and picking clip edges) at a glance. */
export function toSentences(words: Word[], { pauseMs = 1000, maxWords = 40 } = {}): Sentence[] {
  const out: Sentence[] = []
  let from = 0
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1]
    const pause = next ? next.start - words[i]!.end : 0
    if (!next || SENTENCE_END.test(words[i]!.text) || pause >= pauseMs || i - from + 1 >= maxWords) {
      const slice = words.slice(from, i + 1)
      out.push({ start: slice[0]!.start, end: slice.at(-1)!.end, text: slice.map((w) => w.text).join(' ') })
      from = i + 1
    }
  }
  return out
}
