import type { Word } from '@clipstudio/core/shared'
import { describe, expect, it } from 'vitest'
import { alignWords, speechMap } from './align'

const FRAME = 20
/** An envelope at `floor` dB with louder stretches [startMs, endMs, dB]. */
function envelope(totalMs: number, floor: number, loud: [number, number, number][]): Float32Array {
  const env = new Float32Array(totalMs / FRAME).fill(floor)
  for (const [a, b, db] of loud) env.fill(db, a / FRAME, b / FRAME)
  // A little texture, so percentiles behave like real audio.
  env.forEach((v, i) => (env[i] = v + ((i * 7) % 5) * 0.3))
  return env
}
const w = (text: string, start: number, end: number): Word => ({ text, start, end, p: 0.9 })

describe('speechMap', () => {
  it('finds speech above the quiet floor and ignores short clicks', () => {
    const map = speechMap(envelope(20_000, -50, [[5_000, 7_000, -25], [12_000, 12_080, -20]]))
    expect(map.ranges).toEqual([{ start: 5_000, end: 7_000 }])
  })

  it('marks audio with no quiet floor as unclear', () => {
    const map = speechMap(envelope(20_000, -20, []))
    expect(map.ranges).toEqual([])
    expect(map.classes.every((c) => c === 2)).toBe(true)
  })
})

describe('alignWords', () => {
  // Whisper's real mistake on a gas-station clip: the line is said at 6.6–8.2 s, but its words were stamped from 0.6 s.
  const stretched = [
    w('yeah.', 0, 400),
    w('Man,', 600, 1_140),
    w("we're", 1_140, 2_300),
    w('being', 2_300, 3_450),
    w('productive', 3_450, 5_750),
    w('right', 5_750, 6_910),
    w('now.', 6_910, 8_320),
  ]
  const audio = envelope(20_000, -49, [[0, 400, -28], [6_600, 8_280, -28]])

  it('moves words stamped in the quiet into the speech that follows', () => {
    const { words, moved } = alignWords(stretched, speechMap(audio))
    expect(moved).toBe(4)
    const line = words.slice(1)
    expect(line[0]!.start).toBe(6_600)
    expect(line.at(-1)!.end).toBeLessThanOrEqual(8_320)
    // In order, no overlaps, longer words get more time.
    for (let i = 1; i < line.length; i++) expect(line[i]!.start).toBeGreaterThanOrEqual(line[i - 1]!.end)
    expect(line[3]!.end - line[3]!.start).toBeGreaterThan(line[1]!.end - line[1]!.start)
    expect(words[0]).toEqual(stretched[0])
  })

  it('does not change its input', () => {
    const copy = structuredClone(stretched)
    alignWords(stretched, speechMap(audio))
    expect(stretched).toEqual(copy)
  })

  it('sends the tail of a sentence that drifted past its speech back to it', () => {
    const words = [w('It', 1_000, 1_200), w('was', 1_200, 1_500), w('the', 2_600, 2_900), w('eye.', 2_900, 3_300), w('Run!', 6_000, 6_400)]
    const map = speechMap(envelope(20_000, -50, [[1_000, 2_000, -25], [6_000, 6_500, -25]]))
    const out = alignWords(words, map).words
    expect(out[3]!.end).toBeLessThanOrEqual(2_000)
    expect(out[2]!.start).toBeGreaterThanOrEqual(out[1]!.end)
    expect(out[4]).toEqual(words[4])
  })

  it('trims quiet off the start of a word', () => {
    const map = speechMap(envelope(20_000, -50, [[3_000, 3_600, -25]]))
    const out = alignWords([w('Hey!', 2_000, 3_600)], map).words
    expect(out[0]!.start).toBe(2_940)
    expect(out[0]!.end).toBe(3_600)
  })

  it('leaves words alone where the audio is unclear (a music bed)', () => {
    const music = envelope(20_000, -20, [])
    expect(alignWords(stretched, speechMap(music)).words).toEqual(stretched)
  })

  it('leaves words alone when the next speech is too far away', () => {
    const far = [w('hello', 1_000, 1_400), w('there.', 1_400, 2_000)]
    const map = speechMap(envelope(30_000, -50, [[200, 600, -25], [15_000, 15_500, -25]]))
    expect(alignWords(far, map).words).toEqual(far)
  })
})
