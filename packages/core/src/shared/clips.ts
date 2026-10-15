// Safe to import from the browser: no Node or database dependencies.
import { CAPTION_ANIMATIONS, HOOK_STYLES, LAYOUT_MODES, SCREEN_SHARE_MAX, SCREEN_SHARE_MIN, type ClipEdit } from '@clipstudio/captions'
import { z } from 'zod'
import type { DownloadQuality, TimeRange, YoutubeMeta } from './projects'
import type { ClipEvaluation } from './evaluation'
import type { Word } from './transcripts'

export const CLIP_STATUSES = ['proposed', 'approved', 'rejected'] as const
export type ClipStatus = (typeof CLIP_STATUSES)[number]

/** claude: suggested by an AI; manual: made by hand; imported: the whole video is the clip (a Twitch clip). */
export const CLIP_ORIGINS = ['claude', 'manual', 'imported'] as const
export type ClipOrigin = (typeof CLIP_ORIGINS)[number]

/** Hard limits for a clip; the sweet spot (22–45 s) and its warnings live in `evaluation.ts`. */
export const CLIP_MIN_MS = 3_000
export const CLIP_MAX_MS = 180_000

export interface ClipDto {
  id: string
  projectId: string
  proposalId: string | null
  startMs: number
  endMs: number
  title: string
  hook: string | null
  reason: string | null
  /** 0–100, how likely Claude thinks it is to do well (10 × the evaluation total when there is one). */
  score: number | null
  keywords: string[]
  /** The 4-pillar judgement, if the clip has been evaluated. */
  evaluation: ClipEvaluation | null
  origin: ClipOrigin
  status: ClipStatus
  /** How the clip looks (layout, captions, hook, trims). Defaults filled in for older clips. */
  edit: ClipEdit
  /** Goes up by one on every saved change; exports remember which version they rendered. */
  version: number
  /** The newest export, if any. */
  render: RenderDto | null
  createdAt: number
  updatedAt: number
}

/** Whether a clip needs (re-)exporting: never exported, the export failed, or the clip changed since. */
export function needsExport(clip: Pick<ClipDto, 'version' | 'render'>): boolean {
  const r = clip.render
  return !r || r.status === 'failed' || r.clipVersion < clip.version
}

/** A clip on the Clips page, with where it has been posted. */
export interface LibraryClip {
  clip: ClipDto
  projectName: string
  /** Posts already on a platform: published, or uploaded and waiting for their publish time. */
  uploaded: number
  /** Posts not sent yet (queued, or uploading right now). */
  waiting: number
}

export const RENDER_STATUSES = ['queued', 'running', 'done', 'failed'] as const
export type RenderStatus = (typeof RENDER_STATUSES)[number]

export interface RenderDto {
  id: string
  clipId: string
  projectId: string
  status: RenderStatus
  /** The clip version this export shows. Older than the clip's version means it's out of date. */
  clipVersion: number
  durationMs: number | null
  bytes: number | null
  error: string | null
  createdAt: number
  finishedAt: number | null
}

const colour = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)
const unit = z.number().min(0).max(1)
const range = z.object({ start: z.number().min(0), end: z.number().min(0) })

/** Validates an edit coming from the browser before it's stored. */
export const clipEditSchema = z.object({
  layout: z.object({
    mode: z.enum(LAYOUT_MODES),
    auto: z.boolean().optional(),
    zoom: z.number().min(1).max(4),
    keyframes: z.array(z.object({ t: z.number().min(0), x: unit, y: unit, ease: z.enum(['smooth', 'linear']).optional() })).min(1).max(2000),
    split: z.object({
      top: z.object({ x: unit, y: unit, zoom: z.number().min(1).max(4) }),
      bottom: z.object({ x: unit, y: unit, zoom: z.number().min(1).max(4) }),
    }),
    screen: z
      .object({
        screen: z.object({ x: unit, y: unit, zoom: z.number().min(1).max(4) }),
        face: z.object({ x: unit, y: unit, zoom: z.number().min(1).max(8) }),
        faceOnTop: z.boolean(),
        screenShare: z.number().min(SCREEN_SHARE_MIN).max(SCREEN_SHARE_MAX).optional(),
      })
      .optional(),
  }),
  captions: z.object({
    enabled: z.boolean(),
    preset: z.string().max(40),
    style: z.object({
      animation: z.enum(CAPTION_ANIMATIONS),
      fontFamily: z.string().max(60),
      fontWeight: z.number().int().min(100).max(900),
      fontSize: z.number().min(24).max(260),
      uppercase: z.boolean(),
      textColor: colour,
      activeColor: colour,
      keywordColor: colour,
      strokeColor: colour,
      strokeWidth: z.number().min(0).max(40),
      shadow: z.boolean(),
      boxColor: colour,
      y: unit,
      maxWordsPerLine: z.number().int().min(1).max(10),
      maxLines: z.number().int().min(1).max(4),
    }),
  }),
  hook: z.object({
    enabled: z.boolean(),
    text: z.string().max(160),
    style: z.enum(HOOK_STYLES),
    durationMs: z.number().min(500).max(10_000),
    y: unit,
  }),
  trim: z.object({
    cuts: z.array(range).max(2000),
    removePauses: z.boolean(),
    pauseMs: z.number().min(300).max(3000),
    removeFillers: z.boolean(),
  }),
  emojis: z.record(z.string().max(40), z.string().max(16)),
}) satisfies z.ZodType<ClipEdit>

export const PROPOSAL_KINDS = ['clips', 'import', 'schedule'] as const
export type ProposalKind = (typeof PROPOSAL_KINDS)[number]

export const PROPOSAL_STATUSES = ['pending', 'done', 'dismissed'] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

export interface ImportProposalPayload {
  url: string
  meta: YoutubeMeta
  quality: DownloadQuality
  range?: TimeRange
}

/** Claude's suggestion for a posting day; the user finishes it in the scheduler. */
export interface ScheduleProposalPayload {
  clipIds: string[]
  /** YYYY-MM-DD in the audience time zone. */
  date: string | null
  accountIds: string[]
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
  schedule: ScheduleProposalPayload | null
  /** For an approved import: the project it created. */
  resultProjectId: string | null
  createdAt: number
  decidedAt: number | null
}

/**
 * Keeps clip edges from cutting a word in half: an edge that lands inside a word moves out to include all of it,
 * with a little breathing room. Edges in silence stay where they are, so footage without speech isn't trimmed away.
 */
/**
 * Spoken words are short; a "word" longer than this is Whisper hearing music or noise (it writes things like
 * "Thank you." stretched over 30 s of a song). Clip edges never snap to those, or a 15 s clip could grow to a minute.
 */
export const MAX_REAL_WORD_MS = 2_000

export function snapToWords(allWords: Word[], startMs: number, endMs: number, durationMs: number): { startMs: number; endMs: number } {
  const words = allWords.filter((w) => w.end - w.start <= MAX_REAL_WORD_MS)
  let start = Math.max(0, startMs)
  let end = Math.min(durationMs, endMs)
  const atStart = words.find((w) => w.start < start && w.end > start)
  if (atStart) start = Math.max(0, atStart.start - 100)
  else {
    // Starting right on (or just before) a word: give it a moment of air.
    const next = words.find((w) => w.start >= start && w.start - start < 100)
    if (next) start = Math.max(0, next.start - 100)
  }
  const atEnd = words.find((w) => w.start < end && w.end > end)
  if (atEnd) end = Math.min(durationMs, atEnd.end + 250)
  else {
    const prev = [...words].reverse().find((w) => w.end <= end && end - w.end < 250)
    if (prev) end = Math.min(durationMs, prev.end + 250)
  }
  return { startMs: start, endMs: end }
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
