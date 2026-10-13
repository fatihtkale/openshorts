import { SocialError } from './errors'

/**
 * Twitch's Helix API with an app token (client credentials): public data only, no user sign-in.
 * Used to find which moments of a VOD viewers clipped, the strongest highlight signal a stream has.
 */
export interface TwitchApp {
  clientId: string
  clientSecret: string
}

export interface TwitchApiEndpoints {
  token: string
  api: string
}

export const TWITCH_API_ENDPOINTS: TwitchApiEndpoints = {
  token: 'https://id.twitch.tv/oauth2/token',
  api: 'https://api.twitch.tv/helix',
}

let cached: { clientId: string; token: string; expiresAt: number } | null = null

/** For tests. */
export function resetTwitchToken(): void {
  cached = null
}

async function appToken(app: TwitchApp, ep: TwitchApiEndpoints): Promise<string> {
  if (cached && cached.clientId === app.clientId && cached.expiresAt - Date.now() > 60_000) return cached.token
  const body = new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, grant_type: 'client_credentials' })
  const res = await fetch(ep.token, { method: 'POST', body }).catch((e: Error) => {
    throw new SocialError(`Could not reach Twitch: ${e.message}`, 'network')
  })
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; message?: string }
  if (!res.ok || !data.access_token) {
    throw new SocialError(
      res.status === 400 || res.status === 403
        ? 'Twitch refused the app credentials. Check TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in .env.'
        : `Twitch sign-in failed: ${data.message ?? res.status}`,
      res.status >= 500 ? 'server' : 'auth',
      res.status >= 500,
    )
  }
  cached = { clientId: app.clientId, token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 }
  return data.access_token
}

/** Throws a readable SocialError when Twitch refuses the app's ID/secret (used by `pnpm checkup`). */
export async function checkTwitchApp(app: TwitchApp, ep = TWITCH_API_ENDPOINTS): Promise<void> {
  await appToken(app, ep)
}

async function helix<T>(app: TwitchApp, path: string, ep: TwitchApiEndpoints, retried = false): Promise<T> {
  const token = await appToken(app, ep)
  const res = await fetch(`${ep.api}${path}`, { headers: { 'Client-Id': app.clientId, Authorization: `Bearer ${token}` } }).catch((e: Error) => {
    throw new SocialError(`Could not reach Twitch: ${e.message}`, 'network')
  })
  if (res.status === 401 && !retried) {
    cached = null
    return helix(app, path, ep, true)
  }
  const data = (await res.json().catch(() => ({}))) as T & { message?: string }
  if (res.status === 429) throw new SocialError('Twitch is rate-limiting requests. Try again in a minute.', 'rate')
  if (!res.ok) throw new SocialError(`Twitch API error: ${data.message ?? res.status}`, res.status >= 500 ? 'server' : 'invalid', res.status >= 500)
  return data
}

/** "3h2m1s" → seconds. */
export function parseTwitchDuration(text: string): number {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text)
  if (!m) return 0
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

export interface TwitchVod {
  /** Numeric id, without the "v". */
  id: string
  userId: string
  userLogin: string
  title: string
  createdAt: number
  durationSec: number
}

export async function twitchVod(app: TwitchApp, vodId: string, ep = TWITCH_API_ENDPOINTS): Promise<TwitchVod | null> {
  const id = vodId.replace(/^v/, '')
  const data = await helix<{ data?: { id: string; user_id: string; user_login: string; title: string; created_at: string; duration: string }[] }>(
    app,
    `/videos?id=${encodeURIComponent(id)}`,
    ep,
  )
  const v = data.data?.[0]
  if (!v) return null
  return { id: v.id, userId: v.user_id, userLogin: v.user_login, title: v.title, createdAt: Date.parse(v.created_at), durationSec: parseTwitchDuration(v.duration) }
}

/** A clip a viewer made from the VOD, with where it sits in the VOD. */
export interface ViewerClip {
  id: string
  title: string
  url: string
  viewCount: number
  /** Seconds into the VOD where the clip starts; null when Twitch doesn't know (rare). */
  vodOffsetSec: number | null
  durationSec: number
  createdAt: number
  creatorName: string
}

/** Clips can be made from a VOD for as long as it exists; Twitch keeps VODs at most 60 days. */
const CLIP_WINDOW_MS = 60 * 86_400_000

/** All clips viewers made from this VOD (most viewed first), up to `max`. */
export async function twitchVodClips(app: TwitchApp, vod: TwitchVod, ep = TWITCH_API_ENDPOINTS, max = 500): Promise<ViewerClip[]> {
  const out: ViewerClip[] = []
  const started = new Date(vod.createdAt).toISOString()
  const ended = new Date(Math.min(Date.now(), vod.createdAt + CLIP_WINDOW_MS)).toISOString()
  let cursor: string | undefined
  for (let page = 0; page < 20 && out.length < max; page++) {
    const q = new URLSearchParams({ broadcaster_id: vod.userId, started_at: started, ended_at: ended, first: '100' })
    if (cursor) q.set('after', cursor)
    const data = await helix<{
      data?: { id: string; url: string; title: string; view_count: number; video_id: string; vod_offset: number | null; duration: number; created_at: string; creator_name: string }[]
      pagination?: { cursor?: string }
    }>(app, `/clips?${q}`, ep)
    for (const c of data.data ?? []) {
      if (c.video_id !== vod.id) continue
      out.push({
        id: c.id,
        title: c.title,
        url: c.url,
        viewCount: c.view_count,
        vodOffsetSec: typeof c.vod_offset === 'number' ? c.vod_offset : null,
        durationSec: c.duration,
        createdAt: Date.parse(c.created_at),
        creatorName: c.creator_name,
      })
    }
    cursor = data.pagination?.cursor
    if (!cursor) break
  }
  return out.sort((a, b) => b.viewCount - a.viewCount).slice(0, max)
}
