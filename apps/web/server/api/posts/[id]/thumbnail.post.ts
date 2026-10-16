import { setPostThumbnail, SocialError } from '@clipstudio/social'

/**
 * Sets a YouTube video's custom thumbnail. The body is the image itself (Content-Type image/jpeg or image/png, ≤ 2 MB);
 * the user's click on "Set thumbnail" is the confirm.
 */
export default defineEventHandler(async (event) => {
  const image = await readRawBody(event, false)
  if (!image) throw createError({ statusCode: 400, statusMessage: 'Send the image as the request body' })
  const mimeType = (getRequestHeader(event, 'content-type') ?? '').split(';')[0]!.trim()
  const core = useCore()
  try {
    return await withProjectErrors(() => setPostThumbnail({ posts: core.posts, accounts: core.accounts, apps: apps() }, getRouterParam(event, 'id')!, Buffer.from(image), mimeType))
  } catch (error) {
    if (error instanceof SocialError) throw createError({ statusCode: error.kind === 'forbidden' || error.kind === 'invalid' ? 409 : 502, statusMessage: error.message })
    throw error
  }
})
