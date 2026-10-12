import { readFile, rm } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import type { Word } from '@clipstudio/core/shared'
import { ProcessError, run } from './process'

interface RawToken {
  text?: string
  p?: number
}

interface RawSegment {
  text?: string
  offsets?: { from?: number; to?: number }
  tokens?: RawToken[]
}

interface RawWhisperJson {
  result?: { language?: string }
  transcription?: RawSegment[]
}

/** Bracketed or parenthesised non-speech markers whisper writes, like [BLANK_AUDIO] or (music). */
const NON_SPEECH = /^[[(].*[\])]$/

/**
 * Turns whisper.cpp's JSON (run with -ml 1 -sow, so each segment is about one word) into words.
 * A segment that still holds several words is split, sharing its time by character count.
 */
export function parseWhisperJson(raw: RawWhisperJson): { language: string | null; words: Word[] } {
  const words: Word[] = []
  for (const segment of raw.transcription ?? []) {
    const text = (segment.text ?? '').trim()
    const from = segment.offsets?.from
    const to = segment.offsets?.to
    if (!text || NON_SPEECH.test(text) || from === undefined || to === undefined) continue

    const speech = (segment.tokens ?? []).filter((t) => t.text && !t.text.startsWith('[_') && typeof t.p === 'number')
    const p = speech.length ? speech.reduce((sum, t) => sum + t.p!, 0) / speech.length : 1

    const parts = text.split(/\s+/)
    const total = parts.reduce((sum, w) => sum + w.length, 0)
    let cursor = from
    for (const part of parts) {
      const share = total ? ((to - from) * part.length) / total : (to - from) / parts.length
      const end = Math.round(cursor + share)
      words.push({ text: part, start: Math.round(cursor), end: Math.max(end, Math.round(cursor)), p: Math.round(p * 1000) / 1000 })
      cursor += share
    }
  }

  // Whisper sometimes glues punctuation on as its own "word"; attach it to the word before.
  const merged: Word[] = []
  for (const word of words) {
    const prev = merged.at(-1)
    if (prev && /^[.,!?;:…%)\]"'»”’-]+$/.test(word.text)) {
      prev.text += word.text
      prev.end = Math.max(prev.end, word.end)
    } else {
      merged.push(word)
    }
  }
  return { language: raw.result?.language ?? null, words: merged }
}

/** Reads `progress = 42%` from whisper-cli's -pp output. */
export function parseWhisperProgress(line: string): number | null {
  const match = /progress\s*=\s*(\d+)%/.exec(line)
  return match ? Number(match[1]) / 100 : null
}

export interface TranscribeOptions {
  audioPath: string
  modelPath: string
  /** A language code, or 'auto'. */
  language: string
  /** Where whisper writes its JSON (without extension); removed afterwards. */
  outBase: string
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

export async function transcribe(opts: TranscribeOptions): Promise<{ language: string | null; words: Word[] }> {
  const threads = Math.max(2, Math.min(8, availableParallelism() - 2))
  const args = [
    '-m', opts.modelPath,
    '-f', opts.audioPath,
    '-l', opts.language,
    // One segment per word gives each word its own timing.
    '-ml', '1',
    '-sow',
    // Drop non-speech tokens like (music) and [laughs].
    '-sns',
    '-oj',
    '-ojf',
    '-of', opts.outBase,
    '-pp',
    '-t', String(threads),
  ]
  const onLine = (line: string) => {
    const fraction = parseWhisperProgress(line)
    if (fraction !== null) opts.onProgress?.(fraction)
  }
  try {
    // stdout carries every segment as text; read it line by line instead of buffering hours of it.
    await run('whisper-cli', args, { signal: opts.signal, onStdoutLine: onLine, onStderrLine: onLine })
    return parseWhisperJson(JSON.parse(await readFile(`${opts.outBase}.json`, 'utf8')) as RawWhisperJson)
  } catch (error) {
    if (error instanceof ProcessError) {
      const detail = error.result.stderr.filter((l) => /error|failed/i.test(l)).slice(-2).join(' ')
      throw new Error(`Transcription failed: ${detail || `whisper-cli exited with code ${error.result.code}`}`)
    }
    throw error
  } finally {
    await rm(`${opts.outBase}.json`, { force: true })
  }
}
