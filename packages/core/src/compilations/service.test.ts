import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClipService } from '../clips/service'
import { JobQueue } from '../jobs/queue'
import { ProjectService } from '../projects/service'
import { RenderService } from '../renders/service'
import { chaptersValid, creditLine, defaultCredit, suggestCompilationText, youtubeChapters, type CompilationChapter } from '../shared/compilations'
import { AccountService, PostService } from '../social/service'
import { LocalStorage } from '../storage'
import { createTestDb } from '../testing'
import { CompilationService } from './service'

let dir: string
let clock: Date
let queue: JobQueue
let projects: ProjectService
let clips: ClipService
let renders: RenderService
let comps: CompilationService
let posts: PostService
let accounts: AccountService
let clipA: string
let clipB: string

/** A ready Twitch project with one approved clip. */
function twitchClip(channel: string, title: string): string {
  const project = projects.createFromYoutube({
    url: `https://www.twitch.tv/videos/1`,
    meta: { videoId: 'v1', title: 'VOD', channel, durationSec: 600, uploadDate: '20261016', thumbnailUrl: '', license: null, isLive: false, maxHeight: 1080, platform: 'twitch', twitch: { kind: 'vod', channelLogin: channel.toLowerCase(), viewCount: 1 } },
    quality: '1080',
  })
  projects.markReady(project.id, { durationMs: 600_000, width: 1920, height: 1080, fps: 30, hasAudio: true })
  for (const job of queue.activeForProject(project.id)) queue.requestCancel(job.id)
  return clips.createManual(project.id, { startMs: 10_000, endMs: 35_000, title }).id
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'clipstudio-compilations-'))
  clock = new Date('2026-10-16T12:00:00Z')
  const db = createTestDb()
  queue = new JobQueue(db, () => clock)
  projects = new ProjectService(db, queue, new LocalStorage(dir), () => clock)
  clips = new ClipService(db, () => clock)
  renders = new RenderService(db, queue, () => clock)
  comps = new CompilationService(db, queue, () => clock)
  posts = new PostService(db, queue, () => clock)
  accounts = new AccountService(db, randomBytes(32), () => clock)
  clipA = twitchClip('AnthonyZ', 'Tony flips at 100 mph')
  clipB = twitchClip('omie', 'Marty pushes a guy off a bridge')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('CompilationService', () => {
  it('credits each clip from its source and keeps the chosen order', () => {
    const c = comps.create({ title: 'Funny NoPixel moments', clipIds: [clipB, clipA] })
    expect(c.items.map((i) => i.clipId)).toEqual([clipB, clipA])
    expect(c.items[1]!.credit).toEqual({ platform: 'twitch', name: 'AnthonyZ', handle: 'anthonyz' })
    const detail = comps.detail(c.id)
    expect(detail.clips[clipA]).toMatchObject({ title: 'Tony flips at 100 mph', missing: false })

    const edited = comps.update(c.id, { items: [{ ...c.items[1]!, credit: { platform: 'twitch', name: ' Tony ', handle: '@AnthonyZ ' } }] }, c.version)
    expect(edited.items).toEqual([{ clipId: clipA, credit: { platform: 'twitch', name: 'Tony', handle: 'AnthonyZ' } }])
    expect(() => comps.update(c.id, { title: 'x' }, c.version)).toThrow(/changed somewhere else/)
  })

  it('refuses unapproved clips and exports only when every clip is still there', () => {
    expect(() => comps.create({ title: '' })).toThrow(/title/)
    clips.setStatus([clipB], 'rejected')
    expect(() => comps.create({ title: 'T', clipIds: [clipB] })).toThrow(/approved/)
    clips.setStatus([clipB], 'approved')
    const c = comps.create({ title: 'T', clipIds: [clipA, clipB] })
    clips.setStatus([clipB], 'rejected')
    expect(() => comps.requestRender(c.id)).toThrow(/no longer available/)
    clips.setStatus([clipB], 'approved')
    expect(comps.requestRender(c.id).status).toBe('queued')
    expect(queue.listRecent(10).find((j) => j.type === 'compilation.render')?.payload).toEqual({ compilationId: c.id, version: c.version })
  })

  it('turns a finished export into a project with a postable "Full video", hidden from the clip library', () => {
    const c = comps.create({ title: 'Funny NoPixel moments', clipIds: [clipA, clipB] })
    comps.requestRender(c.id)
    const chapters: CompilationChapter[] = [
      { atMs: 0, title: 'Tony flips at 100 mph', credit: c.items[0]!.credit },
      { atMs: 25_000, title: 'Marty pushes a guy off a bridge', credit: c.items[1]!.credit },
    ]
    const done = comps.complete(c.id, { projectId: 'p-comp', renderId: 'r1', storageKey: 'projects/p-comp/renders/r1.mp4', bytes: 1000, durationMs: 50_000, chapters, version: c.version, hasAudio: true })
    expect(done).toMatchObject({ status: 'done', renderedVersion: 1, durationMs: 50_000, projectId: 'p-comp' })
    expect(done.clip).toMatchObject({ origin: 'compilation', startMs: 0, endMs: 50_000, version: 1 })
    expect(done.render).toMatchObject({ id: 'r1', status: 'done', clipVersion: 1 })
    expect(projects.require('p-comp')).toMatchObject({ sourceType: 'compilation', status: 'processing', width: 1920, height: 1080 })
    expect(projects.asset('p-comp', 'source')?.storageKey).toBe('projects/p-comp/renders/r1.mp4')
    expect(queue.activeForProject('p-comp').map((j) => j.type)).toContain('media.prepare')

    // Not a clip to edit or re-export vertically, but it posts like one.
    expect(clips.library().some((i) => i.clip.origin === 'compilation')).toBe(false)
    expect(() => renders.request(done.clip!.id)).toThrow(/Compilations page/)
    const tokens = { accessToken: 't', refreshToken: 'r', expiresAt: clock.getTime() + 3_600_000, refreshExpiresAt: null, scopes: [] }
    const yt = accounts.connect('youtube', { externalId: 'yt', displayName: 'YT', username: null, avatarUrl: null }, tokens)
    const post = posts.create({ renderId: 'r1', accountId: yt.id, title: 'Funny NoPixel moments', youtube: { privacy: 'public', tags: [], madeForKids: false } })
    expect(post).toMatchObject({ clipId: done.clip!.id, projectId: 'p-comp', status: 'queued' })

    // A second export reuses the project and the clip, with a new version.
    clock = new Date(clock.getTime() + 60_000)
    const again = comps.complete(c.id, { projectId: 'p-comp', renderId: 'r2', storageKey: 'projects/p-comp/renders/r2.mp4', bytes: 900, durationMs: 40_000, chapters, version: 2, hasAudio: true })
    expect(again.clip).toMatchObject({ id: done.clip!.id, version: 2, endMs: 40_000 })
    expect(again.render?.id).toBe('r2')
  })

  it('marks a failed or cancelled export', () => {
    const c = comps.create({ title: 'T', clipIds: [clipA] })
    comps.requestRender(c.id)
    const job = queue.listRecent(10).find((j) => j.type === 'compilation.render')!
    comps.jobGaveUp({ ...job, error: 'boom' }, 'failed')
    expect(comps.dto(c.id)).toMatchObject({ status: 'failed', error: 'boom' })
    comps.jobRetried(job)
    expect(comps.dto(c.id).status).toBe('queued')
  })
})

describe('credits and chapters', () => {
  const credit = { platform: 'twitch' as const, name: 'omie', handle: 'omie' }
  it('makes links per platform', () => {
    expect(creditLine(credit)).toBe('twitch.tv/omie')
    expect(creditLine({ platform: 'youtube', name: 'X', handle: '@xqc' })).toBe('youtube.com/@xqc')
    expect(creditLine({ platform: 'kick', name: 'X', handle: '' })).toBe('')
    expect(defaultCredit('youtube', { channel: 'Live Speedy' } as never)).toEqual({ platform: 'youtube', name: 'Live Speedy', handle: '' })
  })

  it('writes YouTube chapters only when YouTube would show them, and lists every streamer once', () => {
    const ch = (atMs: number, title: string, c = credit) => ({ atMs, title, credit: c })
    const three = [ch(0, 'Bridge'), ch(25_000, 'Boat', { platform: 'twitch', name: 'xQc', handle: 'xqc' }), ch(65_000, 'Jump')]
    expect(chaptersValid(three, 90_000)).toBe(true)
    expect(chaptersValid(three.slice(0, 2), 90_000)).toBe(false)
    expect(chaptersValid(three, 70_000)).toBe(false)
    const text = suggestCompilationText(' Funny NoPixel moments ', three, 90_000)
    expect(text.title).toBe('Funny NoPixel moments')
    expect(text.description).toContain('0:00 Bridge (omie)\n0:25 Boat (xQc)\n1:05 Jump (omie)')
    expect(text.description.match(/twitch\.tv\/omie/g)).toHaveLength(1)
    expect(text.description).toContain('• xQc https://twitch.tv/xqc')

    // A 9 s clip is folded into the chapter before it instead of switching chapters off.
    const withShort = [ch(0, 'Bridge'), ch(20_000, 'Boat'), ch(40_000, 'Tiny'), ch(49_000, 'Jump'), ch(70_000, 'End')]
    expect(youtubeChapters(withShort, 90_000).map((c) => c.title)).toEqual(['Bridge', 'Boat', 'Jump', 'End'])
    expect(suggestCompilationText('T', withShort, 90_000).description).toContain('0:20 Boat (omie)\n0:49 Jump (omie)')
    // A short first clip keeps 0:00 and absorbs the next.
    expect(youtubeChapters([ch(0, 'A'), ch(5_000, 'B'), ch(30_000, 'C'), ch(60_000, 'D')], 90_000).map((c) => c.title)).toEqual(['A', 'C', 'D'])
  })
})
