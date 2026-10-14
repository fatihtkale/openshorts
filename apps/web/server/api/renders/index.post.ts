import { z } from 'zod'

const body = z.object({ clipIds: z.array(z.string()).min(1).max(500) })

/** Exports several clips at once (the Clips page confirms first); unchanged exports are skipped. */
export default defineEventHandler(async (event) => {
  const { clipIds } = await readValidatedBody(event, body.parse)
  return withProjectErrors(() => useCore().renders.requestMany(clipIds))
})
