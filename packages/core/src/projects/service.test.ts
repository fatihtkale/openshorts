import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JobQueue } from '../jobs/queue'
import type { YoutubeMeta } from '../shared/projects'
import { LocalStorage } from '../storage'
import { createTestDb } from '../testing'
import { ProjectError, ProjectService } from './service'

const meta: YoutubeMeta = {
  videoId: 'aqz-KE-bpKQ',
  title: 'Big Buck Bunny',
  channel: 'Blender',
  durationSec: 635,
  uploadDate: '20141110',
  thumbnailUrl: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg',
  license: 'Creative Commons Attribution license (reuse allowed)',
  isLive: false,
  maxHeight: 2160,
}
const url = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'

let root: string
let clock: Date
let storage: LocalStorage
let queue: JobQueue
let projects: ProjectService

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clipstudio-projects-'))
  storage = new LocalStorage(root)
  const db = createTestDb()
  clock = new Date('2026-10-12T10:00:00Z')
  queue = new JobQueue(db, () => clock)
  projects = new ProjectService(db, queue, storage)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('YouTube import', () => {
  it('creates an importing project and queues its download', () => {
    const row = projects.createFromYoutube({ url, meta, quality: '720', range: { start: 10, end: 40 } })
    expect(row).toMatchObject({ name: 'Big Buck Bunny', status: 'importing', sourceId: 'aqz-KE-bpKQ' })
    const [job] = queue.activeForProject(row.id)
    expect(job).toMatchObject({ type: 'ingest.download', projectId: row.id })
    expect(job!.payload).toMatchObject({ quality: '720', range: { start: 10, end: 40 } })
  })

  it('rejects a backwards time range', () => {
    expect(() => projects.createFromYoutube({ url, meta, quality: '1080', range: { start: 40, end: 10 } })).toThrow(ProjectError)
  })

  it('finds existing imports of the same video, ignoring the Trash', () => {
    const row = projects.createFromYoutube({ url, meta, quality: '1080' })
    expect(projects.findByYoutubeId('aqz-KE-bpKQ')).toEqual([{ id: row.id, name: 'Big Buck Bunny' }])
    projects.trash(row.id)
    expect(projects.findByYoutubeId('aqz-KE-bpKQ')).toEqual([])
  })
})

describe('upload', () => {
  it('only accepts video file types', () => {
    expect(() => projects.createForUpload({ name: 'x', filename: 'notes.pdf' })).toThrow(/Unsupported file type/)
  })

  it('moves to processing once the source is stored', () => {
    const { project, sourceKey } = projects.createForUpload({ name: 'Talk', filename: 'talk.MOV' })
    expect(sourceKey).toBe(`projects/${project.id}/source.mov`)
    expect(projects.pendingUploadKey(project.id, 'talk.MOV')).toBe(sourceKey)

    projects.sourceReady(project.id, sourceKey, 1234, 'video/quicktime')
    const dto = projects.getDto(project.id)
    expect(dto.status).toBe('processing')
    expect(dto.assets.source?.bytes).toBe(1234)
    expect(queue.activeForProject(project.id).map((j) => j.type)).toEqual(['media.prepare'])
    expect(() => projects.pendingUploadKey(project.id, 'talk.MOV')).toThrow(/not waiting/)
  })
})

describe('failure and retry', () => {
  it('marks the project failed when its job gives up, and retries the download', () => {
    const row = projects.createFromYoutube({ url, meta, quality: '720' })
    let job = queue.claim('w', ['download'])!
    // Use up every attempt, waiting out the backoff between them.
    while (job.status !== 'failed') {
      job = queue.fail(job.id, 'w', 'Private video')!
      clock = new Date(clock.getTime() + 10 * 60_000)
      if (job.status === 'queued') job = queue.claim('w', ['download'])!
    }
    projects.jobGaveUp(job, 'failed')
    expect(projects.getDto(row.id)).toMatchObject({ status: 'failed', error: 'Private video' })

    const retried = projects.retry(row.id)
    expect(retried.status).toBe('importing')
    const download = queue.activeForProject(row.id).find((j) => j.type === 'ingest.download')
    expect(download?.payload).toMatchObject({ quality: '720' })
  })

  it('retries preparation when the source already exists', () => {
    const { project, sourceKey } = projects.createForUpload({ name: 'Talk', filename: 'talk.mp4' })
    projects.sourceReady(project.id, sourceKey, 10, 'video/mp4')
    const job = queue.activeForProject(project.id)[0]!
    queue.requestCancel(job.id)
    projects.jobGaveUp(queue.get(job.id)!, 'cancelled')
    expect(projects.getDto(project.id)).toMatchObject({ status: 'failed', error: 'Cancelled' })

    expect(projects.retry(project.id).status).toBe('processing')
  })

  it('refuses to retry an upload that never arrived', () => {
    const { project } = projects.createForUpload({ name: 'Talk', filename: 'talk.mp4' })
    projects.markFailed(project.id, 'The upload was interrupted.')
    expect(() => projects.retry(project.id)).toThrow(/upload the file again/)
  })
})

describe('Trash', () => {
  it('cancels work, hides the project, restores it, and purges files', async () => {
    const row = projects.createFromYoutube({ url, meta, quality: '1080' })
    await storage.put(`projects/${row.id}/source.mp4`, 'video')

    projects.trash(row.id)
    expect(queue.activeForProject(row.id)).toEqual([])
    expect(projects.list().map((p) => p.id)).not.toContain(row.id)
    expect(projects.list({ deleted: true }).map((p) => p.id)).toContain(row.id)

    projects.restore(row.id)
    expect(projects.list().map((p) => p.id)).toContain(row.id)

    await expect(projects.purge(row.id)).rejects.toThrow(/Trash first/)
    projects.trash(row.id)
    await projects.purge(row.id)
    expect(projects.get(row.id)).toBeNull()
    expect(await storage.list(`projects/${row.id}`)).toEqual([])
  })
})
