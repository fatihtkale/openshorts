import type { Word } from '@clipstudio/core/shared'
import { loudnessEnvelope } from './loudness'

/**
 * Whisper's word times drift: with one segment per word, a word's start is glued to the end of the word before it, so
 * a word after a pause "starts" in the silence, sometimes seconds early. Captions then show it before it's said.
 * These helpers pull the words back onto the speech in audio.wav (a loudness envelope, see `loudnessEnvelope`).
 *
 * Only clear cases change: where the audio has no quiet floor to compare with (a music bed, constant noise), the
 * words there stay exactly as whisper wrote them.
 */

interface Range {
  start: number
  end: number
}

/** Frame classes: 0 quiet, 1 speech (or another loud sound), 2 unclear (no quiet floor nearby to judge by). */
type FrameClass = 0 | 1 | 2

const FRAME_MS = 20
const BLOCK_MS = 2_000
/** Each block is judged against the audio within this distance on both sides. */
const WINDOW_MS = 10_000
/** Speech must stand this far above the quiet floor for a stretch to count as clear. */
const MIN_CONTRAST_DB = 12
/** Quiet gaps shorter than this inside speech are part of it (between syllables and words). */
const BRIDGE_MS = 300
/** Shorter loud bits are clicks and thuds, not words. */
const MIN_SPEECH_MS = 150
const LEAD_PAD_MS = 60
const TAIL_PAD_MS = 120
/** Leading or trailing quiet inside a word worth trimming. */
const TRIM_LEAD_MS = 150
const TRIM_TAIL_MS = 200
/** Words found in the quiet move into the next speech only if it is this close. */
const MAX_SHIFT_MS = 10_000
/** How many already-placed words, at most, share their room with words moved in. */
const MAX_GROUP = 12
const MIN_WORD_MS = 60
const SENTENCE_END = /[.!?…]["')\]]*$/

export interface SpeechMap {
  frameMs: number
  classes: Uint8Array
  /** Clear speech, in ms. */
  ranges: Range[]
}

/** Classifies each frame of a loudness envelope (dBFS per frame) as quiet, speech or unclear. */
export function speechMap(envelope: Float32Array, frameMs = 20): SpeechMap {
  const n = envelope.length
  const classes = new Uint8Array(n) as Uint8Array & { [i: number]: FrameClass }
  const perBlock = Math.max(1, Math.round(BLOCK_MS / frameMs))
  const reach = Math.round(WINDOW_MS / frameMs)
  for (let b = 0; b < n; b += perBlock) {
    const end = Math.min(n, b + perBlock)
    const around = envelope.slice(Math.max(0, b - reach), Math.min(n, end + reach)).sort()
    const floor = around[Math.floor(around.length * 0.1)]!
    const peak = around[Math.min(around.length - 1, Math.floor(around.length * 0.99))]!
    if (peak - floor < MIN_CONTRAST_DB) {
      classes.fill(2, b, end)
      continue
    }
    // 10–15 dB over the floor: high enough to skip room noise, low enough that an explosion can't hide quieter talking.
    const threshold = floor + Math.min(15, Math.max(10, 0.45 * (peak - floor)))
    for (let i = b; i < end; i++) classes[i] = envelope[i]! >= threshold ? 1 : 0
  }

  const ranges: Range[] = []
  for (let i = 0; i < n; ) {
    if (classes[i] !== 1) {
      i++
      continue
    }
    let j = i
    while (j < n && classes[j] === 1) j++
    const last = ranges.at(-1)
    if (last && i * frameMs - last.end < BRIDGE_MS && !hasClass(classes, last.end / frameMs, i, 2)) last.end = j * frameMs
    else ranges.push({ start: i * frameMs, end: j * frameMs })
    i = j
  }
  return { frameMs, classes, ranges: ranges.filter((r) => r.end - r.start >= MIN_SPEECH_MS) }
}

function hasClass(classes: Uint8Array, from: number, to: number, cls: FrameClass): boolean {
  for (let i = Math.max(0, Math.floor(from)); i < Math.min(classes.length, to); i++) if (classes[i] === cls) return true
  return false
}

/** Index of the speech range that overlaps [start, end) the most, or -1. */
function mostOverlap(ranges: Range[], start: number, end: number): number {
  let best = -1
  let bestMs = 0
  for (let r = firstOverlap(ranges, start, end); r >= 0 && r < ranges.length && ranges[r]!.start < end; r++) {
    const ms = Math.min(end, ranges[r]!.end) - Math.max(start, ranges[r]!.start)
    if (ms > bestMs) {
      best = r
      bestMs = ms
    }
  }
  return best
}

/** Index of the first speech range that overlaps [start, end), or -1. */
function firstOverlap(ranges: Range[], start: number, end: number): number {
  let lo = 0
  let hi = ranges.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ranges[mid]!.end <= start) lo = mid + 1
    else hi = mid
  }
  return lo < ranges.length && ranges[lo]!.start < end ? lo : -1
}

/**
 * Moves words onto the speech: trims quiet off a word's edges, and words that sit entirely in quiet (whisper stamped
 * them early) move into the speech that follows, sharing it with the words already there by character count.
 * Returns new words (the input is not changed) and how many words moved into other speech.
 */
type Kind = 'frozen' | 'speech' | 'quiet'

/** Spreads the words over [from, to] by character count, in order. */
function spread(group: Word[], from: number, to: number): void {
  const weights = group.map((w) => Math.max(2, w.text.length))
  const total = weights.reduce((a, b) => a + b, 0)
  let t = from
  group.forEach((w, g) => {
    const span = ((to - from) * weights[g]!) / total
    w.start = Math.round(t)
    w.end = Math.round(t + span)
    t += span
  })
}

/**
 * The quiet words out[i..k) end a sentence that started in speech just before: they go back into that speech,
 * shared with the sentence's words already there.
 */
function placeBack(out: Word[], words: Word[], kinds: Kind[], ranges: Range[], i: number, k: number): boolean {
  const before = i - 1
  if (before < 0 || kinds[before] !== 'speech' || SENTENCE_END.test(out[before]!.text) || !SENTENCE_END.test(out[k - 1]!.text)) return false
  const r = mostOverlap(ranges, words[before]!.start, words[before]!.end)
  const home = r >= 0 ? ranges[r]! : null
  if (!home || out[i]!.start - home.end > MAX_SHIFT_MS) return false
  let h = before
  while (h > 0 && k - h < MAX_GROUP && kinds[h - 1] === 'speech' && out[h - 1]!.end > home.start && !SENTENCE_END.test(out[h - 1]!.text)) h--
  const group = out.slice(h, k)
  const from = out[h]!.start
  const limit = out[k]?.start ?? Number.POSITIVE_INFINITY
  spread(group, from, Math.min(limit, Math.max(home.end, from + group.length * MIN_WORD_MS)))
  return true
}

/** The quiet words out[i..k) move into the speech of the word after them, shared with that sentence's words. */
function placeForward(out: Word[], words: Word[], kinds: Kind[], ranges: Range[], i: number, k: number): boolean {
  const r = k < out.length && kinds[k] === 'speech' ? mostOverlap(ranges, words[k]!.start, words[k]!.end) : -1
  const target = r >= 0 ? ranges[r]! : null
  if (!target || target.start - out[k - 1]!.end > MAX_SHIFT_MS) return false
  let m = k
  while (m + 1 < out.length && m + 1 - i < MAX_GROUP && kinds[m + 1] === 'speech' && out[m + 1]!.start < target.end && !SENTENCE_END.test(out[m]!.text)) m++
  const group = out.slice(i, m + 1)
  const from = target.start
  const limit = out[m + 1]?.start ?? Number.POSITIVE_INFINITY
  spread(group, from, Math.min(limit, Math.max(out[m]!.end, from + group.length * MIN_WORD_MS)))
  return true
}

export function alignWords(words: Word[], map: SpeechMap): { words: Word[]; moved: number } {
  const out = words.map((w) => ({ ...w }))
  const { ranges, classes, frameMs } = map
  if (!ranges.length) return { words: out, moved: 0 }

  const kinds: Kind[] = out.map((w) => {
    if (w.end <= w.start || hasClass(classes, w.start / frameMs, Math.ceil(w.end / frameMs), 2)) return 'frozen'
    return firstOverlap(ranges, w.start, w.end) >= 0 ? 'speech' : 'quiet'
  })

  // Trim quiet off the edges of words that overlap speech.
  out.forEach((w, i) => {
    if (kinds[i] !== 'speech') return
    const first = ranges[firstOverlap(ranges, w.start, w.end)]!
    let last = first
    for (let r = ranges.indexOf(first) + 1; r < ranges.length && ranges[r]!.start < w.end; r++) last = ranges[r]!
    const onset = Math.max(w.start, first.start)
    const offset = Math.min(w.end, last.end)
    if (onset - w.start > TRIM_LEAD_MS) w.start = Math.max(w.start, onset - LEAD_PAD_MS)
    if (w.end - offset > TRIM_TAIL_MS) w.end = Math.min(w.end, offset + TAIL_PAD_MS)
    if (w.end - w.start < MIN_WORD_MS) w.end = Math.min(words[i]!.end, w.start + MIN_WORD_MS)
  })

  // Words in the quiet belong to speech nearby: usually the next (whisper stamps a word early, gluing it to the word
  // before), but a sentence's tail that drifted past the end of its speech goes back to it.
  let moved = 0
  for (let i = 0; i < out.length; ) {
    if (kinds[i] !== 'quiet') {
      i++
      continue
    }
    let k = i
    while (k < out.length && kinds[k] === 'quiet') k++
    moved += placeBack(out, words, kinds, ranges, i, k) || placeForward(out, words, kinds, ranges, i, k) ? k - i : 0
    i = k
  }

  // Keep the words in order without overlaps.
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]!
    const cur = out[i]!
    if (cur.start < prev.end) {
      if (cur.start > prev.start) prev.end = cur.start
      else cur.start = prev.end
    }
    if (cur.end < cur.start) cur.end = cur.start
  }
  return { words: out, moved }
}

/** Reads the project's audio.wav and aligns the words to its speech (see `alignWords`). */
export async function alignToAudio(
  wavPath: string,
  words: Word[],
  opts: { signal?: AbortSignal; onProgress?: (f: number) => void } = {},
): Promise<{ words: Word[]; moved: number }> {
  const envelope = await loudnessEnvelope(wavPath, { frameMs: FRAME_MS, ...opts })
  return alignWords(words, speechMap(envelope, FRAME_MS))
}
