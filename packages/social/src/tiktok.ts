import { open } from 'node:fs/promises'
import { SocialError, type SocialErrorKind } from './errors'
import { challengeHex } from './pkce'
import type { OAuthApp, Profile, TokenSet, UploadFile } from './types'

export interface TiktokEndpoints {
  auth: string
  api: string
}

export const TIKTOK_ENDPOINTS: TiktokEndpoints = {
  auth: 'https://www.tiktok.com/v2/auth/authorize/',
  api: 'https://open.tiktokapis.com',
}

export const TIKTOK_SCOPES = ['user.info.basic', 'video.publish', 'video.upload']

export const TIKTOK_PRIVACY = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'] as const
export type TiktokPrivacy = (typeof TIKTOK_PRIVACY)[number]

/** Login Kit for Desktop: localhost redirects, with PKCE (TikTok hashes the challenge as hex). */
export function tiktokAuthUrl(app: OAuthApp, state: string, verifier: string, ep = TIKTOK_ENDPOINTS): string {
  const q = new URLSearchParams({
    client_key: app.clientId,
    scope: TIKTOK_SCOPES.join(','),
    redirect_uri: app.redirectUri,
    state,
    response_type: 'code',
    code_challenge: challengeHex(verifier),
    code_challenge_method: 'S256',
  })
  return `${ep.auth}?${q}`
}

interface TiktokTokenResponse {
  access_token?: string
  expires_in?: number
  open_id?: string
  refresh_token?: string
  refresh_expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

async function tokenRequest(params: Record<string, string>, ep: TiktokEndpoints): Promise<TokenSet & { openId: string }> {
  const res = await fetch(`${ep.api}/v2/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  }).catch((e: Error) => {
    throw new SocialError(`Could not reach TikTok: ${e.message}`, 'network')
  })
  const body = (await res.json().catch(() => ({}))) as TiktokTokenResponse
  if (!res.ok || body.error || !body.access_token) {
    const kind: SocialErrorKind = body.error === 'invalid_grant' ? 'auth' : res.status >= 500 ? 'server' : 'invalid'
    throw new SocialError(
      kind === 'auth' ? 'TikTok no longer accepts this sign-in. Reconnect the TikTok account.' : `TikTok sign-in failed: ${body.error_description ?? body.error ?? res.status}`,
      kind,
    )
  }
  const now = Date.now()
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: now + (body.expires_in ?? 86_400) * 1000,
    refreshExpiresAt: body.refresh_expires_in ? now + body.refresh_expires_in * 1000 : null,
    scopes: (body.scope ?? '').split(',').filter(Boolean),
    openId: body.open_id ?? '',
  }
}

export function tiktokExchangeCode(app: OAuthApp, code: string, verifier: string, ep = TIKTOK_ENDPOINTS) {
  return tokenRequest(
    {
      client_key: app.clientId,
      client_secret: app.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: app.redirectUri,
      code_verifier: verifier,
    },
    ep,
  )
}

export function tiktokRefresh(app: OAuthApp, refreshToken: string, ep = TIKTOK_ENDPOINTS) {
  return tokenRequest({ client_key: app.clientId, client_secret: app.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }, ep)
}

export async function tiktokRevoke(app: OAuthApp, token: string, ep = TIKTOK_ENDPOINTS): Promise<void> {
  await fetch(`${ep.api}/v2/oauth/revoke/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: app.clientId, client_secret: app.clientSecret, token }),
  }).catch(() => undefined)
}

/** Maps TikTok's error codes to something a person can act on. */
export function tiktokError(status: number, code: string, message: string): SocialError {
  switch (code) {
    case 'access_token_invalid':
      return new SocialError('The TikTok sign-in expired. Reconnect the account.', 'auth')
    case 'scope_not_authorized':
      return new SocialError('TikTok did not grant posting permission. Reconnect and allow posting.', 'auth')
    case 'unaudited_client_can_only_post_to_private_accounts':
      return new SocialError(
        "TikTok hasn't approved this app yet, so it can only post to a private account, as “Only me”. Set the account to private, or send it as a draft.",
        'forbidden',
        false,
      )
    case 'privacy_level_option_mismatch':
      return new SocialError('That privacy setting is not available for this account. Pick another one.', 'invalid', false)
    case 'spam_risk_too_many_posts':
      return new SocialError('TikTok says this account has posted too much today. Try again tomorrow.', 'quota', false)
    case 'spam_risk_user_banned_from_posting':
      return new SocialError('TikTok has blocked this account from posting.', 'forbidden', false)
    case 'reached_active_user_cap':
      return new SocialError("This TikTok app has reached its daily user limit. Try again tomorrow.", 'quota', false)
    case 'rate_limit_exceeded':
      return new SocialError('TikTok is rate-limiting requests. Retrying shortly.', 'rate')
  }
  if (status >= 500) return new SocialError(`TikTok had a problem (${message || status}). Retrying shortly.`, 'server')
  return new SocialError(`TikTok refused: ${message || code || status}`, status === 401 ? 'auth' : 'invalid', false)
}

async function call<T>(ep: TiktokEndpoints, path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${ep.api}${path}`, {
    method: init.method ?? 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).catch((e: Error) => {
    throw new SocialError(`Could not reach TikTok: ${e.message}`, 'network')
  })
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string } }
  const code = body.error?.code ?? (res.ok ? 'ok' : '')
  if (!res.ok || code !== 'ok') throw tiktokError(res.status, code, body.error?.message ?? '')
  return body.data as T
}

export async function tiktokProfile(token: string, ep = TIKTOK_ENDPOINTS): Promise<Profile> {
  const data = await call<{ user: { open_id: string; display_name?: string; avatar_url?: string } }>(
    ep,
    '/v2/user/info/?fields=open_id,avatar_url,display_name',
    token,
    { method: 'GET' },
  )
  return { externalId: data.user.open_id, displayName: data.user.display_name ?? 'TikTok account', username: null, avatarUrl: data.user.avatar_url ?? null }
}

export interface CreatorInfo {
  username: string
  nickname: string
  avatarUrl: string | null
  privacyOptions: TiktokPrivacy[]
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
  maxDurationSec: number
}

/** What this creator may post right now. TikTok requires asking before every post. */
export async function tiktokCreatorInfo(token: string, ep = TIKTOK_ENDPOINTS): Promise<CreatorInfo> {
  const d = await call<{
    creator_username: string
    creator_nickname: string
    creator_avatar_url?: string
    privacy_level_options: TiktokPrivacy[]
    comment_disabled: boolean
    duet_disabled: boolean
    stitch_disabled: boolean
    max_video_post_duration_sec: number
  }>(ep, '/v2/post/publish/creator_info/query/', token, { body: {} })
  return {
    username: d.creator_username,
    nickname: d.creator_nickname,
    avatarUrl: d.creator_avatar_url ?? null,
    privacyOptions: d.privacy_level_options,
    commentDisabled: d.comment_disabled,
    duetDisabled: d.duet_disabled,
    stitchDisabled: d.stitch_disabled,
    maxDurationSec: d.max_video_post_duration_sec,
  }
}

const MB = 1024 * 1024

/**
 * TikTok's chunking rules: chunks of 5–64 MB in order; the last one absorbs the remainder (up to 128 MB);
 * a file under 5 MB goes in one piece. The chunk count is size / chunk size, rounded down.
 * Files up to 64 MB go in one piece too (a chunk may never be larger than the file).
 */
export function tiktokChunks(bytes: number, preferred = 10 * MB): { chunkSize: number; count: number; ranges: [number, number][] } {
  const chunkSize = bytes <= 64 * MB ? bytes : Math.min(64 * MB, Math.max(5 * MB, preferred))
  const count = Math.max(1, Math.floor(bytes / chunkSize))
  const ranges: [number, number][] = []
  for (let i = 0; i < count; i++) {
    const start = i * chunkSize
    const end = i === count - 1 ? bytes - 1 : start + chunkSize - 1
    ranges.push([start, end])
  }
  return { chunkSize, count, ranges }
}

export interface TiktokPostInfo {
  title: string
  privacy: TiktokPrivacy
  disableComment: boolean
  disableDuet: boolean
  disableStitch: boolean
  coverTimestampMs: number
  /** Promoting a third party (paid partnership). */
  brandContent: boolean
  /** Promoting your own business. */
  brandOrganic: boolean
  aiGenerated: boolean
}

/**
 * Posts a video: straight to the profile ("direct"), or to the creator's TikTok inbox as a draft to finish in the app.
 * Returns the publish id to poll.
 */
export async function tiktokPublish(
  token: string,
  file: UploadFile,
  mode: 'direct' | 'draft',
  post: TiktokPostInfo | null,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void; endpoints?: TiktokEndpoints } = {},
): Promise<{ publishId: string }> {
  const ep = opts.endpoints ?? TIKTOK_ENDPOINTS
  const chunks = tiktokChunks(file.bytes)
  const source_info = { source: 'FILE_UPLOAD', video_size: file.bytes, chunk_size: chunks.chunkSize, total_chunk_count: chunks.count }
  const init =
    mode === 'direct' && post
      ? await call<{ publish_id: string; upload_url: string }>(ep, '/v2/post/publish/video/init/', token, {
          body: {
            post_info: {
              title: post.title,
              privacy_level: post.privacy,
              disable_comment: post.disableComment,
              disable_duet: post.disableDuet,
              disable_stitch: post.disableStitch,
              video_cover_timestamp_ms: post.coverTimestampMs,
              brand_content_toggle: post.brandContent,
              brand_organic_toggle: post.brandOrganic,
              is_aigc: post.aiGenerated,
            },
            source_info,
          },
        })
      : await call<{ publish_id: string; upload_url: string }>(ep, '/v2/post/publish/inbox/video/init/', token, { body: { source_info } })

  const handle = await open(file.path, 'r')
  try {
    for (const [start, end] of chunks.ranges) {
      if (opts.signal?.aborted) throw new Error('Stopped')
      const length = end - start + 1
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, start)
      const res = await fetch(init.upload_url, {
        method: 'PUT',
        signal: opts.signal,
        headers: { 'Content-Type': file.mimeType, 'Content-Length': String(length), 'Content-Range': `bytes ${start}-${end}/${file.bytes}` },
        body: buffer,
      }).catch((e: Error) => {
        if (opts.signal?.aborted) throw e
        throw new SocialError(`The upload to TikTok was interrupted: ${e.message}`, 'network')
      })
      if (res.status !== 206 && res.status !== 201 && res.status !== 200) {
        if (res.status === 403) throw new SocialError('The TikTok upload link expired. Retrying starts a new upload.', 'server')
        throw new SocialError(`TikTok rejected part of the upload (HTTP ${res.status}).`, res.status >= 500 ? 'server' : 'invalid')
      }
      opts.onProgress?.((end + 1) / file.bytes)
    }
  } finally {
    await handle.close()
  }
  return { publishId: init.publish_id }
}

export type TiktokPublishState = 'PROCESSING_UPLOAD' | 'PROCESSING_DOWNLOAD' | 'SEND_TO_USER_INBOX' | 'PUBLISH_COMPLETE' | 'FAILED'

export async function tiktokStatus(
  token: string,
  publishId: string,
  ep = TIKTOK_ENDPOINTS,
): Promise<{ status: TiktokPublishState; failReason: string | null; postIds: string[] }> {
  const d = await call<{ status: TiktokPublishState; fail_reason?: string; publicaly_available_post_id?: (number | string)[] }>(
    ep,
    '/v2/post/publish/status/fetch/',
    token,
    { body: { publish_id: publishId } },
  )
  return { status: d.status, failReason: d.fail_reason ?? null, postIds: (d.publicaly_available_post_id ?? []).map(String) }
}

export function tiktokVideoUrl(username: string, postId: string): string {
  return `https://www.tiktok.com/@${username}/video/${postId}`
}
