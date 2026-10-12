import { deleteSetting, getSetting } from '@clipstudio/core'
import { SocialError, tiktokExchangeCode, tiktokProfile, youtubeExchangeCode, youtubeProfile } from '@clipstudio/social'

/** The platform sends the browser back here with a code; we trade it for tokens and save the account. */
export default defineEventHandler(async (event) => {
  const platform = requirePlatform(getRouterParam(event, 'platform'))
  const q = getQuery(event)
  const back = (params: Record<string, string>) => sendRedirect(event, `/accounts?${new URLSearchParams(params)}`)

  if (q.error) return back({ error: String(q.error_description ?? q.error) })
  const state = String(q.state ?? '')
  const { db, accounts } = useCore()
  const pending = getSetting<{ platform: string; verifier: string; at: number }>(db, `${OAUTH_STATE_PREFIX}${state}`)
  if (state) deleteSetting(db, `${OAUTH_STATE_PREFIX}${state}`)
  if (!pending || pending.platform !== platform || Date.now() - pending.at > OAUTH_STATE_TTL_MS) {
    return back({ error: 'The sign-in expired or did not start here. Try connecting again.' })
  }
  const app = apps()[platform]
  if (!app || !q.code) return back({ error: 'Something was missing from the sign-in. Try again.' })

  try {
    const code = String(q.code)
    if (platform === 'youtube') {
      const tokens = await youtubeExchangeCode(app, code, pending.verifier)
      const profile = await youtubeProfile(tokens.accessToken)
      const account = accounts.connect('youtube', profile, tokens)
      return back({ connected: account.displayName })
    }
    const tokens = await tiktokExchangeCode(app, code, pending.verifier)
    if (!tokens.scopes.includes('video.publish') && !tokens.scopes.includes('video.upload')) {
      return back({ error: 'TikTok did not allow posting. Connect again and keep the posting permissions switched on.' })
    }
    const profile = await tiktokProfile(tokens.accessToken)
    const account = accounts.connect('tiktok', profile, tokens)
    return back({ connected: account.displayName })
  } catch (error) {
    return back({ error: error instanceof SocialError ? error.message : `Sign-in failed: ${(error as Error).message}` })
  }
})
