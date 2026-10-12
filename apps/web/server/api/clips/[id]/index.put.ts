import { z } from 'zod'

const body = z.object({
  version: z.number().int(),
  title: z.string().max(120).optional(),
  startMs: z.number().min(0).optional(),
  endMs: z.number().positive().optional(),
  edit: z.unknown().optional(),
})

/** Saves the editor's changes (validated in ClipService); the version guards against overwriting another tab. */
export default defineEventHandler(async (event) => {
  const { version, ...patch } = await readValidatedBody(event, body.parse)
  return withProjectErrors(() => useCore().clips.update(getRouterParam(event, 'id')!, patch, version))
})
