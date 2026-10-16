import { CREDIT_PLATFORMS } from '@clipstudio/core'
import { z } from 'zod'

const credit = z.object({ platform: z.enum(CREDIT_PLATFORMS), name: z.string().max(60), handle: z.string().max(60) })
const body = z.object({
  version: z.number().int(),
  title: z.string().max(100).optional(),
  items: z.array(z.object({ clipId: z.string(), credit })).max(100).optional(),
})

/** Saves the title, clip order and credits. The version guards against overwriting another tab. */
export default defineEventHandler(async (event) => {
  const { version, ...patch } = await readValidatedBody(event, body.parse)
  const { compilations } = useCore()
  const id = getRouterParam(event, 'id')!
  return withProjectErrors(() => {
    compilations.update(id, patch, version)
    return compilations.detail(id)
  })
})
