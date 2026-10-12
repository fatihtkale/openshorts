import { tiktokRevoke, youtubeRevoke } from '@clipstudio/social'

/** Disconnects an account: revokes its access at the platform (best effort) and deletes its tokens. */
export default defineEventHandler(async (event) => {
  const { accounts } = useCore()
  const id = getRouterParam(event, 'id')!
  await withProjectErrors(async () => {
    const account = accounts.require(id)
    try {
      const tokens = accounts.tokens(id)
      const app = apps()[account.platform]
      if (account.platform === 'youtube') await youtubeRevoke(tokens.refreshToken ?? tokens.accessToken)
      else if (app) await tiktokRevoke(app, tokens.accessToken)
    } catch {
      // Revoking is a courtesy; the tokens are deleted either way.
    }
    accounts.remove(id)
  })
  return { ok: true }
})
