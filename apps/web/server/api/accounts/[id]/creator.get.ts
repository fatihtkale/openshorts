import { accessToken, SocialError, tiktokCreatorInfo } from '@clipstudio/social'

/** What this TikTok account may post right now (privacy choices, interaction settings, max length). */
export default defineEventHandler(async (event) => {
  const { accounts } = useCore()
  const id = getRouterParam(event, 'id')!
  const account = await withProjectErrors(() => accounts.require(id))
  if (account.platform !== 'tiktok') throw createError({ statusCode: 400, statusMessage: 'Only for TikTok accounts' })
  try {
    return await tiktokCreatorInfo(await accessToken(accounts, apps(), id))
  } catch (error) {
    if (error instanceof SocialError) throw createError({ statusCode: error.kind === 'auth' ? 401 : 502, statusMessage: error.message })
    throw error
  }
})
