import { editPostText, SocialError } from '@clipstudio/social'
import { z } from 'zod'

const body = z.object({
  title: z.string().max(2200),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().max(100)).max(30).optional(),
  relatedVideo: z.string().max(300).nullable().optional(),
})

/** New text for a post. For a video already on YouTube, the user's Save sends it there (the confirm is that click). */
export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body.parse)
  const core = useCore()
  try {
    return await withProjectErrors(() => editPostText({ posts: core.posts, accounts: core.accounts, apps: apps() }, getRouterParam(event, 'id')!, input))
  } catch (error) {
    if (error instanceof SocialError) throw createError({ statusCode: error.kind === 'forbidden' ? 409 : 502, statusMessage: error.message })
    throw error
  }
})
