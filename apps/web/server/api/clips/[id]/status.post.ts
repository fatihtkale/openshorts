import { z } from 'zod'

const body = z.object({ status: z.enum(['approved', 'rejected']) })

/** Removes a clip (marks it rejected, so Claude won't suggest it again) or brings it back. */
export default defineEventHandler(async (event) => {
  const { status } = await readValidatedBody(event, body.parse)
  const { clips } = useCore()
  const id = getRouterParam(event, 'id')!
  return withProjectErrors(() => {
    const clip = clips.require(id)
    if (clip.status === 'proposed') throw createError({ statusCode: 409, statusMessage: 'Decide on this clip in the Inbox' })
    clips.setStatus([id], status)
    return clips.require(id)
  })
})
