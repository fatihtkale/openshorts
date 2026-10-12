import { describe, expect, it } from 'vitest'
import { groupParagraphs, searchWords, toPlainText, toSrt, wordIndexAt, type Word } from './transcripts'

const w = (text: string, start: number, end = start + 300): Word => ({ text, start, end, p: 0.9 })

const sample: Word[] = [
  w('Hello', 0),
  w('there.', 400),
  w('This', 800),
  w('is', 1100),
  w("Clip's", 1400),
  w('studio!', 1700),
  // a long pause
  w('New', 5000),
  w('part.', 5300),
]

describe('groupParagraphs', () => {
  it('breaks on long pauses', () => {
    expect(groupParagraphs(sample).map((p) => [p.from, p.to])).toEqual([
      [0, 6],
      [6, 8],
    ])
  })

  it('breaks on sentence ends once a paragraph is long enough', () => {
    expect(groupParagraphs(sample, { minWords: 2 }).map((p) => [p.from, p.to])).toEqual([
      [0, 2],
      [2, 6],
      [6, 8],
    ])
  })
})

describe('searchWords', () => {
  it('finds phrases regardless of case and punctuation', () => {
    expect(searchWords(sample, 'there this')).toEqual([{ from: 1, to: 3 }])
    expect(searchWords(sample, "clip's studio")).toEqual([{ from: 4, to: 6 }])
  })

  it('treats the last term as a prefix', () => {
    expect(searchWords(sample, 'stu')).toEqual([{ from: 5, to: 6 }])
    expect(searchWords(sample, '   ')).toEqual([])
  })
})

describe('wordIndexAt', () => {
  it('finds the word being spoken, or the last one before', () => {
    expect(wordIndexAt(sample, -1)).toBe(-1)
    expect(wordIndexAt(sample, 0)).toBe(0)
    expect(wordIndexAt(sample, 1150)).toBe(3)
    expect(wordIndexAt(sample, 4000)).toBe(5)
    expect(wordIndexAt(sample, 99_000)).toBe(7)
  })
})

describe('exports', () => {
  it('writes paragraphs as plain text', () => {
    expect(toPlainText(sample)).toBe("Hello there. This is Clip's studio!\n\nNew part.")
  })

  it('writes SRT cues split at sentence ends and pauses', () => {
    const srt = toSrt(sample)
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:00,700\nHello there.\n')
    expect(srt).toContain("2\n00:00:00,800 --> 00:00:02,000\nThis is Clip's studio!\n")
    expect(srt).toContain('3\n00:00:05,000 --> 00:00:05,600\nNew part.\n')
  })
})
