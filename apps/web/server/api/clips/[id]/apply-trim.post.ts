import { z } from 'zod'

/** Applies the evaluation's suggested trim (from the Inbox; the editor applies it as an undoable edit instead). */
export default defineEventHandler(async (event) => {
  const { version } = await readValidatedBody(event, z.object({ version: z.number().int() }).parse)
  return withProjectErrors(() => useCore().clips.applySuggestedTrim(getRouterParam(event, 'id')!, version))
})
