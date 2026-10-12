import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { seal, unseal } from '../crypto'
import type { Db } from '../db/client'
import { accounts, clips, posts, renders, type AccountRow, type JobRow, type PostRow } from '../db/schema'
import { ProjectError } from '../errors'
import type { JobQueue } from '../jobs/queue'
import {
  POST_LIMITS,
  TIKTOK_PRIVACY_LEVELS,
  YOUTUBE_PRIVACY,
  type AccountDto,
  type CreatePostInput,
  type Platform,
  type PostDto,
  type PostStatus,
} from '../shared/social'

/** Tokens as stored (encrypted). Times are epoch ms. */
export interface StoredTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
  refreshExpiresAt: number | null
  scopes: string[]
}

export function toAccountDto(row: AccountRow): AccountDto {
  return {
    id: row.id,
    platform: row.platform,
    externalId: row.externalId,
    displayName: row.displayName,
    username: row.username,
    avatarUrl: row.avatarUrl,
    status: row.status,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

/** Connected accounts. Tokens never leave this service unencrypted except to the code that posts. */
export class AccountService {
  constructor(
    private readonly db: Db,
    private readonly key: Buffer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): AccountDto[] {
    return this.db.select().from(accounts).orderBy(accounts.platform, accounts.createdAt).all().map(toAccountDto)
  }

  get(id: string): AccountRow | null {
    return this.db.select().from(accounts).where(eq(accounts.id, id)).get() ?? null
  }

  require(id: string): AccountRow {
    const row = this.get(id)
    if (!row) throw new ProjectError('Account not found', 'not_found')
    return row
  }

  /** Adds an account, or refreshes it if it was connected before (same platform and id). */
  connect(platform: Platform, profile: { externalId: string; displayName: string; username: string | null; avatarUrl: string | null }, tokens: StoredTokens): AccountDto {
    const now = this.now()
    const sealed = seal(this.key, tokens)
    const existing = this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.platform, platform), eq(accounts.externalId, profile.externalId)))
      .get()
    if (existing) {
      this.db
        .update(accounts)
        .set({ ...profile, tokens: sealed, status: 'connected', updatedAt: now })
        .where(eq(accounts.id, existing.id))
        .run()
      return toAccountDto(this.require(existing.id))
    }
    const id = randomUUID()
    this.db.insert(accounts).values({ id, platform, ...profile, tokens: sealed, status: 'connected', createdAt: now, updatedAt: now }).run()
    return toAccountDto(this.require(id))
  }

  tokens(id: string): StoredTokens {
    return unseal<StoredTokens>(this.key, this.require(id).tokens)
  }

  saveTokens(id: string, tokens: StoredTokens): void {
    this.db.update(accounts).set({ tokens: seal(this.key, tokens), status: 'connected', updatedAt: this.now() }).where(eq(accounts.id, id)).run()
  }

  markNeedsReconnect(id: string): void {
    this.db.update(accounts).set({ status: 'needs_reconnect', updatedAt: this.now() }).where(eq(accounts.id, id)).run()
  }

  remove(id: string): void {
    this.require(id)
    this.db.delete(accounts).where(eq(accounts.id, id)).run()
  }
}

export function toPostDto(row: PostRow): PostDto {
  return {
    id: row.id,
    renderId: row.renderId,
    clipId: row.clipId,
    projectId: row.projectId,
    accountId: row.accountId,
    platform: row.platform,
    title: row.title,
    description: row.description,
    youtube: row.youtube ?? null,
    tiktok: row.tiktok ?? null,
    status: row.status,
    remoteId: row.remoteId,
    url: row.url,
    error: row.error,
    scheduledAt: row.scheduledAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
    publishedAt: row.publishedAt?.getTime() ?? null,
  }
}

/** Posts of exported clips to accounts. Each one is a `post.publish` job, created only after the user confirms. */
export class PostService {
  constructor(
    private readonly db: Db,
    private readonly queue: JobQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(input: CreatePostInput): PostDto {
    const render = this.db.select().from(renders).where(eq(renders.id, input.renderId)).get()
    if (!render || render.status !== 'done') throw new ProjectError('Export the clip before posting it', 'conflict')
    const account = this.db.select().from(accounts).where(eq(accounts.id, input.accountId)).get()
    if (!account) throw new ProjectError('Account not found', 'not_found')
    if (account.status !== 'connected') throw new ProjectError(`Reconnect ${account.displayName} first`, 'conflict')

    const title = input.title.trim()
    const description = (input.description ?? '').trim()
    if (account.platform === 'youtube') {
      const yt = input.youtube
      if (!yt || !YOUTUBE_PRIVACY.includes(yt.privacy)) throw new ProjectError('Choose who can see the video', 'invalid')
      if (!title) throw new ProjectError('A title is required', 'invalid')
      if (title.length > POST_LIMITS.youtubeTitle) throw new ProjectError(`Titles can be at most ${POST_LIMITS.youtubeTitle} characters`, 'invalid')
      if (/[<>]/.test(title + description)) throw new ProjectError('YouTube does not allow < or > in titles and descriptions', 'invalid')
      if (description.length > POST_LIMITS.youtubeDescription) throw new ProjectError('The description is too long', 'invalid')
      if (yt.tags.join(',').length > POST_LIMITS.youtubeTagsChars) throw new ProjectError('Too many tags', 'invalid')
    } else {
      const tt = input.tiktok
      if (!tt) throw new ProjectError('TikTok settings are missing', 'invalid')
      if (tt.mode === 'direct' && (!tt.privacy || !TIKTOK_PRIVACY_LEVELS.includes(tt.privacy))) {
        throw new ProjectError('Choose who can see the video on TikTok', 'invalid')
      }
      if (title.length > POST_LIMITS.tiktokCaption) throw new ProjectError('The caption is too long', 'invalid')
    }

    const now = this.now()
    const id = randomUUID()
    this.db.transaction(() => {
      this.db
        .insert(posts)
        .values({
          id,
          renderId: render.id,
          clipId: render.clipId,
          projectId: render.projectId,
          accountId: account.id,
          platform: account.platform,
          title,
          description: account.platform === 'youtube' ? description : '',
          youtube: account.platform === 'youtube' ? input.youtube : null,
          tiktok: account.platform === 'tiktok' ? input.tiktok : null,
          status: 'queued',
          createdAt: now,
          updatedAt: now,
        })
        .run()
      this.queue.enqueue('post.publish', { postId: id }, { projectId: render.projectId })
    })
    return this.dto(id)
  }

  get(id: string): PostRow | null {
    return this.db.select().from(posts).where(eq(posts.id, id)).get() ?? null
  }

  dto(id: string): PostDto {
    const row = this.get(id)
    if (!row) throw new ProjectError('Post not found', 'not_found')
    return toPostDto(row)
  }

  listForClip(clipId: string): PostDto[] {
    return this.db.select().from(posts).where(eq(posts.clipId, clipId)).orderBy(desc(posts.createdAt)).all().map(toPostDto)
  }

  listForProject(projectId: string): PostDto[] {
    const clipIds = this.db.select({ id: clips.id }).from(clips).where(eq(clips.projectId, projectId)).all().map((c) => c.id)
    if (!clipIds.length) return []
    return this.db.select().from(posts).where(inArray(posts.clipId, clipIds)).orderBy(desc(posts.createdAt)).all().map(toPostDto)
  }

  update(id: string, values: Partial<Pick<PostRow, 'status' | 'remoteId' | 'url' | 'error' | 'publishedAt'>>): void {
    this.db.update(posts).set({ ...values, updatedAt: this.now() }).where(eq(posts.id, id)).run()
  }

  setStatus(id: string, status: PostStatus, extra: Partial<Pick<PostRow, 'remoteId' | 'url' | 'error' | 'publishedAt'>> = {}): void {
    this.update(id, { status, ...extra })
  }

  jobGaveUp(job: JobRow, outcome: 'failed' | 'cancelled'): void {
    if (job.type !== 'post.publish') return
    const id = (job.payload as { postId?: string }).postId
    if (id && this.get(id)) this.setStatus(id, 'failed', { error: outcome === 'cancelled' ? 'Cancelled' : (job.error ?? 'Posting failed') })
  }

  jobRetried(job: JobRow): void {
    if (job.type !== 'post.publish') return
    const id = (job.payload as { postId?: string }).postId
    if (id && this.get(id)) this.setStatus(id, 'queued', { error: null })
  }
}
