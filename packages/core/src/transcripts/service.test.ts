import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JobQueue } from '../jobs/queue'
import { ModelService } from '../models/service'
import { ProjectService } from '../projects/service'
import { WHISPER_MODELS, type Word } from '../shared/transcripts'
import { LocalStorage } from '../storage'
import { createTestDb } from '../testing'
import { TranscriptService } from './service'

let root: string
let clock: Date
let queue: JobQueue
let projects: ProjectService
let transcripts: TranscriptService
let models: ModelService

const words: Word[] = [
  { text: 'Hello', start: 0, end: 300, p: 0.95 },
  { text: 'wrold.', start: 400, end: 700, p: 0.2 },
]

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clipstudio-transcripts-'))
  clock = new Date('2026-10-12T10:00:00Z')
  const db = createTestDb()
  queue = new JobQueue(db, () => clock)
  projects = new ProjectService(db, queue, new LocalStorage(root), () => clock)
  transcripts = new TranscriptService(db, queue, () => clock)
  models = new ModelService(db, join(root, 'models'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A ready project, as if import had finished. */
function readyProject(hasAudio = true): string {
  const { project, sourceKey } = projects.createForUpload({ name: 'Talk', filename: 'talk.mp4' })
  projects.sourceReady(project.id, sourceKey, 10, 'video/mp4')
  projects.markReady(project.id, { durationMs: 1000, width: 1920, height: 1080, fps: 30, hasAudio })
  for (const job of queue.activeForProject(project.id)) queue.requestCancel(job.id)
  return project.id
}

describe('TranscriptService', () => {
  it('queues a transcription and shows it as pending', () => {
    const id = readyProject()
    const summary = transcripts.request(id, 'da')
    expect(summary).toMatchObject({ status: 'pending', requestedLanguage: 'da', wordCount: 0 })
    expect(queue.activeForProject(id).map((j) => j.type)).toEqual(['transcribe'])
    expect(() => transcripts.request(id)).toThrow(/already running/)
    expect(projects.getDto(id).transcript?.status).toBe('pending')
  })

  it('refuses projects that are not ready, silent, or unknown languages', () => {
    const { project } = projects.createForUpload({ name: 'x', filename: 'x.mp4' })
    expect(() => transcripts.request(project.id)).toThrow(/finish importing/)
    expect(() => transcripts.request(readyProject(false))).toThrow(/no sound/)
    expect(() => transcripts.request(readyProject(), 'english!')).toThrow(/Unknown language/)
  })

  it('stores words and lets single words be fixed', () => {
    const id = readyProject()
    transcripts.request(id)
    transcripts.complete(id, { engine: 'whisper.cpp', model: 'base', language: 'en', words })
    const before = transcripts.dto(id)
    expect(before).toMatchObject({ status: 'ready', language: 'en', wordCount: 2, edited: false })

    clock = new Date(clock.getTime() + 1000)
    const after = transcripts.edit(id, [{ index: 1, text: ' world. ' }], before.updatedAt)
    expect(after.words[1]).toEqual({ text: 'world.', start: 400, end: 700, p: 1 })
    expect(after.edited).toBe(true)

    expect(() => transcripts.edit(id, [{ index: 0, text: 'Hi' }], before.updatedAt)).toThrow(/changed since you opened it/)
    expect(() => transcripts.edit(id, [{ index: 9, text: 'x' }], after.updatedAt)).toThrow(/no word number 9/)
    expect(() => transcripts.edit(id, [{ index: 0, text: '  ' }], after.updatedAt)).toThrow(/cannot be empty/)
  })

  it('takes new timings for the same words, keeping text fixes', () => {
    const id = readyProject()
    expect(transcripts.readyProjectIds()).toEqual([])
    transcripts.request(id)
    transcripts.complete(id, { engine: 'whisper.cpp', model: 'base', language: 'en', words })
    const fixed = transcripts.edit(id, [{ index: 1, text: 'world.' }], transcripts.dto(id).updatedAt)
    expect(transcripts.readyProjectIds()).toEqual([id])

    transcripts.retime(id, [
      { start: 100, end: 350 },
      { start: 500, end: 690 },
    ])
    const after = transcripts.dto(id)
    expect(after.words).toEqual([
      { text: 'Hello', start: 100, end: 350, p: 0.95 },
      { text: 'world.', start: 500, end: 690, p: 1 },
    ])
    expect(after.edited).toBe(fixed.edited)
    expect(() => transcripts.retime(id, [{ start: 0, end: 1 }])).toThrow(/changed meanwhile/)
  })

  it('keeps the old words when a new transcription fails', () => {
    const id = readyProject()
    transcripts.request(id)
    transcripts.complete(id, { engine: 'whisper.cpp', model: 'base', language: 'en', words })
    // The worker would have marked the first job done.
    for (const job of queue.activeForProject(id)) queue.requestCancel(job.id)
    transcripts.request(id, 'en')
    const job = queue.activeForProject(id).find((j) => j.type === 'transcribe')!
    queue.requestCancel(job.id)
    transcripts.jobGaveUp(queue.get(job.id)!, 'cancelled')
    expect(transcripts.dto(id)).toMatchObject({ status: 'failed', error: 'Cancelled', wordCount: 2 })
  })

  it('is deleted with its project', async () => {
    const id = readyProject()
    transcripts.request(id)
    projects.trash(id)
    await projects.purge(id)
    expect(transcripts.get(id)).toBeNull()
  })
})

describe('ModelService', () => {
  it('only counts fully downloaded models and falls back to any installed one', async () => {
    const base = WHISPER_MODELS.find((m) => m.id === 'base')!
    expect(models.active()).toBeNull()
    expect(models.list().every((m) => !m.installed)).toBe(true)

    // Pretend the base model is on disk: a sparse file of the right size.
    await rm(join(root, 'models'), { recursive: true, force: true })
    const { mkdir, truncate } = await import('node:fs/promises')
    await mkdir(join(root, 'models'))
    await writeFile(models.path(base), '')
    expect(models.isInstalled(base)).toBe(false)
    await truncate(models.path(base), base.bytes)
    expect(models.isInstalled(base)).toBe(true)

    // The recommended model is "selected" by default but missing, so base is used.
    expect(models.active()?.id).toBe('base')
    expect(models.list().find((m) => m.selected)?.id).toBe('base')
    expect(() => models.select('large-v3-turbo')).toThrow(/Download this model/)

    await models.remove('base')
    expect(models.active()).toBeNull()
  })
})
