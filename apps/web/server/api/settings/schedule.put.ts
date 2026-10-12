import { SPREAD_MODES, setSetting } from '@clipstudio/core'
import { z } from 'zod'

const clock = z.string().regex(/^\d{2}:\d{2}$/)
const body = z.object({
  timeZone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz })
      return true
    } catch {
      return false
    }
  }, 'Unknown time zone'),
  windowStart: clock,
  windowEnd: clock,
  mode: z.enum(SPREAD_MODES),
  jitterMin: z.number().int().min(0).max(60),
  minGapMin: z.number().int().min(0).max(600),
})

/** Saves the posting defaults the scheduler starts from. */
export default defineEventHandler(async (event) => {
  const value = await readValidatedBody(event, body.parse)
  if (value.windowEnd <= value.windowStart) throw createError({ statusCode: 400, statusMessage: 'The window has to end after it starts' })
  setSetting(useCore().db, 'schedule.defaults', value)
  return value
})
