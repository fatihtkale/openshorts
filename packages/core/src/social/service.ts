import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm'
import { seal, unseal } from '../crypto'
import type { Db } from '../db/client'
import { accounts, clips, posts, projects, renders, scheduleBatches, type AccountRow, type JobRow, type PostRow } from '../db/schema'
import { ProjectError } from '../errors'
import type { JobQueue } from '../jobs/queue'
import {
  POST_LIMITS,
  TIKTOK_PRIVACY_LEVELS,
  YOUTUBE_PRIVACY,
  type AccountDto,
  type CalendarPost,
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
    batchId: row.batchId,
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
    const prepared = this.prepare(input)
    this.db.transaction(() => this.insert(prepared, null))
    return this.dto(prepared.id)
  }

  /**
   * Plans several posts at once (one day's spread). Every post is checked first; then all are saved together,
   * so a bad one never leaves the rest half-scheduled.
   */
  createBatch(batch: { date: string; timeZone: string; windowStart: string; windowEnd: string; mode: string; jitterMin: number }, items: CreatePostInput[]): PostDto[] {
    if (!items.length) throw new ProjectError('Nothing to schedule', 'invalid')
    const prepared = items.map((item, i) => {
      try {
        return this.prepare(item)
      } catch (error) {
        if (error instanceof ProjectError) throw new ProjectError(`Post ${i + 1}: ${error.message}`, error.code)
        throw error
      }
    })
    const batchId = randomUUID()
    this.db.transaction(() => {
      this.db.insert(scheduleBatches).values({ id: batchId, ...batch, createdAt: this.now() }).run()
      for (const p of prepared) this.insert(p, batchId)
    })
    return prepared.map((p) => this.dto(p.id))
  }

  private prepare(input: CreatePostInput) {
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

    const scheduledAt = input.scheduledAt ?? null
    if (scheduledAt !== null) {
      const now = this.now().getTime()
      if (scheduledAt < now + 2 * 60_000) throw new ProjectError('Schedule at least 2 minutes ahead', 'invalid')
      if (scheduledAt > now + 180 * 24 * 3_600_000) throw new ProjectError('Schedule at most 6 months ahead', 'invalid')
    }
    // A scheduled YouTube video goes up as private and YouTube makes it public at the time; that's the only option.
    const youtube = account.platform === 'youtube' && input.youtube ? { ...input.youtube, privacy: scheduledAt ? ('public' as const) : input.youtube.privacy } : null
    return { id: randomUUID(), render, account, title, description, youtube, tiktok: account.platform === 'tiktok' ? (input.tiktok ?? null) : null, scheduledAt }
  }

  private insert(p: ReturnType<PostService['prepare']>, batchId: string | null): void {
    const now = this.now()
    this.db
      .insert(posts)
      .values({
        id: p.id,
        renderId: p.render.id,
        clipId: p.render.clipId,
        projectId: p.render.projectId,
        accountId: p.account.id,
        platform: p.account.platform,
        title: p.title,
        description: p.account.platform === 'youtube' ? p.description : '',
        youtube: p.youtube,
        tiktok: p.tiktok,
        status: 'queued',
        scheduledAt: p.scheduledAt ? new Date(p.scheduledAt) : null,
        batchId,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    this.enqueue(p.id, p.render.projectId, p.account.platform, p.scheduledAt)
  }

  /** YouTube uploads right away (YouTube publishes at the time); TikTok waits until its time. */
  private enqueue(postId: string, projectId: string, platform: Platform, scheduledAt: number | null) {
    const runAt = platform === 'tiktok' && scheduledAt ? new Date(scheduledAt) : undefined
    this.queue.enqueue('post.publish', { postId }, { projectId, runAt })
  }

  /** The queued or running job sending this post, if any. */
  private activeJob(post: PostRow) {
    return this.queue.activeForProject(post.projectId).find((j) => j.type === 'post.publish' && (j.payload as { postId?: string }).postId === post.id)
  }

  require(id: string): PostRow {
    const row = this.get(id)
    if (!row) throw new ProjectError('Post not found', 'not_found')
    return row
  }

  /** Stops a post that hasn't been sent yet. */
  cancel(id: string): PostDto {
    const post = this.require(id)
    if (post.status === 'scheduled') {
      throw new ProjectError('This video is already on YouTube, waiting to go public. Change or delete it in YouTube Studio.', 'conflict')
    }
    if (post.status !== 'queued' && post.status !== 'missed' && post.status !== 'failed') {
      throw new ProjectError('This post is already being sent or is done', 'conflict')
    }
    const job = this.activeJob(post)
    if (job?.status === 'running') throw new ProjectError('This post is being sent right now', 'conflict')
    if (job) this.queue.requestCancel(job.id)
    this.setStatus(id, 'cancelled')
    return this.dto(id)
  }

  /** Moves a waiting, missed, failed or cancelled post to a new time (or now, with null). */
  reschedule(id: string, scheduledAt: number | null): PostDto {
    const post = this.require(id)
    if (!['queued', 'missed', 'failed', 'cancelled'].includes(post.status)) throw new ProjectError('This post can no longer be moved', 'conflict')
    const job = this.activeJob(post)
    if (job?.status === 'running') throw new ProjectError('This post is being sent right now', 'conflict')
    const now = this.now().getTime()
    if (scheduledAt !== null && scheduledAt < now + 2 * 60_000) throw new ProjectError('Schedule at least 2 minutes ahead', 'invalid')
    const account = post.accountId ? this.db.select().from(accounts).where(eq(accounts.id, post.accountId)).get() : null
    if (!account) throw new ProjectError('The account for this post was disconnected', 'conflict')
    if (account.status !== 'connected') throw new ProjectError(`Reconnect ${account.displayName} on the Accounts page first`, 'conflict')
    this.db.transaction(() => {
      if (job) this.queue.requestCancel(job.id)
      this.db
        .update(posts)
        .set({
          scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
          status: 'queued',
          error: null,
          // A TikTok post that never finished uploading starts over.
          remoteId: post.status === 'failed' || post.status === 'cancelled' ? null : post.remoteId,
          updatedAt: this.now(),
        })
        .where(eq(posts.id, id))
        .run()
      this.enqueue(id, post.projectId, post.platform, scheduledAt)
    })
    return this.dto(id)
  }

  /** Posts in a time range (by scheduled time, or creation time for posts sent straight away), for the calendar. */
  calendar(from: number, to: number): CalendarPost[] {
    const rows = this.db
      .select({ post: posts, clipTitle: clips.title, projectName: projects.name, accountName: accounts.displayName })
      .from(posts)
      .innerJoin(clips, eq(clips.id, posts.clipId))
      .innerJoin(projects, eq(projects.id, posts.projectId))
      .leftJoin(accounts, eq(accounts.id, posts.accountId))
      .where(
        or(
          and(gte(posts.scheduledAt, new Date(from)), lt(posts.scheduledAt, new Date(to))),
          and(isNull(posts.scheduledAt), gte(posts.createdAt, new Date(from)), lt(posts.createdAt, new Date(to))),
        ),
      )
      .orderBy(asc(posts.scheduledAt), asc(posts.createdAt))
      .all()
    return rows.map((r) => ({ ...toPostDto(r.post), clipTitle: r.clipTitle, projectName: r.projectName, accountName: r.accountName }))
  }

  missedCount(): number {
    return this.db.select({ id: posts.id }).from(posts).where(eq(posts.status, 'missed')).all().length
  }

  /** Scheduled TikTok posts still waiting, from now until `until` (the worker keeps the Mac awake for these). */
  upcomingTiktok(until: number): PostDto[] {
    const now = this.now()
    return this.db
      .select()
      .from(posts)
      .where(and(eq(posts.platform, 'tiktok'), eq(posts.status, 'queued'), gte(posts.scheduledAt, new Date(now.getTime() - 60_000)), lt(posts.scheduledAt, new Date(until))))
      .all()
      .map(toPostDto)
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
