import { reschedulePost, SocialError } from '@clipstudio/social'
import { z } from 'zod'

const body = z.object({ scheduledAt: z.number().nullable() })

/**
 * Moves a post to a new time, or sends it now (scheduledAt: null). A video already scheduled on YouTube gets the new
 * publish time there too (the confirm is the user's Move click).
 */
export default defineEventHandler(async (event) => {
  const { scheduledAt } = await readValidatedBody(event, body.parse)
  const core = useCore()
  try {
    return await withProjectErrors(() => reschedulePost({ posts: core.posts, accounts: core.accounts, apps: apps() }, getRouterParam(event, 'id')!, scheduledAt))
  } catch (error) {
    if (error instanceof SocialError) {
      throw createError({ statusCode: error.kind === 'forbidden' ? 409 : error.kind === 'invalid' ? 400 : 502, statusMessage: error.message })
    }
    throw error
  }
})
