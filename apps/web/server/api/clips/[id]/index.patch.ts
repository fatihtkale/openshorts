import { z } from 'zod'

const body = z.object({ title: z.string().min(1).max(120) })

export default defineEventHandler(async (event) => {
  const { title } = await readValidatedBody(event, body.parse)
  return withProjectErrors(() => useCore().clips.rename(getRouterParam(event, 'id')!, title))
})
