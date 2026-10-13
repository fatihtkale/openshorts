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
  /** YouTube: whether the sign-in allows editing uploaded videos (older sign-ins need a reconnect). */
  canEditVideos?: boolean
}

/**
 * queued: waiting to be sent (for TikTok, until its scheduled time); scheduled: on YouTube, which publishes it at the time;
 * missed: the Mac was asleep at the time, so nothing was posted and the user decides what to do.
 */
export const POST_STATUSES = ['queued', 'uploading', 'processing', 'published', 'scheduled', 'sent_to_inbox', 'failed', 'missed', 'cancelled'] as const
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
  /**
   * A reminder only: the video to set as "Related video" in YouTube Studio. YouTube's API can't set it, so the app
   * shows it next to the "Open in YouTube Studio" button.
   */
  relatedVideo?: string | null
}

/** The video's edit page in YouTube Studio (related video, end screens, anything the API can't set). */
export function youtubeStudioUrl(videoId: string): string {
  return `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/edit`
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
  batchId: string | null
  createdAt: number
  publishedAt: number | null
}

/** A post with what the calendar shows next to it. */
export interface CalendarPost extends PostDto {
  clipTitle: string
  projectName: string
  accountName: string | null
}

export interface CreatePostInput {
  renderId: string
  accountId: string
  title: string
  description?: string
  youtube?: YoutubePostOptions
  tiktok?: TiktokPostOptions
  /** Epoch ms; omitted = post now. */
  scheduledAt?: number | null
}

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  queued: 'Waiting to post',
  uploading: 'Uploading',
  processing: 'Processing on the platform',
  published: 'Posted',
  scheduled: 'Scheduled on YouTube',
  sent_to_inbox: 'In your TikTok drafts',
  failed: 'Failed',
  missed: 'Missed',
  cancelled: 'Cancelled',
}

/** A TikTok post is "missed" if the Mac wakes up this long after its time. */
export const MISSED_AFTER_MS = 10 * 60_000

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

/** "#NoPixel, gtarp #GTA" → ["#NoPixel", "#gtarp", "#GTA"]: the hashtags in a free-text setting, casing kept. */
export function parseHashtags(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/[\s,]+/)) {
    const tag = raw.replace(/[^\p{L}\p{N}]+/gu, '')
    if (tag.length < 2 || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    out.push(`#${tag}`)
  }
  return out
}

/** A title without its hashtags: "NEVER AGAIN! 😂 #NoPixel #GTARP" → "NEVER AGAIN! 😂". */
export function stripHashtags(text: string): string {
  return text.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, '').replace(/\s{2,}/g, ' ').trim()
}

/**
 * First drafts of the text for a post, from what's known about the clip.
 * YouTube: the clip's title without hashtags, an empty description and no tags, so YouTube finds the audience itself
 * instead of testing the Short only on people who follow those tags (docs/shorts-playbook.md). `defaultHashtags`
 * (Settings → Posting defaults) is opt-in: when set, they become the description.
 */
export function suggestPostText(clip: { title: string; hook: string | null; keywords: string[] }, platform: Platform, defaultHashtags = '') {
  const own = parseHashtags(defaultHashtags)
  if (platform === 'youtube') {
    const title = (stripHashtags(clip.title) || clip.title).slice(0, POST_LIMITS.youtubeTitle)
    return { title, description: own.join(' '), tags: [] as string[] }
  }
  const taken = new Set(own.map((t) => t.toLowerCase()))
  const tags = [...own, ...hashtags(clip.keywords).filter((t) => !taken.has(t))].slice(0, 8)
  return { title: [clip.hook ?? clip.title, tags.join(' ')].filter(Boolean).join(' '), description: '', tags: [] as string[] }
}
