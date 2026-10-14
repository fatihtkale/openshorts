import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClipService } from '../clips/service'
import { JobQueue } from '../jobs/queue'
import { ProjectService } from '../projects/service'
import { RenderService } from '../renders/service'
import type { TiktokPostOptions } from '../shared/social'
import { LocalStorage } from '../storage'
import { createTestDb } from '../testing'
import { AccountService, PostService } from './service'

let dir: string
let clock: Date
let queue: JobQueue
let posts: PostService
let renderId: string
let youtubeId: string
let library: () => ReturnType<ClipService['library']>
let tiktokId: string
const HOUR = 3_600_000
const tiktokOptions: TiktokPostOptions = {
  mode: 'direct',
  privacy: 'SELF_ONLY',
  allowComments: true,
  allowDuet: true,
  allowStitch: true,
  brandContent: false,
  brandOrganic: false,
  aiGenerated: false,
}
const batch = { date: '2026-10-16', timeZone: 'America/New_York', windowStart: '12:00', windowEnd: '21:00', mode: 'edges', jitterMin: 0 }

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'clipstudio-schedule-'))
  clock = new Date('2026-10-15T12:00:00Z')
  const db = createTestDb()
  queue = new JobQueue(db, () => clock)
  const projects = new ProjectService(db, queue, new LocalStorage(dir), () => clock)
  const clips = new ClipService(db, () => clock)
  library = () => clips.library()
  const renders = new RenderService(db, queue, () => clock)
  posts = new PostService(db, queue, () => clock)
  const accounts = new AccountService(db, randomBytes(32), () => clock)
  const { project, sourceKey } = projects.createForUpload({ name: 'P', filename: 'p.mp4' })
  projects.sourceReady(project.id, sourceKey, 10, 'video/mp4')
  projects.markReady(project.id, { durationMs: 60_000, width: 1920, height: 1080, fps: 30, hasAudio: true })
  for (const job of queue.activeForProject(project.id)) queue.requestCancel(job.id)
  const clip = clips.createManual(project.id, { startMs: 0, endMs: 15_000, title: 'Clip' })
  renderId = renders.request(clip.id).id
  renders.complete(renderId, { storageKey: 'x.mp4', bytes: 1000, durationMs: 15_000 })
  for (const job of queue.activeForProject(project.id)) queue.requestCancel(job.id)
  const tokens = { accessToken: 't', refreshToken: 'r', expiresAt: clock.getTime() + HOUR, refreshExpiresAt: null, scopes: [] }
  youtubeId = accounts.connect('youtube', { externalId: 'yt', displayName: 'YT', username: null, avatarUrl: null }, tokens).id
  tiktokId = accounts.connect('tiktok', { externalId: 'tt', displayName: 'TT', username: null, avatarUrl: null }, tokens).id
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const postJob = (postId: string) => queue.listRecent(100).find((j) => j.type === 'post.publish' && (j.payload as { postId: string }).postId === postId)

describe('the clips library', () => {
  it('lists clips across projects with what has been uploaded and what still waits', () => {
    expect(library()).toMatchObject([{ projectName: 'P', uploaded: 0, waiting: 0, clip: { title: 'Clip' } }])
    const a = posts.create({ renderId, accountId: youtubeId, title: 'A', scheduledAt: clock.getTime() + 2 * HOUR, youtube: { privacy: 'public', tags: [], madeForKids: false } })
    const b = posts.create({ renderId, accountId: youtubeId, title: 'B', youtube: { privacy: 'public', tags: [], madeForKids: false } })
    expect(library()[0]).toMatchObject({ uploaded: 0, waiting: 2 })
    posts.setStatus(a.id, 'scheduled', { remoteId: 'v1' })
    posts.setStatus(b.id, 'failed', { error: 'x' })
    expect(library()[0]).toMatchObject({ uploaded: 1, waiting: 0 })
  })
})

describe('scheduled posts', () => {
  it('uploads YouTube now (it publishes at the time) and runs TikTok at its time', () => {
    const at = clock.getTime() + 5 * HOUR
    const [yt, tt] = posts.createBatch(batch, [
      { renderId, accountId: youtubeId, title: 'Title', scheduledAt: at, youtube: { privacy: 'unlisted', tags: [], madeForKids: false } },
      { renderId, accountId: tiktokId, title: 'Caption', scheduledAt: at, tiktok: tiktokOptions },
    ])
    expect(yt!.youtube!.privacy).toBe('public')
    expect(yt!.batchId).toBe(tt!.batchId)
    expect(postJob(yt!.id)!.runAt.getTime()).toBe(clock.getTime())
    expect(postJob(tt!.id)!.runAt.getTime()).toBe(at)
    expect(posts.upcomingTiktok(clock.getTime() + 12 * HOUR).map((p) => p.id)).toEqual([tt!.id])
    expect(posts.calendar(clock.getTime(), clock.getTime() + 24 * HOUR)).toHaveLength(2)
  })

  it('saves nothing when one post in a batch is invalid', () => {
    expect(() =>
      posts.createBatch(batch, [
        { renderId, accountId: tiktokId, title: 'ok', scheduledAt: clock.getTime() + HOUR, tiktok: tiktokOptions },
        { renderId, accountId: tiktokId, title: 'too soon', scheduledAt: clock.getTime() + 60_000, tiktok: tiktokOptions },
      ]),
    ).toThrow(/Post 2: Schedule at least 2 minutes ahead/)
    expect(posts.calendar(0, clock.getTime() + 48 * HOUR)).toEqual([])
  })

  it('cancels, reschedules and posts now', () => {
    const p = posts.create({ renderId, accountId: tiktokId, title: 'c', scheduledAt: clock.getTime() + HOUR, tiktok: tiktokOptions })
    const moved = posts.reschedule(p.id, clock.getTime() + 3 * HOUR)
    expect(moved.scheduledAt).toBe(clock.getTime() + 3 * HOUR)
    // The old job is cancelled and a new one waits for the new time.
    const active = queue.activeForProject(p.projectId).filter((j) => j.type === 'post.publish')
    expect(active).toHaveLength(1)
    expect(active[0]!.runAt.getTime()).toBe(clock.getTime() + 3 * HOUR)

    expect(posts.cancel(p.id).status).toBe('cancelled')
    expect(queue.activeForProject(p.projectId).filter((j) => j.type === 'post.publish')).toEqual([])

    const now = posts.reschedule(p.id, null)
    expect(now).toMatchObject({ status: 'queued', scheduledAt: null })
    const job = queue.activeForProject(p.projectId).find((j) => j.type === 'post.publish')
    expect(job!.runAt.getTime()).toBe(clock.getTime())
  })

  it('refuses to cancel what YouTube already holds', () => {
    const p = posts.create({ renderId, accountId: youtubeId, title: 't', scheduledAt: clock.getTime() + HOUR, youtube: { privacy: 'public', tags: [], madeForKids: false } })
    posts.setStatus(p.id, 'scheduled', { remoteId: 'v1' })
    expect(() => posts.cancel(p.id)).toThrow(/YouTube Studio/)
  })
})

describe('editing post text', () => {
  it('edits waiting posts here, YouTube videos there, and refuses TikTok posts that are up', () => {
    const yt = posts.create({ renderId, accountId: youtubeId, title: 'Old', description: 'd', scheduledAt: clock.getTime() + HOUR, youtube: { privacy: 'public', tags: ['a'], madeForKids: false } })
    expect(posts.checkText(yt.id, { title: '  New title #NoPixel ', tags: [' gta ', ''] })).toMatchObject({ target: 'local', title: 'New title #NoPixel', tags: ['gta'] })
    const saved = posts.saveText(yt.id, { title: 'New', description: 'x', tags: ['gta'], relatedVideo: 'Part 1' })
    expect(saved.youtube).toMatchObject({ tags: ['gta'], relatedVideo: 'Part 1', privacy: 'public' })

    posts.setStatus(yt.id, 'scheduled', { remoteId: 'vid1' })
    expect(posts.checkText(yt.id, { title: 'On YouTube' }).target).toBe('youtube')
    expect(() => posts.checkText(yt.id, { title: '' })).toThrow(/title is required/)
    expect(() => posts.checkText(yt.id, { title: 'a <b>' })).toThrow(/< or >/)

    const tt = posts.create({ renderId, accountId: tiktokId, title: 'c', tiktok: tiktokOptions })
    posts.setStatus(tt.id, 'published', { remoteId: '7123' })
    expect(() => posts.checkText(tt.id, { title: 'x' })).toThrow(/TikTok doesn't allow/)
  })
})
