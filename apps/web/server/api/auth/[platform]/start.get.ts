import { setSetting } from '@clipstudio/core'
import { codeVerifier, randomState, tiktokAuthUrl, youtubeAuthUrl } from '@clipstudio/social'

/** Sends the browser to YouTube's or TikTok's sign-in page. */
export default defineEventHandler((event) => {
  const platform = requirePlatform(getRouterParam(event, 'platform'))
  const app = apps()[platform]
  if (!app) throw createError({ statusCode: 409, statusMessage: `${platform} is not set up yet. See Accounts for the steps.` })
  const state = randomState()
  const verifier = codeVerifier()
  setSetting(useCore().db, `${OAUTH_STATE_PREFIX}${state}`, { platform, verifier, at: Date.now() })
  return sendRedirect(event, platform === 'youtube' ? youtubeAuthUrl(app, state, verifier) : tiktokAuthUrl(app, state, verifier))
})
