import { z } from 'zod'

const body = z.object({
  updatedAt: z.number(),
  edits: z.array(z.object({ index: z.number().int().min(0), text: z.string().max(200) })).min(1).max(5000),
})

/** Saves corrected words. Timings stay as they were. */
export default defineEventHandler(async (event) => {
  const { edits, updatedAt } = await readValidatedBody(event, body.parse)
  return withProjectErrors(() => useCore().transcripts.edit(getRouterParam(event, 'id')!, edits, updatedAt))
})
