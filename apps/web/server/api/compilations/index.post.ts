import { z } from 'zod'

const body = z.object({ title: z.string().max(100), clipIds: z.array(z.string()).max(100).optional() })

/** Starts a compilation, optionally with clips already picked (credited from their sources). */
export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body.parse)
  return withProjectErrors(() => useCore().compilations.create(input))
})
