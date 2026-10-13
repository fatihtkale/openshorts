import { describe, expect, it } from 'vitest'
import { addDays, formatInZone, parseClock, planDays, planTimes, scheduleWarnings, zonedDate, zonedToUtc, zoneOffset } from './schedule'

const NY = 'America/New_York'
const at = (ms: number, tz = NY) => formatInZone(ms, tz)

describe('time zones', () => {
  it('converts wall-clock times in a zone to instants, across daylight saving', () => {
    // Summer: New York is UTC−4.
    expect(new Date(zonedToUtc('2026-07-10', parseClock('12:00'), NY)).toISOString()).toBe('2026-07-10T16:00:00.000Z')
    // Winter: UTC−5.
    expect(new Date(zonedToUtc('2026-12-10', parseClock('12:00'), NY)).toISOString()).toBe('2026-12-10T17:00:00.000Z')
    // The day the clocks go back (1 Nov 2026): noon is already EST.
    expect(new Date(zonedToUtc('2026-11-01', parseClock('12:00'), NY)).toISOString()).toBe('2026-11-01T17:00:00.000Z')
    expect(zoneOffset(Date.UTC(2026, 6, 10), 'Europe/Copenhagen')).toBe(2 * 3_600_000)
    expect(zonedDate(Date.UTC(2026, 6, 10, 3, 0), NY)).toBe('2026-07-09')
  })
})

describe('planTimes', () => {
  const base = { date: '2026-10-16', timeZone: NY, windowStart: '12:00', windowEnd: '21:00' }

  it('spreads edge to edge on round times', () => {
    expect(planTimes({ ...base, count: 4, mode: 'edges' }).times.map((t) => at(t))).toEqual(['12:00', '15:00', '18:00', '21:00'])
    expect(planTimes({ ...base, count: 3, mode: 'edges' }).times.map((t) => at(t))).toEqual(['12:00', '16:30', '21:00'])
    expect(planTimes({ ...base, count: 1, mode: 'edges' }).times.map((t) => at(t))).toEqual(['15:00'])
  })

  it('centres posts in equal slices', () => {
    expect(planTimes({ ...base, count: 4, mode: 'centred' }).times.map((t) => at(t))).toEqual(['13:10', '15:25', '17:40', '19:55'])
  })

  it('shows the same moments in another zone', () => {
    const times = planTimes({ ...base, count: 4, mode: 'edges' }).times
    expect(times.map((t) => at(t, 'Europe/Copenhagen'))).toEqual(['18:00', '21:00', '00:00', '03:00'])
  })

  it('uses custom times and keeps jitter inside the window, the same every time', () => {
    expect(planTimes({ ...base, count: 2, mode: 'custom', customTimes: ['09:30', '22:15'] }).times.map((t) => at(t))).toEqual(['09:30', '22:15'])
    const a = planTimes({ ...base, count: 4, mode: 'edges', jitterMin: 10, seed: 42 }).times
    const b = planTimes({ ...base, count: 4, mode: 'edges', jitterMin: 10, seed: 42 }).times
    expect(a).toEqual(b)
    const start = zonedToUtc(base.date, 12 * 60, NY)
    const end = zonedToUtc(base.date, 21 * 60, NY)
    expect(a.every((t) => t >= start && t <= end)).toBe(true)
    expect(a.some((t, i) => t !== planTimes({ ...base, count: 4, mode: 'edges' }).times[i])).toBe(true)
  })

  it('skips the part of today that has passed', () => {
    const now = zonedToUtc(base.date, parseClock('14:07'), NY)
    const plan = planTimes({ ...base, count: 3, mode: 'edges', now })
    expect(plan.times.map((t) => at(t))).toEqual(['14:25', '17:45', '21:00'])
    expect(plan.notes[0]).toMatch(/Starts at 14:25/)
    expect(() => planTimes({ ...base, count: 1, mode: 'edges', now: zonedToUtc(base.date, parseClock('20:50'), NY) })).toThrow(/already passed/)
  })

  it('rejects a backwards window', () => {
    expect(() => planTimes({ ...base, windowStart: '21:00', windowEnd: '12:00', count: 2, mode: 'edges' })).toThrow(/end after/)
  })
})

describe('planDays', () => {
  const base = { startDate: '2026-10-16', timeZone: NY, windowStart: '12:00', windowEnd: '21:00', mode: 'edges' as const }
  const show = (plan: { times: number[]; days: string[] }) => plan.times.map((t, i) => `${plan.days[i]!.slice(8)} ${at(t)}`)

  it('splits posts over days, at most perDay a day', () => {
    expect(show(planDays({ ...base, count: 7, perDay: 3 }))).toEqual([
      '16 12:00', '16 16:30', '16 21:00', '17 12:00', '17 16:30', '17 21:00', '18 15:00',
    ])
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('continues after the last scheduled post: fills its day, then the next days', () => {
    const last = zonedToUtc('2026-10-16', parseClock('16:30'), NY)
    // Room for one more on the 16th, at least 90 min after 16:30 (18:00–21:00 → its middle).
    expect(show(planDays({ ...base, count: 4, perDay: 3, after: { time: last, postsThatDay: 2, minGapMin: 90 } }))).toEqual([
      '16 19:30', '17 12:00', '17 16:30', '17 21:00',
    ])
    // A full day, or no room left in the window after the last post: the next day.
    expect(show(planDays({ ...base, count: 1, perDay: 3, after: { time: last, postsThatDay: 3, minGapMin: 90 } }))).toEqual(['17 15:00'])
    const late = zonedToUtc('2026-10-16', parseClock('20:00'), NY)
    expect(show(planDays({ ...base, count: 2, perDay: 3, after: { time: late, postsThatDay: 1, minGapMin: 90 } }))).toEqual(['17 12:00', '17 21:00'])
  })

  it("starts tomorrow when today's window is over", () => {
    const now = zonedToUtc('2026-10-16', parseClock('20:55'), NY)
    const plan = planDays({ ...base, count: 2, perDay: 3, now })
    expect(show(plan)).toEqual(['17 12:00', '17 21:00'])
    expect(plan.notes[0]).toMatch(/Starts 2026-10-17/)
  })

  it('applies custom times on the day each post falls on', () => {
    const plan = planDays({ ...base, mode: 'custom', count: 3, perDay: 2, customTimes: ['13:00', '19:00', '14:15'] })
    expect(show(plan)).toEqual(['16 13:00', '16 19:00', '17 14:15'])
  })
})

describe('scheduleWarnings', () => {
  it('flags close posts on the same account and TikTok posts at night here', () => {
    const t = zonedToUtc('2026-10-16', 21 * 60, NY)
    const warnings = scheduleWarnings(
      [
        { time: t, accountId: 'a', platform: 'tiktok' },
        { time: t + 30 * 60_000, accountId: 'a', platform: 'youtube' },
        { time: t, accountId: 'b', platform: 'youtube' },
      ],
      { minGapMin: 90, localTimeZone: 'Europe/Copenhagen' },
    )
    expect(warnings).toEqual([
      { index: 0, message: 'Less than 90 min from another post to the same account' },
      { index: 0, message: 'Needs this Mac awake at 03:00 your time' },
      { index: 1, message: 'Less than 90 min from another post to the same account' },
    ])
  })
})
