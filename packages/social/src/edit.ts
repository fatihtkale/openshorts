import type { AccountService, PostService } from '@clipstudio/core'
import { SocialError } from './errors'
import { accessToken, type Endpoints, type SocialApps } from './publish'
import { YOUTUBE_EDIT_SCOPE, YOUTUBE_ENDPOINTS, youtubeSetPublishAt, youtubeUpdateText } from './youtube'

/**
 * Saves new text for a post. Waiting posts change here only; a video already on YouTube is updated there first, and
 * the text is stored only once YouTube accepted it, so the app and YouTube never disagree.
 */
export async function editPostText(
  deps: EditDeps,
  postId: string,
  input: { title: string; description?: string; tags?: string[]; relatedVideo?: string | null },
) {
  const { posts } = deps
  const text = posts.checkText(postId, input)
  if (text.target === 'youtube') {
    const token = await editToken(deps, text.post.accountId)
    await youtubeUpdateText(token, text.post.remoteId!, text, deps.endpoints?.youtube ?? YOUTUBE_ENDPOINTS)
  }
  return posts.saveText(postId, text)
}

/**
 * Moves a post to a new time. Posts not yet sent move here only; a video already on YouTube and waiting for its
 * publish time gets the new time there first, and it's stored only once YouTube accepted it.
 */
export async function reschedulePost(deps: EditDeps, postId: string, scheduledAt: number | null) {
  const { posts } = deps
  const post = posts.require(postId)
  if (post.status !== 'scheduled' || post.platform !== 'youtube' || !post.remoteId) return posts.reschedule(postId, scheduledAt)
  if (scheduledAt === null) throw new SocialError('This video is already on YouTube; pick a new time instead.', 'invalid', false)
  posts.checkMove(postId, scheduledAt)
  const token = await editToken(deps, post.accountId)
  await youtubeSetPublishAt(token, post.remoteId, new Date(scheduledAt).toISOString(), post.youtube?.madeForKids ?? false, deps.endpoints?.youtube ?? YOUTUBE_ENDPOINTS)
  return posts.saveMove(postId, scheduledAt)
}

type EditDeps = { posts: PostService; accounts: AccountService; apps: SocialApps; endpoints?: Endpoints }

/** A token that may change videos (youtube.force-ssl); older sign-ins have to reconnect once. */
async function editToken(deps: EditDeps, accountId: string | null): Promise<string> {
  const { accounts } = deps
  if (!accountId || !accounts.get(accountId)) throw new SocialError('The YouTube account for this post was disconnected.', 'auth', false)
  if (!accounts.tokens(accountId).scopes.includes(YOUTUBE_EDIT_SCOPE)) {
    throw new SocialError('Reconnect YouTube on the Accounts page to let the app edit videos (a new permission).', 'forbidden', false)
  }
  return accessToken(accounts, deps.apps, accountId, deps.endpoints)
}
