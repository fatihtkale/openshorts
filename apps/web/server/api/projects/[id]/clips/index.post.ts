import { z } from 'zod'

const body = z.object({ startMs: z.number().min(0), endMs: z.number().positive(), title: z.string().min(1).max(120) })

/** A clip the user picked by hand in the transcript. */
export default defineEventHandler(async (event) => {
  const draft = await readValidatedBody(event, body.parse)
  return withProjectErrors(() => useCore().clips.createManual(getRouterParam(event, 'id')!, draft))
})
