import type { CaptionWord, Range, TrimSettings } from './types'

/** A spoken word on the source timeline (absolute milliseconds). */
export interface SourceWord {
  text: string
  start: number
  end: number
}

/** Sorts and joins overlapping or touching ranges. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start)
  const out: Range[] = []
  for (const r of sorted) {
    const last = out.at(-1)
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

/** Filler words people say without meaning to. Whisper writes some of them; others it drops on its own. */
export const FILLER = /^(u+[hm]+|e+r+m*|a+h+|h+m+|mm+|uh-huh)[.,!?…]*$/i

/**
 * The ranges to remove from a clip: hand-made cuts, plus long pauses and filler words when switched on.
 * A pause is shortened rather than removed, keeping a little air on both sides.
 */
export function effectiveCuts(words: SourceWord[], clip: Range, trim: TrimSettings): Range[] {
  const inside = words.filter((w) => w.end > clip.start && w.start < clip.end)
  const cuts: Range[] = [...trim.cuts]
  if (trim.removePauses) {
    const keep = 150
    for (let i = 0; i + 1 < inside.length; i++) {
      const gapStart = inside[i]!.end
      const gapEnd = inside[i + 1]!.start
      if (gapEnd - gapStart > Math.max(trim.pauseMs, keep * 2 + 50)) cuts.push({ start: gapStart + keep, end: gapEnd - keep })
    }
  }
  if (trim.removeFillers) {
    for (let i = 0; i < inside.length; i++) {
      const w = inside[i]!
      if (!FILLER.test(w.text)) continue
      const next = inside[i + 1]
      cuts.push({ start: w.start, end: next ? Math.min(next.start, w.end + 120) : w.end })
    }
  }
  return mergeRanges(cuts.map((c) => ({ start: Math.max(clip.start, c.start), end: Math.min(clip.end, c.end) })))
}

/** The parts of the clip that are kept, in order (source milliseconds). */
export function keptSegments(clip: Range, cuts: Range[]): Range[] {
  const out: Range[] = []
  let cursor = clip.start
  for (const cut of mergeRanges(cuts)) {
    if (cut.end <= clip.start || cut.start >= clip.end) continue
    if (cut.start > cursor) out.push({ start: cursor, end: cut.start })
    cursor = Math.max(cursor, cut.end)
  }
  if (cursor < clip.end) out.push({ start: cursor, end: clip.end })
  return out.filter((s) => s.end - s.start >= 1)
}

export function outputDuration(segments: Range[]): number {
  return segments.reduce((sum, s) => sum + (s.end - s.start), 0)
}

/** Where a source moment lands in the output, or null if it was cut. */
export function sourceToOutput(segments: Range[], ms: number): number | null {
  let offset = 0
  for (const s of segments) {
    if (ms < s.start) return null
    if (ms < s.end) return offset + (ms - s.start)
    offset += s.end - s.start
  }
  return null
}

/** The source moment shown at an output time. */
export function outputToSource(segments: Range[], ms: number): number {
  let remaining = Math.max(0, ms)
  for (const s of segments) {
    const len = s.end - s.start
    if (remaining < len) return s.start + remaining
    remaining -= len
  }
  const last = segments.at(-1)
  return last ? last.end : 0
}

/** The next moment that is kept, at or after `ms` (to skip over cuts while playing). */
export function nextKept(segments: Range[], ms: number): number | null {
  for (const s of segments) {
    if (ms < s.end) return Math.max(ms, s.start)
  }
  return null
}

/**
 * Moves words onto the output timeline. Words that were cut disappear; words split by a cut are shortened.
 */
export function wordsToOutput(
  words: SourceWord[],
  segments: Range[],
  opts: { keywords?: string[]; emojis?: Record<string, string> } = {},
): CaptionWord[] {
  const keywords = new Set((opts.keywords ?? []).map(normaliseWord))
  const out: CaptionWord[] = []
  let offset = 0
  for (const seg of segments) {
    for (const w of words) {
      const start = Math.max(w.start, seg.start)
      const end = Math.min(w.end, seg.end)
      // Keep a word only if most of it survives in this segment.
      if (end - start < Math.min(80, (w.end - w.start) * 0.5)) continue
      const key = normaliseWord(w.text)
      out.push({
        text: w.text,
        start: offset + (start - seg.start),
        end: offset + (end - seg.start),
        keyword: keywords.has(key),
        emoji: opts.emojis?.[key] ?? null,
      })
    }
    offset += seg.end - seg.start
  }
  return out
}

export function normaliseWord(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '')
}
