import { z } from 'zod'

const body = z.object({ name: z.string().min(1).max(200) })

export default defineEventHandler(async (event) => {
  const { name } = await readValidatedBody(event, body.parse)
  return withProjectErrors(() => useCore().projects.rename(getRouterParam(event, 'id')!, name))
})
