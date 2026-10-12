import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClipService } from '../clips/service'
import { JobQueue } from '../jobs/queue'
import { ProjectService } from '../projects/service'
import { ProposalService } from '../proposals/service'
import { LocalStorage } from '../storage'
import { createTestDb } from '../testing'
import { RenderService } from './service'

let root: string
let queue: JobQueue
let projects: ProjectService
let clips: ClipService
let renders: RenderService
let proposals: ProposalService
let projectId: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clipstudio-renders-'))
  const db = createTestDb()
  queue = new JobQueue(db)
  projects = new ProjectService(db, queue, new LocalStorage(root))
  clips = new ClipService(db)
  renders = new RenderService(db, queue)
  proposals = new ProposalService(db, clips, projects)
  const { project, sourceKey } = projects.createForUpload({ name: 'Talk', filename: 't.mp4' })
  projects.sourceReady(project.id, sourceKey, 10, 'video/mp4')
  projects.markReady(project.id, { durationMs: 60_000, width: 1920, height: 1080, fps: 30, hasAudio: true })
  for (const job of queue.activeForProject(project.id)) queue.requestCancel(job.id)
  projectId = project.id
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('clip edits', () => {
  it('starts with defaults from the hook and saves validated edits with a version guard', () => {
    const { proposal } = proposals.proposeClips({
      projectId,
      clips: [{ startMs: 0, endMs: 20_000, title: 'One', hook: 'Look at this', emojis: { Money: '💰', '': 'x' } }],
    })
    const clip = proposal.clips[0]!
    expect(clip.version).toBe(1)
    expect(clip.edit.hook).toMatchObject({ enabled: true, text: 'Look at this' })
    expect(clip.edit.emojis).toEqual({ money: '💰' })

    const edit = { ...clip.edit, captions: { ...clip.edit.captions, preset: 'pop' } }
    const saved = clips.update(clip.id, { edit, title: 'Better', endMs: 18_000 }, 1)
    expect(saved).toMatchObject({ version: 2, title: 'Better', endMs: 18_000 })
    expect(saved.edit.captions.preset).toBe('pop')

    expect(() => clips.update(clip.id, { title: 'x' }, 1)).toThrow(/changed somewhere else/)
    expect(() => clips.update(clip.id, { edit: { nonsense: true } }, 2)).toThrow(/Invalid edit/)
    expect(() => clips.update(clip.id, { endMs: 1000 }, 2)).toThrow(/at least 3 s/)
    expect(() => clips.update(clip.id, { endMs: 90_000 }, 2)).toThrow(/inside the video/)
  })
})

describe('RenderService', () => {
  it('queues one export per clip version and tracks its outcome', () => {
    const clip = clips.createManual(projectId, { startMs: 0, endMs: 15_000, title: 'Mine' })
    const first = renders.request(clip.id)
    expect(first).toMatchObject({ status: 'queued', clipVersion: 1 })
    expect(renders.request(clip.id).id).toBe(first.id)
    expect(queue.activeForProject(projectId).find((j) => j.type === 'clip.render')?.payload).toEqual({ renderId: first.id })

    renders.markRunning(first.id)
    renders.complete(first.id, { storageKey: 'projects/x/renders/a.mp4', bytes: 1000, durationMs: 15_000 })
    expect(clips.require(clip.id).render).toMatchObject({ status: 'done', bytes: 1000 })

    // After an edit, a new export is a new render.
    clips.update(clip.id, { title: 'Mine 2' }, 1)
    const second = renders.request(clip.id)
    expect(second.id).not.toBe(first.id)
    expect(second.clipVersion).toBe(2)
    expect(renders.listForClip(clip.id).map((r) => r.id)).toEqual([second.id, first.id])
  })

  it('refuses clips that are not approved, and records failures', () => {
    const { proposal } = proposals.proposeClips({ projectId, clips: [{ startMs: 0, endMs: 15_000, title: 'Pending' }] })
    expect(() => renders.request(proposal.clips[0]!.id)).toThrow(/Approve the clip/)

    const clip = clips.createManual(projectId, { startMs: 20_000, endMs: 35_000, title: 'Mine' })
    const r = renders.request(clip.id)
    const job = queue.activeForProject(projectId).find((j) => j.type === 'clip.render')!
    queue.requestCancel(job.id)
    renders.jobGaveUp(queue.get(job.id)!, 'cancelled')
    expect(renders.dto(r.id)).toMatchObject({ status: 'failed', error: 'Cancelled' })
  })
})
