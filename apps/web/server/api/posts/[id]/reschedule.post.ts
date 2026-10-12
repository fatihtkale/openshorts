import { z } from 'zod'

const body = z.object({ scheduledAt: z.number().nullable() })

/** Moves a post to a new time, or sends it now (scheduledAt: null). */
export default defineEventHandler(async (event) => {
  const { scheduledAt } = await readValidatedBody(event, body.parse)
  return withProjectErrors(() => useCore().posts.reschedule(getRouterParam(event, 'id')!, scheduledAt))
})
