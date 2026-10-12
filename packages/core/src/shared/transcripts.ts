// Safe to import from the browser: no Node or database dependencies.

/** One spoken word. Times are milliseconds from the start of the source video. */
export interface Word {
  text: string
  start: number
  end: number
  /** Model confidence 0..1. Low values are worth checking by hand. */
  p: number
}

export const TRANSCRIPT_STATUSES = ['pending', 'ready', 'failed'] as const
export type TranscriptStatus = (typeof TRANSCRIPT_STATUSES)[number]

export interface TranscriptSummary {
  status: TranscriptStatus
  error: string | null
  language: string | null
  /** What was asked for: a language code, or 'auto'. */
  requestedLanguage: string
  model: string | null
  wordCount: number
  edited: boolean
  updatedAt: number
}

export interface TranscriptDto extends TranscriptSummary {
  words: Word[]
}

export interface WordEdit {
  index: number
  text: string
}

/** Below this confidence a word gets a dotted underline in the transcript. */
export const LOW_CONFIDENCE = 0.4

export interface WhisperModel {
  id: string
  file: string
  label: string
  description: string
  bytes: number
  recommended: boolean
}

const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

export const WHISPER_MODELS: WhisperModel[] = [
  {
    id: 'large-v3-turbo-q5_0',
    file: 'ggml-large-v3-turbo-q5_0.bin',
    label: 'Large v3 Turbo (compressed)',
    description: 'Almost the accuracy of the full model at a third of the size. Best choice for most people.',
    bytes: 574_041_195,
    recommended: true,
  },
  {
    id: 'large-v3-turbo',
    file: 'ggml-large-v3-turbo.bin',
    label: 'Large v3 Turbo',
    description: 'The most accurate option. Slightly slower and three times bigger.',
    bytes: 1_624_555_275,
    recommended: false,
  },
  {
    id: 'base',
    file: 'ggml-base.bin',
    label: 'Base',
    description: 'Small and very fast, but makes noticeably more mistakes. Handy for quick tests.',
    bytes: 147_951_465,
    recommended: false,
  },
]

export const WHISPER_MODEL_IDS = WHISPER_MODELS.map((m) => m.id) as [string, ...string[]]

export function whisperModelUrl(model: WhisperModel): string {
  return `${HF_BASE}/${model.file}`
}

export interface WhisperModelStatus extends WhisperModel {
  installed: boolean
  selected: boolean
}

export interface ModelListItem extends WhisperModelStatus {
  /** The queued or running download job for this model, if any. */
  downloadJobId: string | null
}

/** Languages offered in the picker. Whisper detects many more on its own with 'auto'. */
export const TRANSCRIPT_LANGUAGES = [
  'auto', 'en', 'da', 'nl', 'de', 'fr', 'es', 'it', 'pt', 'tr', 'ar', 'hi', 'ja', 'ko', 'zh', 'ru', 'pl', 'sv', 'no', 'fi', 'uk',
] as const

export function languageName(code: string | null): string {
  if (!code) return 'Unknown'
  if (code === 'auto') return 'Detect automatically'
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

export interface Paragraph {
  /** Index of the first word. */
  from: number
  /** Index after the last word. */
  to: number
  start: number
  end: number
}

const SENTENCE_END = /[.!?…]["')\]]?$/

/**
 * Groups words into readable paragraphs: breaks on long pauses, and on sentence ends once a paragraph is long enough.
 */
export function groupParagraphs(words: Word[], opts: { pauseMs?: number; minWords?: number; maxWords?: number } = {}): Paragraph[] {
  const pauseMs = opts.pauseMs ?? 1500
  const minWords = opts.minWords ?? 25
  const maxWords = opts.maxWords ?? 80
  const out: Paragraph[] = []
  let from = 0
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    const next = words[i + 1]
    const length = i - from + 1
    const pause = next ? next.start - word.end : 0
    const sentenceEnd = SENTENCE_END.test(word.text)
    if (!next || pause >= pauseMs || (sentenceEnd && length >= minWords) || length >= maxWords) {
      out.push({ from, to: i + 1, start: words[from]!.start, end: word.end })
      from = i + 1
    }
  }
  return out
}

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '')

/** Finds a word or phrase. Returns the index ranges [from, to) of each match. */
export function searchWords(words: Word[], query: string): { from: number; to: number }[] {
  const terms = query.split(/\s+/).map(normalise).filter(Boolean)
  if (!terms.length) return []
  const norm = words.map((w) => normalise(w.text))
  const matches: { from: number; to: number }[] = []
  for (let i = 0; i + terms.length <= norm.length; i++) {
    let ok = true
    for (let t = 0; t < terms.length; t++) {
      const word = norm[i + t]!
      // The last term may be a prefix, so results appear while typing.
      if (t === terms.length - 1 ? !word.startsWith(terms[t]!) : word !== terms[t]) {
        ok = false
        break
      }
    }
    if (ok) matches.push({ from: i, to: i + terms.length })
  }
  return matches
}

/** Index of the word being spoken at `ms`, or of the last word before it; -1 before the first word. */
export function wordIndexAt(words: Word[], ms: number): number {
  let lo = 0
  let hi = words.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (words[mid]!.start <= ms) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

export function toPlainText(words: Word[]): string {
  return groupParagraphs(words)
    .map((p) => words.slice(p.from, p.to).map((w) => w.text).join(' '))
    .join('\n\n')
}

function srtTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(Math.floor(ms % 1000), 3)}`
}

/** Subtitle cues of at most ~42 characters / 3.5 s, broken at sentence ends and pauses. */
export function toSrt(words: Word[]): string {
  const cues: Word[][] = []
  let current: Word[] = []
  for (const word of words) {
    const text = [...current, word].map((w) => w.text).join(' ')
    const first = current[0]
    const last = current.at(-1)
    const tooLong = text.length > 42 || (first && word.end - first.start > 3500)
    const pause = last && word.start - last.end > 700
    if (current.length && (tooLong || pause || SENTENCE_END.test(last!.text))) {
      cues.push(current)
      current = []
    }
    current.push(word)
  }
  if (current.length) cues.push(current)
  return cues
    .map((cue, i) => `${i + 1}\n${srtTime(cue[0]!.start)} --> ${srtTime(cue.at(-1)!.end)}\n${cue.map((w) => w.text).join(' ')}\n`)
    .join('\n')
}
