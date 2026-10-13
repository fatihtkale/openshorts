import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { SocialError } from './errors'
import { challengeBase64Url } from './pkce'
import type { OAuthApp, Profile, TokenSet, UploadFile } from './types'

/** Base URLs, overridable so tests can point at a fake server. */
export interface YoutubeEndpoints {
  auth: string
  token: string
  revoke: string
  api: string
  upload: string
}

export const YOUTUBE_ENDPOINTS: YoutubeEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  api: 'https://www.googleapis.com/youtube/v3',
  upload: 'https://www.googleapis.com/upload/youtube/v3',
}

export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly']

export function youtubeAuthUrl(app: OAuthApp, state: string, verifier: string, ep = YOUTUBE_ENDPOINTS): string {
  const q = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: app.redirectUri,
    response_type: 'code',
    scope: YOUTUBE_SCOPES.join(' '),
    // Offline + consent so Google returns a refresh token every time.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: challengeBase64Url(verifier),
    code_challenge_method: 'S256',
  })
  return `${ep.auth}?${q}`
}

interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  error?: string
  error_description?: string
}

async function tokenRequest(params: Record<string, string>, ep: YoutubeEndpoints): Promise<GoogleTokenResponse> {
  const res = await fetch(ep.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  }).catch((e: Error) => {
    throw new SocialError(`Could not reach Google: ${e.message}`, 'network')
  })
  const body = (await res.json().catch(() => ({}))) as GoogleTokenResponse
  if (!res.ok || body.error) {
    const kind = body.error === 'invalid_grant' ? 'auth' : res.status >= 500 ? 'server' : 'invalid'
    throw new SocialError(
      kind === 'auth' ? 'Google no longer accepts this sign-in. Reconnect the YouTube account.' : `Google sign-in failed: ${body.error_description ?? body.error ?? res.status}`,
      kind,
    )
  }
  return body
}

function toTokens(r: GoogleTokenResponse, previousRefresh: string | null = null): TokenSet {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? previousRefresh,
    expiresAt: Date.now() + r.expires_in * 1000,
    refreshExpiresAt: null,
    scopes: (r.scope ?? '').split(' ').filter(Boolean),
  }
}

export async function youtubeExchangeCode(app: OAuthApp, code: string, verifier: string, ep = YOUTUBE_ENDPOINTS): Promise<TokenSet> {
  return toTokens(
    await tokenRequest(
      { code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: app.redirectUri, grant_type: 'authorization_code', code_verifier: verifier },
      ep,
    ),
  )
}

export async function youtubeRefresh(app: OAuthApp, refreshToken: string, ep = YOUTUBE_ENDPOINTS): Promise<TokenSet> {
  return toTokens(
    await tokenRequest({ client_id: app.clientId, client_secret: app.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }, ep),
    refreshToken,
  )
}

export async function youtubeRevoke(token: string, ep = YOUTUBE_ENDPOINTS): Promise<void> {
  await fetch(`${ep.revoke}?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined)
}

interface GoogleApiError {
  error?: { code?: number; message?: string; errors?: { reason?: string }[] }
}

/** Maps a YouTube API error to something a person can act on. */
export function youtubeError(status: number, body: GoogleApiError): SocialError {
  const reason = body.error?.errors?.[0]?.reason ?? ''
  const message = body.error?.message ?? `HTTP ${status}`
  if (status === 401) return new SocialError('The YouTube sign-in expired. Reconnect the account.', 'auth')
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
    return new SocialError("This app has used up today's YouTube upload quota. It resets at midnight Pacific time.", 'quota', false)
  }
  if (reason === 'uploadLimitExceeded') return new SocialError('This channel has reached its YouTube upload limit for now. Try again later.', 'quota', false)
  if (reason === 'youtubeSignupRequired') return new SocialError('This Google account has no YouTube channel yet. Create one on youtube.com first.', 'forbidden', false)
  if (status === 429 || reason === 'rateLimitExceeded') return new SocialError('YouTube is rate-limiting uploads. Retrying shortly.', 'rate')
  if (status >= 500) return new SocialError(`YouTube had a problem (${message}). Retrying shortly.`, 'server')
  if (status === 403) return new SocialError(`YouTube refused: ${message}`, 'forbidden', false)
  return new SocialError(`YouTube rejected the upload: ${message}`, 'invalid', false)
}

async function api<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } }).catch((e: Error) => {
    throw new SocialError(`Could not reach YouTube: ${e.message}`, 'network')
  })
  const body = (await res.json().catch(() => ({}))) as T & GoogleApiError
  if (!res.ok) throw youtubeError(res.status, body)
  return body
}

export async function youtubeProfile(token: string, ep = YOUTUBE_ENDPOINTS): Promise<Profile> {
  const data = await api<{ items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } } }[] }>(
    `${ep.api}/channels?part=snippet&mine=true`,
    token,
  )
  const channel = data.items?.[0]
  if (!channel) throw new SocialError('This Google account has no YouTube channel yet. Create one on youtube.com first.', 'forbidden', false)
  return {
    externalId: channel.id,
    displayName: channel.snippet.title,
    username: channel.snippet.customUrl ?? null,
    avatarUrl: channel.snippet.thumbnails?.default?.url ?? null,
  }
}

export interface YoutubeVideoMeta {
  title: string
  description: string
  tags: string[]
  privacy: 'private' | 'unlisted' | 'public'
  /** Scheduled publishing (YouTube does it); requires privacy 'private' until then. */
  publishAt?: string | null
  madeForKids: boolean
}

/**
 * Uploads a video with YouTube's resumable protocol: one request opens a session, a second sends the file.
 * Returns the new video's id.
 */
export async function youtubeUpload(
  token: string,
  file: UploadFile,
  meta: YoutubeVideoMeta,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void; endpoints?: YoutubeEndpoints } = {},
): Promise<{ videoId: string }> {
  const ep = opts.endpoints ?? YOUTUBE_ENDPOINTS
  const body = {
    snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: '22' },
    status: {
      privacyStatus: meta.publishAt ? 'private' : meta.privacy,
      ...(meta.publishAt ? { publishAt: meta.publishAt } : {}),
      selfDeclaredMadeForKids: meta.madeForKids,
    },
  }
  const start = await fetch(`${ep.upload}/videos?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(file.bytes),
      'X-Upload-Content-Type': file.mimeType,
    },
    body: JSON.stringify(body),
  }).catch((e: Error) => {
    if (opts.signal?.aborted) throw e
    throw new SocialError(`Could not reach YouTube: ${e.message}`, 'network')
  })
  if (!start.ok) throw youtubeError(start.status, (await start.json().catch(() => ({}))) as GoogleApiError)
  const location = start.headers.get('location')
  if (!location) throw new SocialError('YouTube did not open an upload session.', 'server')

  let sent = 0
  const stream = createReadStream(file.path)
  stream.on('data', (chunk) => {
    sent += chunk.length
    opts.onProgress?.(sent / file.bytes)
  })
  const put = await fetch(location, {
    method: 'PUT',
    signal: opts.signal,
    headers: { 'Content-Type': file.mimeType, 'Content-Length': String(file.bytes) },
    body: Readable.toWeb(stream) as ReadableStream,
    // Required by Node's fetch for a streamed body.
    duplex: 'half',
  } as RequestInit).catch((e: Error) => {
    if (opts.signal?.aborted) throw e
    throw new SocialError(`The upload to YouTube was interrupted: ${e.message}`, 'network')
  })
  const result = (await put.json().catch(() => ({}))) as { id?: string } & GoogleApiError
  if (!put.ok || !result.id) throw youtubeError(put.status, result)
  return { videoId: result.id }
}

export function youtubeVideoUrl(videoId: string): string {
  return `https://www.youtube.com/shorts/${videoId}`
}

export interface VideoStats {
  views: number
  likes: number | null
  comments: number | null
  shares: number | null
}

/** View, like and comment counts for up to 50 videos (needs the youtube.readonly scope). */
export async function youtubeStats(token: string, videoIds: string[], ep = YOUTUBE_ENDPOINTS): Promise<Map<string, VideoStats>> {
  const out = new Map<string, VideoStats>()
  if (!videoIds.length) return out
  const data = await api<{ items?: { id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(
    `${ep.api}/videos?part=statistics&id=${videoIds.slice(0, 50).map(encodeURIComponent).join(',')}`,
    token,
  )
  for (const item of data.items ?? []) {
    const s = item.statistics ?? {}
    const n = (v?: string) => (v === undefined ? null : Number(v))
    out.set(item.id, { views: Number(s.viewCount ?? 0), likes: n(s.likeCount), comments: n(s.commentCount), shares: null })
  }
  return out
}
