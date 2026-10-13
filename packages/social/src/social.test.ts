import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AccountService,
  ClipService,
  JobQueue,
  LocalStorage,
  PostService,
  ProjectService,
  RenderService,
  accounts as accountsTable,
} from '@clipstudio/core'
import { createTestDb } from '@clipstudio/core/testing'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SocialError } from './errors'
import { challengeBase64Url, challengeHex, codeVerifier } from './pkce'
import { accessToken, publishPost, type SocialApps } from './publish'
import { collectPostStats } from './stats'
import { editPostText, reschedulePost } from './edit'
import { YOUTUBE_EDIT_SCOPE } from './youtube'
import { parseTwitchDuration, resetTwitchToken, twitchVod, twitchVodClips } from './twitch-api'
import { tiktokAuthUrl, tiktokChunks, tiktokError, tiktokExchangeCode } from './tiktok'
import { youtubeAuthUrl, youtubeError, youtubeExchangeCode, youtubeProfile } from './youtube'

// ── A fake YouTube + TikTok, recording what it was sent ──────────────
interface Seen {
  method: string
  path: string
  headers: IncomingMessage['headers']
  body: Buffer
}
let server: Server
let base = ''
const seen: Seen[] = []
let tiktokPolls = 0
let twitchTokens = 0
let twitchExpireFirst = false

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = Buffer.concat(chunks)
    const url = new URL(req.url!, base)
    seen.push({ method: req.method!, path: url.pathname, headers: req.headers, body })
    const form = new URLSearchParams(body.toString())

    // Google
    if (url.pathname === '/google/token') {
      if (form.get('grant_type') === 'refresh_token') return json(res, 200, { access_token: 'yt-fresh', expires_in: 3600, scope: 'a b' })
      return json(res, 200, { access_token: 'yt-access', refresh_token: 'yt-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/youtube.upload' })
    }
    if (url.pathname === '/yt/channels') {
      return json(res, 200, { items: [{ id: 'UC123', snippet: { title: 'My Channel', customUrl: '@mychannel', thumbnails: { default: { url: 'https://img/a.jpg' } } } }] })
    }
    if (url.pathname === '/yt/videos' && req.method === 'GET') {
      const ids = (url.searchParams.get('id') ?? '').split(',')
      return json(res, 200, { items: ids.filter((id) => id === 'vid42').map((id) => ({ id, statistics: { viewCount: '1234', likeCount: '56', commentCount: '7' } })) })
    }
    if (url.pathname === '/yt/videos' && req.method === 'PUT') return json(res, 200, { id: 'vid42' })
    if (url.pathname === '/ytup/videos' && req.method === 'POST') return json(res, 200, {}, { location: `${base}/ytup/session/1` })
    if (url.pathname === '/ytup/session/1' && req.method === 'PUT') return json(res, 200, { id: 'vid42' })

    // TikTok
    if (url.pathname === '/tt/v2/oauth/token/') {
      return json(res, 200, { access_token: 'tt-access', refresh_token: 'tt-refresh', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'open-1', scope: 'user.info.basic,video.publish' })
    }
    if (url.pathname === '/tt/v2/post/publish/creator_info/query/') {
      return json(res, 200, {
        data: {
          creator_username: 'maker',
          creator_nickname: 'Maker',
          privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
          comment_disabled: false,
          duet_disabled: true,
          stitch_disabled: false,
          max_video_post_duration_sec: 600,
        },
        error: { code: 'ok' },
      })
    }
    if (url.pathname === '/tt/v2/post/publish/video/init/' || url.pathname === '/tt/v2/post/publish/inbox/video/init/') {
      return json(res, 200, { data: { publish_id: 'pub-1', upload_url: `${base}/tt/upload` }, error: { code: 'ok' } })
    }
    if (url.pathname === '/tt/upload') {
      const [, , end, total] = /bytes (\d+)-(\d+)\/(\d+)/.exec(req.headers['content-range'] ?? '') ?? []
      res.writeHead(Number(end) + 1 === Number(total) ? 201 : 206)
      return res.end()
    }
    if (url.pathname === '/tt/v2/post/publish/status/fetch/') {
      tiktokPolls++
      const done = tiktokPolls >= 2
      return json(res, 200, { data: done ? { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [7123] } : { status: 'PROCESSING_UPLOAD' }, error: { code: 'ok' } })
    }
    if (url.pathname === '/tt/v2/video/query/') {
      const ids = (JSON.parse(body.toString()) as { filters: { video_ids: string[] } }).filters.video_ids
      return json(res, 200, { data: { videos: ids.map((id) => ({ id, view_count: 900, like_count: 80, comment_count: 4, share_count: 3 })) }, error: { code: 'ok' } })
    }
    // Twitch Helix (app token)
    if (url.pathname === '/twitch/token') {
      twitchTokens++
      return json(res, 200, { access_token: `app-${twitchTokens}`, expires_in: 3600 })
    }
    if (url.pathname.startsWith('/helix/')) {
      if (req.headers.authorization === 'Bearer app-1' && twitchExpireFirst) return json(res, 401, { message: 'Invalid OAuth token' })
      if (url.pathname === '/helix/videos') {
        return json(res, 200, { data: [{ id: '42', user_id: '777', user_login: 'smallstreamer', title: 'Ranked', created_at: '2026-10-01T18:00:00Z', duration: '3h2m1s' }] })
      }
      if (url.pathname === '/helix/clips') {
        const page2 = url.searchParams.get('after') === 'p2'
        const clip = (id: string, video: string, views: number, offset: number | null) => ({
          id, url: `https://clips.twitch.tv/${id}`, title: id, view_count: views, video_id: video, vod_offset: offset, duration: 30, created_at: '2026-10-01T19:00:00Z', creator_name: 'fan',
        })
        return json(res, 200, page2
          ? { data: [clip('C', '42', 900, 7200)], pagination: {} }
          : { data: [clip('A', '42', 50, 600), clip('B', '99', 9999, 10)], pagination: { cursor: 'p2' } })
      }
    }
    json(res, 404, { error: 'not found' })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => server.close())

const yt = () => ({ auth: `${base}/google/auth`, token: `${base}/google/token`, revoke: `${base}/google/revoke`, api: `${base}/yt`, upload: `${base}/ytup` })
const tt = () => ({ auth: `${base}/tt/auth`, api: `${base}/tt` })
const app = { clientId: 'client', clientSecret: 'secret', redirectUri: 'http://127.0.0.1:3000/api/auth/x/callback' }

describe('PKCE and sign-in URLs', () => {
  it('builds Google and TikTok authorisation URLs with the right challenge encodings', () => {
    const v = codeVerifier()
    expect(v).toMatch(/^[A-Za-z0-9_-]{64}$/)
    const g = new URL(youtubeAuthUrl(app, 'st', v, yt()))
    expect(g.searchParams.get('code_challenge')).toBe(challengeBase64Url(v))
    expect(g.searchParams.get('access_type')).toBe('offline')
    const t = new URL(tiktokAuthUrl(app, 'st', v, tt()))
    expect(t.searchParams.get('code_challenge')).toBe(challengeHex(v))
    expect(t.searchParams.get('code_challenge')).toMatch(/^[0-9a-f]{64}$/)
    expect(t.searchParams.get('scope')).toBe('user.info.basic,video.publish,video.upload,video.list')
  })

  it('exchanges codes, sending the verifier', async () => {
    seen.length = 0
    const g = await youtubeExchangeCode(app, 'code1', 'verifier1', yt())
    expect(g).toMatchObject({ accessToken: 'yt-access', refreshToken: 'yt-refresh' })
    expect(new URLSearchParams(seen[0]!.body.toString()).get('code_verifier')).toBe('verifier1')
    const t = await tiktokExchangeCode(app, 'code2', 'verifier2', tt())
    expect(t).toMatchObject({ accessToken: 'tt-access', openId: 'open-1', scopes: ['user.info.basic', 'video.publish'] })
    const ttForm = new URLSearchParams(seen[1]!.body.toString())
    expect(ttForm.get('client_key')).toBe('client')
    expect(ttForm.get('code_verifier')).toBe('verifier2')
    expect(await youtubeProfile('x', yt())).toEqual({ externalId: 'UC123', displayName: 'My Channel', username: '@mychannel', avatarUrl: 'https://img/a.jpg' })
  })
})

describe('TikTok chunking', () => {
  it('follows the 5–64 MB rules', () => {
    expect(tiktokChunks(3_000_000)).toMatchObject({ chunkSize: 3_000_000, count: 1, ranges: [[0, 2_999_999]] })
    expect(tiktokChunks(50_000_123)).toMatchObject({ chunkSize: 50_000_123, count: 1 })
    const big = tiktokChunks(200_000_123)
    expect(big.chunkSize).toBe(10 * 1024 * 1024)
    expect(big.count).toBe(19)
    // The last chunk takes the remainder and stays under 128 MB.
    expect(big.ranges.at(-1)).toEqual([18 * 10 * 1024 * 1024, 200_000_122])
    expect(big.ranges.every(([a, b], i) => i === 0 || a === big.ranges[i - 1]![1] + 1)).toBe(true)
  })
})

describe('error messages', () => {
  it('turns platform errors into actions', () => {
    const q = youtubeError(403, { error: { message: 'x', errors: [{ reason: 'quotaExceeded' }] } })
    expect(q).toMatchObject({ kind: 'quota', retryable: false })
    expect(youtubeError(503, {}).retryable).toBe(true)
    expect(tiktokError(403, 'unaudited_client_can_only_post_to_private_accounts', '').message).toMatch(/private account/)
    expect(tiktokError(401, 'access_token_invalid', '')).toMatchObject({ kind: 'auth' })
  })
})

// ── The whole flow, with the real services ───────────────────────────
describe('publishPost', () => {
  let dir: string
  let posts: PostService
  let accounts: AccountService
  let queue: JobQueue
  let renderId: string
  let file: { path: string; bytes: number; mimeType: string }
  const apps: SocialApps = { youtube: app, tiktok: app }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'clipstudio-social-'))
    const db = createTestDb()
    queue = new JobQueue(db)
    const projects = new ProjectService(db, queue, new LocalStorage(dir))
    const clips = new ClipService(db)
    const renders = new RenderService(db, queue)
    posts = new PostService(db, queue)
    accounts = new AccountService(db, randomBytes(32))
    const { project, sourceKey } = projects.createForUpload({ name: 'P', filename: 'p.mp4' })
    projects.sourceReady(project.id, sourceKey, 10, 'video/mp4')
    projects.markReady(project.id, { durationMs: 60_000, width: 1920, height: 1080, fps: 30, hasAudio: true })
    const clip = clips.createManual(project.id, { startMs: 0, endMs: 15_000, title: 'Clip' })
    renderId = renders.request(clip.id).id
    renders.complete(renderId, { storageKey: 'x.mp4', bytes: 6_000_000, durationMs: 15_000 })
    file = { path: join(dir, 'video.mp4'), bytes: 6_000_000, mimeType: 'video/mp4' }
    await writeFile(file.path, Buffer.alloc(file.bytes, 1))

    // Keep the account secrets out of the stored row.
    ;(globalThis as { __db?: typeof db }).__db = db
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('stores tokens encrypted and refreshes them before they expire', async () => {
    const a = accounts.connect('youtube', { externalId: 'UC1', displayName: 'Chan', username: null, avatarUrl: null }, {
      accessToken: 'old-access',
      refreshToken: 'r1',
      expiresAt: Date.now() + 30_000,
      refreshExpiresAt: null,
      scopes: [],
    })
    const db = (globalThis as { __db?: ReturnType<typeof createTestDb> }).__db!
    expect(db.select().from(accountsTable).all()[0]!.tokens).not.toContain('old-access')
    expect(await accessToken(accounts, apps, a.id, { youtube: yt() })).toBe('yt-fresh')
    expect(accounts.tokens(a.id)).toMatchObject({ accessToken: 'yt-fresh', refreshToken: 'r1' })
  })

  it('uploads to YouTube with the resumable protocol', async () => {
    const a = accounts.connect('youtube', { externalId: 'UC1', displayName: 'Chan', username: null, avatarUrl: null }, {
      accessToken: 'tok',
      refreshToken: 'r',
      expiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: null,
      scopes: [],
    })
    const post = posts.create({ renderId, accountId: a.id, title: 'Hello #Shorts', description: 'd', youtube: { privacy: 'unlisted', tags: ['x'], madeForKids: false } })
    seen.length = 0
    const result = await publishPost({ posts, accounts, apps, endpoints: { youtube: yt() } }, post.id, file)
    expect(result).toEqual({ status: 'published', url: 'https://www.youtube.com/shorts/vid42' })
    const start = seen.find((s) => s.path === '/ytup/videos')!
    expect(start.headers['x-upload-content-length']).toBe('6000000')
    expect(JSON.parse(start.body.toString())).toMatchObject({ snippet: { title: 'Hello #Shorts', tags: ['x'] }, status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false } })
    expect(seen.find((s) => s.path === '/ytup/session/1')!.body.length).toBe(6_000_000)
    expect(posts.dto(post.id)).toMatchObject({ status: 'published', remoteId: 'vid42' })
  })

  it('posts to TikTok in order-checked chunks, waits for processing, and never uploads twice', async () => {
    const a = accounts.connect('tiktok', { externalId: 'open-1', displayName: 'Maker', username: null, avatarUrl: null }, {
      accessToken: 'tok',
      refreshToken: 'r',
      expiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: null,
      scopes: [],
    })
    const options = { mode: 'direct' as const, privacy: 'PUBLIC_TO_EVERYONE' as const, allowComments: true, allowDuet: true, allowStitch: true, brandContent: false, brandOrganic: false, aiGenerated: false }
    const post = posts.create({ renderId, accountId: a.id, title: 'caption #tag', tiktok: options })
    seen.length = 0
    tiktokPolls = 0
    const result = await publishPost({ posts, accounts, apps, endpoints: { tiktok: tt() }, pollMs: 5 }, post.id, file)
    expect(result).toEqual({ status: 'published', url: 'https://www.tiktok.com/@maker/video/7123' })

    const init = JSON.parse(seen.find((s) => s.path === '/tt/v2/post/publish/video/init/')!.body.toString())
    expect(init.post_info).toMatchObject({ title: 'caption #tag', privacy_level: 'PUBLIC_TO_EVERYONE', disable_duet: true, disable_comment: false })
    expect(init.source_info).toEqual({ source: 'FILE_UPLOAD', video_size: 6_000_000, chunk_size: 6_000_000, total_chunk_count: 1 })
    expect(seen.filter((s) => s.path === '/tt/upload').map((s) => s.headers['content-range'])).toEqual(['bytes 0-5999999/6000000'])

    // A retry after the upload (status "processing" with a publish id) only polls.
    posts.setStatus(post.id, 'processing', { remoteId: 'pub-1' })
    seen.length = 0
    tiktokPolls = 0
    await publishPost({ posts, accounts, apps, endpoints: { tiktok: tt() }, pollMs: 5 }, post.id, file)
    expect(seen.some((s) => s.path.includes('/init/'))).toBe(false)
    expect(seen.some((s) => s.path === '/tt/upload')).toBe(false)
  })

  it('plans view checks after posting and stores what the platforms report', async () => {
    const tokens = { accessToken: 'tok', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, refreshExpiresAt: null }
    const y = accounts.connect('youtube', { externalId: 'UC1', displayName: 'Chan', username: null, avatarUrl: null }, { ...tokens, scopes: [] })
    const post = posts.create({ renderId, accountId: y.id, title: 'Hello', youtube: { privacy: 'public', tags: [], madeForKids: false } })
    await publishPost({ posts, accounts, apps, endpoints: { youtube: yt() } }, post.id, file)
    const live = posts.get(post.id)!.publishedAt!.getTime()
    const checks = queue.listRecent(50).filter((j) => j.type === 'post.stats')
    expect(checks.map((j) => Math.round((j.runAt.getTime() - live) / 3_600_000)).sort((a, b) => a - b)).toEqual([48, 168])

    expect(await collectPostStats({ posts, accounts, apps, endpoints: { youtube: yt() } }, post.id)).toEqual({ views: 1234 })
    expect(posts.insights()[0]!.readings[0]).toMatchObject({ views: 1234, likes: 56, comments: 7, shares: null })

    // TikTok: needs the video.list permission, which older sign-ins lack.
    const options = { mode: 'direct' as const, privacy: 'PUBLIC_TO_EVERYONE' as const, allowComments: true, allowDuet: true, allowStitch: true, brandContent: false, brandOrganic: false, aiGenerated: false }
    const t = accounts.connect('tiktok', { externalId: 'open-1', displayName: 'Maker', username: null, avatarUrl: null }, { ...tokens, scopes: ['video.publish'] })
    const tp = posts.create({ renderId, accountId: t.id, title: 'c', tiktok: options })
    tiktokPolls = 0
    await publishPost({ posts, accounts, apps, endpoints: { tiktok: tt() }, pollMs: 5 }, tp.id, file)
    expect(posts.get(tp.id)!.remoteId).toBe('7123')
    expect(await collectPostStats({ posts, accounts, apps, endpoints: { tiktok: tt() } }, tp.id)).toMatchObject({ skipped: expect.stringMatching(/Reconnect/) })
    accounts.connect('tiktok', { externalId: 'open-1', displayName: 'Maker', username: null, avatarUrl: null }, { ...tokens, scopes: ['video.publish', 'video.list'] })
    expect(await collectPostStats({ posts, accounts, apps, endpoints: { tiktok: tt() } }, tp.id)).toEqual({ views: 900 })
  })

  it('edits a video on YouTube only with the edit permission, and saves only what YouTube accepted', async () => {
    const tokens = { accessToken: 'tok', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, refreshExpiresAt: null }
    const old = accounts.connect('youtube', { externalId: 'UC1', displayName: 'Chan', username: null, avatarUrl: null }, { ...tokens, scopes: [] })
    const post = posts.create({ renderId, accountId: old.id, title: 'Old title', youtube: { privacy: 'public', tags: [], madeForKids: false } })
    posts.setStatus(post.id, 'published', { remoteId: 'vid42', publishedAt: new Date() })

    await expect(editPostText({ posts, accounts, apps, endpoints: { youtube: yt() } }, post.id, { title: 'New' })).rejects.toThrow(/Reconnect YouTube/)
    expect(posts.dto(post.id).title).toBe('Old title')

    accounts.connect('youtube', { externalId: 'UC1', displayName: 'Chan', username: null, avatarUrl: null }, { ...tokens, scopes: [YOUTUBE_EDIT_SCOPE] })
    seen.length = 0
    const updated = await editPostText({ posts, accounts, apps, endpoints: { youtube: yt() } }, post.id, {
      title: 'Marty saves Lang #Shorts',
      description: '#NoPixel #GTARP',
      tags: ['nopixel'],
    })
    const put = seen.find((x) => x.path === '/yt/videos' && x.method === 'PUT')!
    expect(JSON.parse(put.body.toString())).toEqual({
      id: 'vid42',
      snippet: { title: 'Marty saves Lang #Shorts', description: '#NoPixel #GTARP', tags: ['nopixel'], categoryId: '24' },
    })
    expect(updated).toMatchObject({ title: 'Marty saves Lang #Shorts', description: '#NoPixel #GTARP' })
  })

  it('moves a scheduled YouTube video on YouTube first, and its view checks with it', async () => {
    const tokens = { accessToken: 'tok', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, refreshExpiresAt: null }
    const a = accounts.connect('youtube', { externalId: 'UC1', displayName: 'Chan', username: null, avatarUrl: null }, { ...tokens, scopes: [YOUTUBE_EDIT_SCOPE] })
    const oldTime = Date.now() + 5 * 3_600_000
    const post = posts.create({ renderId, accountId: a.id, title: 'Jump', scheduledAt: oldTime, youtube: { privacy: 'public', tags: [], madeForKids: false } })
    posts.setStatus(post.id, 'scheduled', { remoteId: 'vid42' })
    const statsRuns = () =>
      queue.listRecent(50).filter((j) => j.type === 'post.stats' && j.status === 'queued' && (j.payload as { postId: string }).postId === post.id).map((j) => j.runAt.getTime())
    expect(statsRuns()).toContain(oldTime + 48 * 3_600_000)

    const newTime = oldTime + 2.5 * 3_600_000
    seen.length = 0
    const moved = await reschedulePost({ posts, accounts, apps, endpoints: { youtube: yt() } }, post.id, newTime)
    const put = seen.find((x) => x.path === '/yt/videos' && x.method === 'PUT')!
    expect(JSON.parse(put.body.toString())).toEqual({
      id: 'vid42',
      status: { privacyStatus: 'private', publishAt: new Date(newTime).toISOString(), selfDeclaredMadeForKids: false },
    })
    expect(moved).toMatchObject({ status: 'scheduled', scheduledAt: newTime })
    expect(statsRuns().sort()).toEqual([newTime + 48 * 3_600_000, newTime + 7 * 24 * 3_600_000])

    await expect(reschedulePost({ posts, accounts, apps, endpoints: { youtube: yt() } }, post.id, Date.now() + 60_000)).rejects.toThrow(/15 minutes/)
    await expect(reschedulePost({ posts, accounts, apps, endpoints: { youtube: yt() } }, post.id, null)).rejects.toThrow(/already on YouTube/)
  })

  it('refuses a privacy level the creator does not offer', async () => {
    const a = accounts.connect('tiktok', { externalId: 'open-1', displayName: 'Maker', username: null, avatarUrl: null }, {
      accessToken: 'tok',
      refreshToken: 'r',
      expiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: null,
      scopes: [],
    })
    const post = posts.create({
      renderId,
      accountId: a.id,
      title: '',
      tiktok: { mode: 'direct', privacy: 'FOLLOWER_OF_CREATOR', allowComments: true, allowDuet: true, allowStitch: true, brandContent: false, brandOrganic: false, aiGenerated: false },
    })
    await expect(publishPost({ posts, accounts, apps, endpoints: { tiktok: tt() } }, post.id, file)).rejects.toBeInstanceOf(SocialError)
  })

  it('marks a TikTok post missed instead of posting it long after its time', async () => {
    const a = accounts.connect('tiktok', { externalId: 'open-1', displayName: 'Maker', username: null, avatarUrl: null }, {
      accessToken: 'tok',
      refreshToken: 'r',
      expiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: null,
      scopes: [],
    })
    const post = posts.create({
      renderId,
      accountId: a.id,
      title: '',
      scheduledAt: Date.now() + 5 * 60_000,
      tiktok: { mode: 'direct', privacy: 'SELF_ONLY', allowComments: true, allowDuet: true, allowStitch: true, brandContent: false, brandOrganic: false, aiGenerated: false },
    })
    // Pretend the Mac slept through it: the time was 20 minutes ago.
    posts.reschedule(post.id, Date.now() + 3 * 60_000)
    const db = (globalThis as { __db?: ReturnType<typeof createTestDb> }).__db!
    const { posts: postsTable } = await import('@clipstudio/core')
    const { eq } = await import('drizzle-orm')
    db.update(postsTable).set({ scheduledAt: new Date(Date.now() - 20 * 60_000) }).where(eq(postsTable.id, post.id)).run()
    seen.length = 0
    const result = await publishPost({ posts, accounts, apps, endpoints: { tiktok: tt() } }, post.id, file)
    expect(result.status).toBe('missed')
    expect(seen).toEqual([])
    expect(posts.dto(post.id).status).toBe('missed')
  })

  it('validates posts before queueing them', () => {
    const a = accounts.connect('youtube', { externalId: 'UC1', displayName: 'Chan', username: null, avatarUrl: null }, {
      accessToken: 'tok',
      refreshToken: 'r',
      expiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: null,
      scopes: [],
    })
    expect(() => posts.create({ renderId, accountId: a.id, title: 'x'.repeat(101), youtube: { privacy: 'public', tags: [], madeForKids: false } })).toThrow(/100 characters/)
    expect(() => posts.create({ renderId, accountId: a.id, title: 'a <b>', youtube: { privacy: 'public', tags: [], madeForKids: false } })).toThrow(/< or >/)
    accounts.markNeedsReconnect(a.id)
    expect(() => posts.create({ renderId, accountId: a.id, title: 'ok', youtube: { privacy: 'public', tags: [], madeForKids: false } })).toThrow(/Reconnect/)
  })
})

describe('Twitch API (app token)', () => {
  const app = { clientId: 'cid', clientSecret: 'sec' }
  const ep = () => ({ token: `${base}/twitch/token`, api: `${base}/helix` })

  it('reads a VOD and the clips viewers made from it, most viewed first', async () => {
    resetTwitchToken()
    twitchTokens = 0
    twitchExpireFirst = false
    const vod = (await twitchVod(app, 'v42', ep()))!
    expect(vod).toMatchObject({ id: '42', userId: '777', durationSec: 3 * 3600 + 2 * 60 + 1 })
    const clips = await twitchVodClips(app, vod, ep())
    // Clip B belongs to another VOD; both pages are read.
    expect(clips.map((c) => [c.id, c.vodOffsetSec])).toEqual([['C', 7200], ['A', 600]])
  })

  it('gets a fresh token when Twitch says the old one expired', async () => {
    resetTwitchToken()
    twitchTokens = 0
    twitchExpireFirst = true
    expect(await twitchVod(app, '42', ep())).not.toBeNull()
    expect(twitchTokens).toBe(2)
    twitchExpireFirst = false
  })

  it('parses Twitch durations', () => {
    expect(parseTwitchDuration('1h0m5s')).toBe(3605)
    expect(parseTwitchDuration('45s')).toBe(45)
    expect(parseTwitchDuration('nonsense')).toBe(0)
  })
})
