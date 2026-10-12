import { z } from 'zod'

const body = z.object({ decisions: z.array(z.object({ clipId: z.string(), approve: z.boolean() })).min(1).max(100) })

/** Approves or rejects clips in a proposal. */
export default defineEventHandler(async (event) => {
  const { decisions } = await readValidatedBody(event, body.parse)
  return withProjectErrors(() => useCore().proposals.decideClips(getRouterParam(event, 'id')!, decisions))
})
