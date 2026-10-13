// Safe to import from the browser: no Node or database dependencies.
import { formatClock, parseClock, zonedParts } from './schedule'
import type { Platform } from './social'

/** View counts are read this many hours after a post goes live. */
export const STATS_AGES_HOURS = [48, 168] as const

/** Below this many measured posts, any "best time" is noise; the page says so instead of guessing. */
export const INSIGHTS_MIN_POSTS = 10
/** A posting window needs this many measured posts inside it before it can be compared. */
export const INSIGHTS_MIN_WINDOW_POSTS = 5
/** Suggest a new window only when it beats the current one by this much. */
export const INSIGHTS_MIN_LIFT = 0.15

export interface StatsReading {
  ageHours: number
  views: number
  likes: number | null
  comments: number | null
  shares: number | null
}

export interface InsightPost {
  id: string
  platform: Platform
  accountId: string
  accountName: string | null
  title: string
  url: string | null
  liveAt: number
  readings: StatsReading[]
}

/** Views about two days in: the reading closest to 48 hours, if one was taken between 24 and 96 hours. */
export function earlyViews(readings: StatsReading[]): number | null {
  let best: StatsReading | null = null
  for (const r of readings) {
    if (r.ageHours < 24 || r.ageHours > 96) continue
    if (!best || Math.abs(r.ageHours - 48) < Math.abs(best.ageHours - 48)) best = r
  }
  return best ? best.views : null
}

export function latestReading(readings: StatsReading[]): StatsReading | null {
  return readings.reduce<StatsReading | null>((a, r) => (!a || r.ageHours > a.ageHours ? r : a), null)
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

export interface HourBucket {
  /** Hour of day in the audience time zone, 0–23. */
  hour: number
  posts: number
  /** Median of views ÷ the account's usual views (1 = usual). Null when nothing was posted in this hour. */
  score: number | null
  medianViews: number | null
}

export interface WindowScore {
  start: string
  end: string
  posts: number
  score: number | null
}

export interface Insights {
  /** Live posts with a two-day view count. */
  measured: number
  /** Live posts still waiting for their two-day count. */
  waiting: number
  totalViews: number
  medianEarlyViews: number | null
  hours: HourBucket[]
  current: WindowScore
  /** A better window of the same length, when the data clearly points to one. */
  suggestion: (WindowScore & { lift: number }) | null
  enough: boolean
}

interface Scored {
  hour: number
  views: number
  score: number
}

/**
 * Which hours of the day did best. Each post's two-day views are divided by its account's median, so a big
 * YouTube channel and a new TikTok account can be compared; 1.0 means "as usual for that account".
 */
export function computeInsights(
  posts: InsightPost[],
  window: { timeZone: string; windowStart: string; windowEnd: string },
): Insights {
  const measured = posts.flatMap((p) => {
    const views = earlyViews(p.readings)
    return views === null ? [] : [{ post: p, views }]
  })
  const usual = new Map<string, number>()
  for (const accountId of new Set(measured.map((m) => m.post.accountId))) {
    usual.set(accountId, median(measured.filter((m) => m.post.accountId === accountId).map((m) => m.views)) ?? 0)
  }
  const scored: Scored[] = measured.map(({ post, views }) => {
    const { hour, minute } = zonedParts(post.liveAt, window.timeZone)
    const base = usual.get(post.accountId) ?? 0
    // An account whose usual is 0 views: any view is a win, none is usual.
    return { hour: hour + minute / 60, views, score: base > 0 ? views / base : views > 0 ? 2 : 1 }
  })

  const hours: HourBucket[] = Array.from({ length: 24 }, (_, hour) => {
    const inHour = scored.filter((s) => Math.floor(s.hour) === hour)
    return { hour, posts: inHour.length, score: median(inHour.map((s) => s.score)), medianViews: median(inHour.map((s) => s.views)) }
  })

  const scoreWindow = (startMin: number, endMin: number): WindowScore => {
    const inside = scored.filter((s) => s.hour * 60 >= startMin && s.hour * 60 <= endMin)
    return {
      start: formatClock(startMin),
      end: formatClock(endMin),
      posts: inside.length,
      score: inside.length >= INSIGHTS_MIN_WINDOW_POSTS ? median(inside.map((s) => s.score)) : null,
    }
  }

  const startMin = parseClock(window.windowStart)
  const endMin = parseClock(window.windowEnd)
  const current = scoreWindow(startMin, endMin)
  const enough = measured.length >= INSIGHTS_MIN_POSTS

  let suggestion: Insights['suggestion'] = null
  if (enough) {
    const length = Math.max(3 * 60, Math.round((endMin - startMin) / 60) * 60)
    let best: WindowScore | null = null
    for (let h = 0; h * 60 + length <= 23 * 60; h++) {
      const w = scoreWindow(h * 60, h * 60 + length)
      if (w.score !== null && (!best || w.score > best.score! || (w.score === best.score && w.posts > best.posts))) best = w
    }
    if (best && best.start !== current.start) {
      const lift = current.score ? best.score! / current.score - 1 : null
      if (lift === null || lift >= INSIGHTS_MIN_LIFT) suggestion = { ...best, lift: lift ?? 0 }
    }
  }

  return {
    measured: measured.length,
    waiting: posts.length - measured.length,
    totalViews: posts.reduce((sum, p) => sum + (latestReading(p.readings)?.views ?? 0), 0),
    medianEarlyViews: median(measured.map((m) => m.views)),
    hours,
    current,
    suggestion,
    enough,
  }
}
