// Safe to import from the browser: no Node or database dependencies.

export const SPREAD_MODES = ['edges', 'centred', 'custom'] as const
export type SpreadMode = (typeof SPREAD_MODES)[number]

export interface ScheduleDefaults {
  /** The audience's time zone; times are planned in it. */
  timeZone: string
  /** "HH:MM" in the audience time zone. */
  windowStart: string
  windowEnd: string
  mode: SpreadMode
  /** Shift each time by up to ± this many minutes, so posts don't land on round times. 0 = off. */
  jitterMin: number
  /** Warn when two posts to the same account are closer than this. */
  minGapMin: number
}

/**
 * US audience: the only market in the top two for both TikTok and YouTube. Weekday afternoons and evenings
 * are where the posting studies agree, so 12:00–21:00 Eastern, spread edge to edge.
 */
export const DEFAULT_SCHEDULE: ScheduleDefaults = {
  timeZone: 'America/New_York',
  windowStart: '12:00',
  windowEnd: '21:00',
  mode: 'edges',
  jitterMin: 0,
  minGapMin: 90,
}

export const COMMON_TIME_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Amsterdam',
  'Europe/Copenhagen',
  'Europe/Berlin',
  'Europe/Istanbul',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Jakarta',
  'Asia/Tokyo',
  'Australia/Sydney',
]

/** Minutes past midnight from "HH:MM". */
export function parseClock(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) throw new Error(`Not a time: ${hhmm}`)
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) throw new Error(`Not a time: ${hhmm}`)
  return h * 60 + min
}

export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

const partsCache = new Map<string, Intl.DateTimeFormat>()
function formatter(timeZone: string) {
  let f = partsCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partsCache.set(timeZone, f)
  }
  return f
}

/** The wall-clock date and time of an instant in a time zone. */
export function zonedParts(ms: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  return { year: +parts.year!, month: +parts.month!, day: +parts.day!, hour: +parts.hour! % 24, minute: +parts.minute! }
}

/** Offset of a time zone from UTC at an instant, in ms (e.g. −4 h for New York in summer). */
export function zoneOffset(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  return asUtc - Math.floor(ms / 60_000) * 60_000
}

/** The instant when the clock in `timeZone` shows date (YYYY-MM-DD) and `minutes` past midnight. */
export function zonedToUtc(date: string, minutes: number, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const guess = Date.UTC(y, m - 1, d, 0, 0) + minutes * 60_000
  // Two passes settle the offset across daylight-saving changes.
  let utc = guess - zoneOffset(guess, timeZone)
  utc = guess - zoneOffset(utc, timeZone)
  return utc
}

/** "YYYY-MM-DD" of an instant in a time zone. */
export function zonedDate(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function formatInZone(ms: number, timeZone: string, opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, ...opts }).format(new Date(ms))
}

/** A short zone label like "EDT" or "GMT+2". */
export function zoneLabel(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? timeZone
}

/** Deterministic pseudo-random numbers, so a plan's jitter doesn't change on every redraw. */
function seeded(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

export interface PlanInput {
  /** YYYY-MM-DD in the audience time zone. */
  date: string
  timeZone: string
  windowStart: string
  windowEnd: string
  count: number
  mode: SpreadMode
  jitterMin?: number
  /** Required for mode 'custom': "HH:MM" per post. */
  customTimes?: string[]
  /** Times before now + 15 min are moved forward (planning for today). */
  now?: number
  seed?: number
}

export interface PlanResult {
  /** Epoch ms per post, in order. */
  times: number[]
  /** Something to tell the user, e.g. that the window was shortened because part of today is over. */
  notes: string[]
}

const round5 = (m: number) => Math.round(m / 5) * 5

/**
 * When to post `count` items on one day.
 * - edges: the first at the window start, the last at its end, the rest evenly between (4 in 12–21 → 12, 15, 18, 21)
 * - centred: each in the middle of an equal slice (4 in 12–21 → 13:10, 15:25, 17:40, 19:55)
 * - custom: the given times
 * A single post goes at 15:00 if that's in the window, else the window's middle.
 */
export function planTimes(input: PlanInput): PlanResult {
  const notes: string[] = []
  if (input.count <= 0) return { times: [], notes }
  let start = parseClock(input.windowStart)
  const end = parseClock(input.windowEnd)
  if (end <= start) throw new Error('The window has to end after it starts')

  if (input.now !== undefined && zonedDate(input.now, input.timeZone) === input.date) {
    const p = zonedParts(input.now + 15 * 60_000, input.timeZone)
    const earliest = Math.ceil((p.hour * 60 + p.minute) / 5) * 5
    if (earliest > start) {
      if (earliest >= end) throw new Error('The posting window for today has already passed. Pick another day.')
      start = earliest
      notes.push(`Starts at ${formatClock(start)} because earlier times today have passed.`)
    }
  }

  let minutes: number[]
  if (input.mode === 'custom') {
    const custom = (input.customTimes ?? []).map(parseClock)
    if (custom.length !== input.count) throw new Error('Give one time per post')
    minutes = custom
  } else if (input.count === 1) {
    minutes = [15 * 60 >= start && 15 * 60 <= end ? 15 * 60 : round5((start + end) / 2)]
  } else if (input.mode === 'edges') {
    const step = (end - start) / (input.count - 1)
    minutes = Array.from({ length: input.count }, (_, i) => round5(start + i * step))
  } else {
    const step = (end - start) / input.count
    minutes = Array.from({ length: input.count }, (_, i) => round5(start + (i + 0.5) * step))
  }

  const jitter = input.jitterMin ?? 0
  if (jitter > 0 && input.mode !== 'custom') {
    const rand = seeded(input.seed ?? input.count * 7919 + start)
    minutes = minutes.map((m) => Math.min(end, Math.max(start, m + Math.round((rand() * 2 - 1) * jitter))))
  }
  return { times: minutes.map((m) => zonedToUtc(input.date, m, input.timeZone)), notes }
}

export interface ScheduleWarning {
  index: number
  message: string
}

/** Things worth a second look before confirming: posts too close together, and posts at night on this Mac. */
export function scheduleWarnings(
  items: { time: number; accountId: string; platform: 'youtube' | 'tiktok' }[],
  opts: { minGapMin: number; localTimeZone: string; existing?: { time: number; accountId: string }[] },
): ScheduleWarning[] {
  const out: ScheduleWarning[] = []
  items.forEach((item, i) => {
    const others = [...items.filter((_, j) => j !== i), ...(opts.existing ?? [])].filter((o) => o.accountId === item.accountId)
    const close = others.find((o) => Math.abs(o.time - item.time) < opts.minGapMin * 60_000)
    if (close) out.push({ index: i, message: `Less than ${opts.minGapMin} min from another post to the same account` })
    const hour = zonedParts(item.time, opts.localTimeZone).hour
    if (item.platform === 'tiktok' && (hour >= 23 || hour < 7)) {
      out.push({ index: i, message: `Needs this Mac awake at ${formatInZone(item.time, opts.localTimeZone)} your time` })
    }
  })
  return out
}
