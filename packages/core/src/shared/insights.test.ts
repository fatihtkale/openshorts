import { describe, expect, it } from 'vitest'
import { computeInsights, earlyViews, type InsightPost } from './insights'
import { zonedToUtc } from './schedule'

const zone = 'America/New_York'
const window = { timeZone: zone, windowStart: '12:00', windowEnd: '21:00' }
let n = 0
function post(hour: number, views: number, account = 'a', day = 1): InsightPost {
  return {
    id: `p${++n}`,
    platform: 'youtube',
    accountId: account,
    accountName: account,
    title: 't',
    url: null,
    liveAt: zonedToUtc(`2026-09-${String(day).padStart(2, '0')}`, hour * 60, zone),
    readings: [{ ageHours: 49, views, likes: null, comments: null, shares: null }],
  }
}

describe('insights', () => {
  it('takes the reading nearest two days, within a day either side', () => {
    const r = (ageHours: number, views: number) => ({ ageHours, views, likes: null, comments: null, shares: null })
    expect(earlyViews([r(47, 10), r(170, 99)])).toBe(10)
    expect(earlyViews([r(30, 5), r(60, 8)])).toBe(8)
    expect(earlyViews([r(170, 99)])).toBeNull()
  })

  it('says nothing about best times until there is enough data', () => {
    const result = computeInsights([post(13, 100), post(14, 200)], window)
    expect(result).toMatchObject({ measured: 2, enough: false, suggestion: null })
    expect(result.hours[13]).toMatchObject({ posts: 1, medianViews: 100 })
  })

  it('compares accounts by their usual views and suggests a clearly better window', () => {
    // Big account (≈10k usual) and small account (≈100 usual); both do 3× better in the evening.
    const posts = [
      ...[12, 13, 14, 15, 16].map((h, i) => post(h, 10_000, 'big', i + 1)),
      ...[19, 20, 21, 22].map((h, i) => post(h, 30_000, 'big', i + 1)),
      ...[12, 13, 14, 15].map((h, i) => post(h, 100, 'small', i + 1)),
      ...[19, 20, 21, 22].map((h, i) => post(h, 300, 'small', i + 1)),
    ]
    const result = computeInsights(posts, { ...window, windowStart: '12:00', windowEnd: '16:00' })
    expect(result.enough).toBe(true)
    // Scores are relative: the evening hours score 3× the afternoon in both accounts.
    expect(result.hours[20]!.score! / result.hours[13]!.score!).toBeCloseTo(3)
    // The suggested window covers all the evening posts.
    expect(result.suggestion!.start <= '19:00' && result.suggestion!.end >= '22:00').toBe(true)
    expect(result.suggestion!.posts).toBe(8)
    expect(result.suggestion!.lift).toBeGreaterThan(1)
  })

  it('keeps the current window when nothing beats it clearly', () => {
    const posts = Array.from({ length: 12 }, (_, i) => post(12 + (i % 10), 1000 + i, 'a', i + 1))
    expect(computeInsights(posts, window).suggestion).toBeNull()
  })
})
