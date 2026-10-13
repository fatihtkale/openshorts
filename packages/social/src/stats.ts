import type { AccountService, PostService } from '@clipstudio/core'
import { SocialError } from './errors'
import { accessToken, type Endpoints, type SocialApps } from './publish'
import { TIKTOK_ENDPOINTS, tiktokStats } from './tiktok'
import { YOUTUBE_ENDPOINTS, youtubeStats } from './youtube'

export interface StatsDeps {
  posts: PostService
  accounts: AccountService
  apps: SocialApps
  endpoints?: Endpoints
}

/**
 * Reads a post's current view count from the platform and stores it.
 * Skips (without failing) posts the platform can't report on: drafts, removed videos, or a TikTok sign-in
 * from before view counts were requested.
 */
export async function collectPostStats(deps: StatsDeps, postId: string): Promise<{ views: number } | { skipped: string }> {
  const { posts, accounts, apps } = deps
  const post = posts.get(postId)
  if (!post) return { skipped: 'The post no longer exists.' }
  if (post.status !== 'published' && post.status !== 'scheduled') return { skipped: 'The post is not public.' }
  if (!post.remoteId) return { skipped: 'The platform never returned a video id.' }
  if (!post.accountId || !accounts.get(post.accountId)) return { skipped: 'The account was disconnected.' }
  const account = accounts.require(post.accountId)
  if (account.status !== 'connected') return { skipped: `${account.displayName} needs reconnecting.` }
  if (post.platform === 'tiktok' && !accounts.tokens(account.id).scopes.includes('video.list')) {
    return { skipped: 'Reconnect the TikTok account to allow reading view counts.' }
  }

  try {
    const token = await accessToken(accounts, apps, account.id, deps.endpoints)
    const found =
      post.platform === 'youtube'
        ? await youtubeStats(token, [post.remoteId], deps.endpoints?.youtube ?? YOUTUBE_ENDPOINTS)
        : await tiktokStats(token, [post.remoteId], deps.endpoints?.tiktok ?? TIKTOK_ENDPOINTS)
    const stats = found.get(post.remoteId)
    if (!stats) return { skipped: 'The video is private, removed, or not visible yet.' }
    posts.recordStats(postId, stats)
    return { views: stats.views }
  } catch (error) {
    if (error instanceof SocialError && error.kind === 'auth') accounts.markNeedsReconnect(account.id)
    throw error
  }
}
