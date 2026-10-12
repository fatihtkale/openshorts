// Safe to import from the browser: no Node or database dependencies.

export const PLATFORMS = ['youtube', 'tiktok'] as const
export type Platform = (typeof PLATFORMS)[number]

export const PLATFORM_LABELS: Record<Platform, string> = { youtube: 'YouTube', tiktok: 'TikTok' }

export interface AccountDto {
  id: string
  platform: Platform
  externalId: string
  displayName: string
  username: string | null
  avatarUrl: string | null
  /** needs_reconnect: the platform stopped accepting the sign-in. */
  status: 'connected' | 'needs_reconnect'
  createdAt: number
  updatedAt: number
}

export const POST_STATUSES = ['queued', 'uploading', 'processing', 'published', 'scheduled', 'sent_to_inbox', 'failed'] as const
export type PostStatus = (typeof POST_STATUSES)[number]

export const YOUTUBE_PRIVACY = ['private', 'unlisted', 'public'] as const
export type YoutubePrivacy = (typeof YOUTUBE_PRIVACY)[number]

export const TIKTOK_PRIVACY_LEVELS = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'] as const
export type TiktokPrivacyLevel = (typeof TIKTOK_PRIVACY_LEVELS)[number]

export const TIKTOK_PRIVACY_LABELS: Record<TiktokPrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: 'Everyone',
  MUTUAL_FOLLOW_FRIENDS: 'Friends',
  FOLLOWER_OF_CREATOR: 'Followers',
  SELF_ONLY: 'Only me',
}

export interface YoutubePostOptions {
  privacy: YoutubePrivacy
  tags: string[]
  madeForKids: boolean
}

export interface TiktokPostOptions {
  /** direct: post to the profile; draft: send to the TikTok inbox to finish in the app. */
  mode: 'direct' | 'draft'
  privacy: TiktokPrivacyLevel | null
  allowComments: boolean
  allowDuet: boolean
  allowStitch: boolean
  brandContent: boolean
  brandOrganic: boolean
  aiGenerated: boolean
}

export interface PostDto {
  id: string
  renderId: string
  clipId: string
  projectId: string
  accountId: string | null
  platform: Platform
  /** YouTube title, or the TikTok caption. */
  title: string
  /** YouTube description (TikTok has only the caption). */
  description: string
  youtube: YoutubePostOptions | null
  tiktok: TiktokPostOptions | null
  status: PostStatus
  remoteId: string | null
  url: string | null
  error: string | null
  scheduledAt: number | null
  createdAt: number
  publishedAt: number | null
}

export interface CreatePostInput {
  renderId: string
  accountId: string
  title: string
  description?: string
  youtube?: YoutubePostOptions
  tiktok?: TiktokPostOptions
}

export const POST_LIMITS = {
  youtubeTitle: 100,
  youtubeDescription: 5000,
  youtubeTagsChars: 500,
  tiktokCaption: 2200,
}

/** Hashtags from keywords: "#oneword" each, no duplicates. */
export function hashtags(keywords: string[], extra: string[] = []): string[] {
  const tags = [...keywords, ...extra]
    .map((k) => k.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter((k) => k.length >= 2)
  return [...new Set(tags)].slice(0, 8).map((t) => `#${t}`)
}

/** First drafts of the text for a post, from what's known about the clip. */
export function suggestPostText(clip: { title: string; hook: string | null; keywords: string[] }, platform: Platform) {
  const tags = hashtags(clip.keywords, platform === 'youtube' ? ['shorts'] : [])
  if (platform === 'youtube') {
    const title = clip.title.length + 8 <= POST_LIMITS.youtubeTitle ? `${clip.title} #Shorts` : clip.title.slice(0, POST_LIMITS.youtubeTitle)
    const description = [clip.hook, tags.join(' ')].filter(Boolean).join('\n\n')
    return { title, description, tags: clip.keywords.slice(0, 10) }
  }
  return { title: [clip.hook ?? clip.title, tags.join(' ')].filter(Boolean).join(' '), description: '', tags: [] as string[] }
}
