/** Connected accounts, plus which platforms are set up in .env (and the redirect address to register). */
export default defineEventHandler(() => {
  const a = apps()
  return {
    accounts: useCore().accounts.list(),
    platforms: {
      youtube: { configured: !!a.youtube, redirectUri: `${appUrl()}/api/auth/youtube/callback` },
      tiktok: { configured: !!a.tiktok, redirectUri: `${appUrl()}/api/auth/tiktok/callback` },
    },
  }
})
