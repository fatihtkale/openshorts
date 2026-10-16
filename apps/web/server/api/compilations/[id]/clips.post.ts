import { z } from 'zod'

const body = z.object({ version: z.number().int(), clipIds: z.array(z.string()).min(1).max(100) })

/** Adds clips at the end, credited from their sources (clips already in it are skipped). */
export default defineEventHandler(async (event) => {
  const { version, clipIds } = await readValidatedBody(event, body.parse)
  const { compilations } = useCore()
  const id = getRouterParam(event, 'id')!
  return withProjectErrors(() => {
    const current = compilations.require(id)
    const have = new Set(current.items.map((i) => i.clipId))
    const added = compilations.itemsFor(clipIds.filter((c) => !have.has(c)))
    compilations.update(id, { items: [...current.items, ...added] }, version)
    return compilations.detail(id)
  })
})
