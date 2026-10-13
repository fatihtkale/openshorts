import { z } from 'zod'

const body = z.object({
  startMs: z.number().min(0),
  endMs: z.number().positive(),
  title: z.string().min(1).max(120),
  /** Parts to leave out (source ms), from the highlights editor. */
  cuts: z.array(z.object({ start: z.number().min(0), end: z.number().positive() })).max(100).optional(),
})

/** A clip the user picked by hand (in the transcript or the highlights editor). */
export default defineEventHandler(async (event) => {
  const draft = await readValidatedBody(event, body.parse)
  return withProjectErrors(() => useCore().clips.createManual(getRouterParam(event, 'id')!, draft))
})
