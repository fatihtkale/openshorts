import { MISSED_AFTER_MS, type AccountRow, type AccountService, type AppConfig, type PostRow, type PostService } from '@clipstudio/core'
import { SocialError } from './errors'
import {
  TIKTOK_ENDPOINTS,
  tiktokCreatorInfo,
  tiktokPublish,
  tiktokRefresh,
  tiktokStatus,
  tiktokVideoUrl,
  type TiktokEndpoints,
} from './tiktok'
import type { OAuthApp, UploadFile } from './types'
import { YOUTUBE_ENDPOINTS, youtubeRefresh, youtubeUpload, youtubeVideoUrl, type YoutubeEndpoints } from './youtube'

export interface SocialApps {
  youtube: OAuthApp | null
  tiktok: OAuthApp | null
}

/** The platform apps from config; each redirects back to /api/auth/<platform>/callback. */
export function socialApps(config: Pick<AppConfig, 'appUrl' | 'social'>): SocialApps {
  const app = (p: 'youtube' | 'tiktok') => {
    const creds = config.social[p]
    return creds ? { ...creds, redirectUri: `${config.appUrl}/api/auth/${p}/callback` } : null
  }
  return { youtube: app('youtube'), tiktok: app('tiktok') }
}

export interface Endpoints {
  youtube?: YoutubeEndpoints
  tiktok?: TiktokEndpoints
}

/**
 * A usable access token for an account, refreshed when it expires within two minutes.
 * If the platform rejects the refresh, the account is marked as needing a reconnect.
 */
export async function accessToken(accounts: AccountService, apps: SocialApps, accountId: string, ep: Endpoints = {}): Promise<string> {
  const account = accounts.require(accountId)
  const tokens = accounts.tokens(accountId)
  if (tokens.expiresAt - Date.now() > 120_000) return tokens.accessToken
  const app = apps[account.platform]
  if (!app) throw new SocialError(`${account.platform === 'youtube' ? 'YouTube' : 'TikTok'} is not set up in .env any more.`, 'auth', false)
  if (!tokens.refreshToken) {
    accounts.markNeedsReconnect(accountId)
    throw new SocialError(`Reconnect ${account.displayName}: the sign-in expired.`, 'auth', false)
  }
  try {
    const fresh =
      account.platform === 'youtube'
        ? await youtubeRefresh(app, tokens.refreshToken, ep.youtube ?? YOUTUBE_ENDPOINTS)
        : await tiktokRefresh(app, tokens.refreshToken, ep.tiktok ?? TIKTOK_ENDPOINTS)
    accounts.saveTokens(accountId, {
      accessToken: fresh.accessToken,
      refreshToken: fresh.refreshToken ?? tokens.refreshToken,
      expiresAt: fresh.expiresAt,
      refreshExpiresAt: fresh.refreshExpiresAt ?? tokens.refreshExpiresAt,
      scopes: fresh.scopes.length ? fresh.scopes : tokens.scopes,
    })
    return fresh.accessToken
  } catch (error) {
    if (error instanceof SocialError && error.kind === 'auth') accounts.markNeedsReconnect(accountId)
    throw error
  }
}

export interface PublishDeps {
  posts: PostService
  accounts: AccountService
  apps: SocialApps
  endpoints?: Endpoints
  /** How long to wait between TikTok status checks (tests make it short). */
  pollMs?: number
  /** Give up waiting for TikTok after this long. */
  pollTimeoutMs?: number
}

/**
 * Sends one post: uploads the file, then records where it ended up.
 * YouTube: the video exists as soon as the upload finishes. TikTok: it processes after upload, so we poll.
 */
export async function publishPost(
  deps: PublishDeps,
  postId: string,
  file: UploadFile,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number, message: string) => void } = {},
): Promise<{ status: 'published' | 'sent_to_inbox' | 'scheduled' | 'missed'; url: string | null }> {
  try {
    return await sendPost(deps, postId, file, opts)
  } catch (error) {
    // The platform refused the sign-in mid-post: flag the account so the UI asks to reconnect.
    const accountId = deps.posts.get(postId)?.accountId
    if (error instanceof SocialError && error.kind === 'auth' && accountId && deps.accounts.get(accountId)) deps.accounts.markNeedsReconnect(accountId)
    throw error
  }
}

async function sendPost(
  deps: PublishDeps,
  postId: string,
  file: UploadFile,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number, message: string) => void } = {},
): Promise<{ status: 'published' | 'sent_to_inbox' | 'scheduled' | 'missed'; url: string | null }> {
  const { posts, accounts, apps } = deps
  const post = posts.get(postId)
  if (!post) throw new Error('This post no longer exists.')
  if (!post.accountId) throw new SocialError('The account for this post was disconnected.', 'auth', false)
  if (post.status === 'published' || post.status === 'sent_to_inbox' || post.status === 'scheduled') {
    return { status: post.status, url: post.url }
  }
  // Too late: never post silently hours after the planned time; the user decides (post now, reschedule, skip).
  if (post.scheduledAt && post.status === 'queued') {
    const at = post.scheduledAt.getTime()
    const tooLate = post.platform === 'tiktok' ? Date.now() - at > MISSED_AFTER_MS : at < Date.now() + 60_000
    if (tooLate) {
      posts.setStatus(postId, 'missed', { error: null })
      return { status: 'missed', url: null }
    }
  }
  const account = accounts.require(post.accountId)
  const token = await accessToken(accounts, apps, account.id, deps.endpoints)

  const scheduledFor = post.scheduledAt && post.scheduledAt.getTime() > Date.now() ? post.scheduledAt : null

  if (post.platform === 'youtube') {
    posts.setStatus(postId, 'uploading', { error: null })
    const yt = post.youtube!
    const { videoId } = await youtubeUpload(
      token,
      file,
      {
        title: post.title,
        description: post.description,
        tags: yt.tags,
        privacy: yt.privacy,
        publishAt: scheduledFor ? scheduledFor.toISOString() : null,
        madeForKids: yt.madeForKids,
      },
      { signal: opts.signal, onProgress: (f) => opts.onProgress?.(f * 0.98, 'Uploading to YouTube'), endpoints: deps.endpoints?.youtube },
    )
    const url = youtubeVideoUrl(videoId, file.longForm)
    const status = scheduledFor ? 'scheduled' : 'published'
    posts.setStatus(postId, status, { remoteId: videoId, url, publishedAt: status === 'published' ? new Date() : null })
    return { status, url }
  }

  return publishToTiktok(deps, post, account, token, file, opts)
}

async function publishToTiktok(
  deps: PublishDeps,
  post: PostRow,
  account: AccountRow,
  token: string,
  file: UploadFile,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number, message: string) => void },
): Promise<{ status: 'published' | 'sent_to_inbox'; url: string | null }> {
  const { posts, accounts, apps } = deps
  const tt = post.tiktok!
  const ep = deps.endpoints?.tiktok ?? TIKTOK_ENDPOINTS
  // TikTok requires asking what this creator may post right before every post.
  const creator = await tiktokCreatorInfo(token, ep)

  // Uploaded on an earlier try: only wait for TikTok to finish. Never upload twice.
  let publishId = post.status === 'processing' ? post.remoteId : null
  if (!publishId) {
    if (tt.mode === 'direct' && tt.privacy && !creator.privacyOptions.includes(tt.privacy)) {
      throw new SocialError('That privacy setting is no longer available for this account. Post again and pick another one.', 'invalid', false)
    }
    posts.setStatus(post.id, 'uploading', { error: null })
    const result = await tiktokPublish(
      token,
      file,
      tt.mode,
      tt.mode === 'direct'
        ? {
            title: post.title,
            privacy: tt.privacy!,
            disableComment: !tt.allowComments || creator.commentDisabled,
            disableDuet: !tt.allowDuet || creator.duetDisabled,
            disableStitch: !tt.allowStitch || creator.stitchDisabled,
            coverTimestampMs: 1000,
            brandContent: tt.brandContent,
            brandOrganic: tt.brandOrganic,
            aiGenerated: tt.aiGenerated,
          }
        : null,
      { signal: opts.signal, onProgress: (f) => opts.onProgress?.(f * 0.8, 'Uploading to TikTok'), endpoints: ep },
    )
    publishId = result.publishId
    posts.setStatus(post.id, 'processing', { remoteId: publishId })
  }

  const pollMs = deps.pollMs ?? 5000
  const deadline = Date.now() + (deps.pollTimeoutMs ?? 15 * 60_000)
  for (;;) {
    if (opts.signal?.aborted) throw new Error('Stopped')
    const s = await tiktokStatus(await accessToken(accounts, apps, account.id, deps.endpoints), publishId, ep)
    if (s.status === 'PUBLISH_COMPLETE') {
      const url = s.postIds[0] ? tiktokVideoUrl(creator.username, s.postIds[0]) : null
      // From here on remoteId is the video id (for view counts), no longer the publish id.
      posts.setStatus(post.id, 'published', { url, publishedAt: new Date(), remoteId: s.postIds[0] ?? publishId })
      return { status: 'published', url }
    }
    if (s.status === 'SEND_TO_USER_INBOX') {
      posts.setStatus(post.id, 'sent_to_inbox')
      return { status: 'sent_to_inbox', url: null }
    }
    if (s.status === 'FAILED') throw new SocialError(`TikTok could not post it: ${s.failReason ?? 'unknown reason'}`, 'invalid', false)
    if (Date.now() > deadline) throw new SocialError('TikTok is taking unusually long to process the video. Check the TikTok app.', 'server', false)
    opts.onProgress?.(0.85, 'TikTok is processing the video')
    await new Promise((r) => setTimeout(r, pollMs))
  }
}
