import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClipService } from '../clips/service'
import { JobQueue } from '../jobs/queue'
import { ProjectService } from '../projects/service'
import { overlapRatio, snapToWords, toSentences } from '../shared/clips'
import type { YoutubeMeta } from '../shared/projects'
import type { Word } from '../shared/transcripts'
import { LocalStorage } from '../storage'
import { createTestDb } from '../testing'
import { TranscriptService } from '../transcripts/service'
import { ProposalService } from './service'

/** One word every 500 ms for a minute: "w0" … "w119", with a full stop every 10 words. */
const words: Word[] = Array.from({ length: 120 }, (_, i) => ({
  text: `w${i}${i % 10 === 9 ? '.' : ''}`,
  start: i * 500,
  end: i * 500 + 400,
  p: 0.9,
}))

let root: string
let queue: JobQueue
let projects: ProjectService
let clips: ClipService
let proposals: ProposalService
let projectId: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clipstudio-proposals-'))
  const db = createTestDb()
  queue = new JobQueue(db)
  projects = new ProjectService(db, queue, new LocalStorage(root))
  clips = new ClipService(db)
  proposals = new ProposalService(db, clips, projects)
  const transcripts = new TranscriptService(db, queue)

  const { project, sourceKey } = projects.createForUpload({ name: 'Podcast', filename: 'p.mp4' })
  projects.sourceReady(project.id, sourceKey, 10, 'video/mp4')
  projects.markReady(project.id, { durationMs: 60_000, width: 1920, height: 1080, fps: 30, hasAudio: true })
  for (const job of queue.activeForProject(project.id)) queue.requestCancel(job.id)
  transcripts.request(project.id)
  transcripts.complete(project.id, { engine: 'test', model: 'test', language: 'en', words })
  projectId = project.id
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('clip helpers', () => {
  it('snaps edges to whole words with a little room', () => {
    // 1.2 s is inside w2 (1000–1400); 9.1 s is between w18 (9000–9400) and w19.
    expect(snapToWords(words, 1200, 9100, 60_000)).toEqual({ startMs: 900, endMs: 9650 })
    expect(snapToWords([], 1200, 9100, 5000)).toEqual({ startMs: 1200, endMs: 5000 })
    // Whisper over music: one "word" stretched over 30 s. Edges inside it stay put instead of growing the clip.
    const song = [{ text: 'Thank', start: 20_000, end: 21_000, p: 0.3 }, { text: 'you.', start: 21_000, end: 51_000, p: 0.2 }]
    expect(snapToWords(song, 25_000, 40_000, 60_000)).toEqual({ startMs: 25_000, endMs: 40_000 })
  })

  it('measures overlap against the shorter range', () => {
    expect(overlapRatio({ startMs: 0, endMs: 10 }, { startMs: 5, endMs: 10 })).toBe(1)
    expect(overlapRatio({ startMs: 0, endMs: 10 }, { startMs: 10, endMs: 20 })).toBe(0)
  })

  it('splits sentences at full stops', () => {
    const sentences = toSentences(words)
    expect(sentences).toHaveLength(12)
    expect(sentences[0]).toMatchObject({ start: 0, end: 4900, text: 'w0 w1 w2 w3 w4 w5 w6 w7 w8 w9.' })
  })
})

describe('proposeClips', () => {
  it('creates a pending proposal with snapped clips and reports skipped ones', () => {
    const { proposal, skipped } = proposals.proposeClips({
      projectId,
      note: 'Two strong moments',
      client: 'claude-code',
      clips: [
        { startMs: 1200, endMs: 20_100, title: 'First #NoPixel #GTARP', score: 120, keywords: [' a ', ''] },
        { startMs: 30_000, endMs: 31_000, title: 'Tiny' },
        { startMs: 40_000, endMs: 70_000, title: 'Runs past the end' },
      ],
    })
    expect(proposal).toMatchObject({ kind: 'clips', status: 'pending', note: 'Two strong moments', client: 'claude-code', projectName: 'Podcast' })
    expect(proposal.clips.map((c) => [c.title, c.startMs, c.endMs, c.status, c.score])).toEqual([
      ['First', 900, 20_650, 'proposed', 100],
      ['Runs past the end', 39_900, 60_000, 'proposed', null],
    ])
    expect(proposal.clips[0]!.keywords).toEqual(['a'])
    expect(skipped).toEqual([{ title: 'Tiny', reason: expect.stringMatching(/Too short/) }])
    expect(proposals.pendingCount()).toBe(1)
  })

  it('refuses duplicates, within a batch and against existing clips', () => {
    expect(() =>
      proposals.proposeClips({ projectId, clips: [{ startMs: 0, endMs: 1000, title: 'x' }] }),
    ).toThrow(/None of the clips/)

    const { skipped } = proposals.proposeClips({
      projectId,
      clips: [
        { startMs: 0, endMs: 20_000, title: 'A' },
        { startMs: 500, endMs: 19_000, title: 'A again' },
      ],
    })
    expect(skipped[0]).toMatchObject({ title: 'A again' })
    expect(() => proposals.proposeClips({ projectId, clips: [{ startMs: 1000, endMs: 18_000, title: 'A third time' }] })).toThrow(/Overlaps/)
  })
})

describe('deciding', () => {
  it('finishes the proposal once every clip is decided', () => {
    const { proposal } = proposals.proposeClips({
      projectId,
      clips: [
        { startMs: 0, endMs: 15_000, title: 'One' },
        { startMs: 20_000, endMs: 35_000, title: 'Two' },
      ],
    })
    const [one, two] = proposal.clips
    const half = proposals.decideClips(proposal.id, [{ clipId: one!.id, approve: true }])
    expect(half.status).toBe('pending')
    const done = proposals.decideClips(proposal.id, [{ clipId: two!.id, approve: false }])
    expect(done.status).toBe('done')
    expect(clips.list(projectId).map((c) => [c.title, c.status])).toEqual([
      ['One', 'approved'],
      ['Two', 'rejected'],
    ])
    expect(proposals.pendingCount()).toBe(0)
    expect(() => proposals.decideClips(proposal.id, [{ clipId: one!.id, approve: false }])).toThrow(/already decided/)
  })

  it('dismissing rejects what is left', () => {
    const { proposal } = proposals.proposeClips({ projectId, clips: [{ startMs: 0, endMs: 15_000, title: 'One' }] })
    expect(proposals.dismiss(proposal.id).status).toBe('dismissed')
    expect(clips.list(projectId)[0]!.status).toBe('rejected')
  })

  it('rejects clips from another proposal', () => {
    const a = proposals.proposeClips({ projectId, clips: [{ startMs: 0, endMs: 15_000, title: 'One' }] }).proposal
    const b = proposals.proposeClips({ projectId, clips: [{ startMs: 30_000, endMs: 45_000, title: 'Two' }] }).proposal
    expect(() => proposals.decideClips(a.id, [{ clipId: b.clips[0]!.id, approve: true }])).toThrow(/not part of this proposal/)
  })

  it('an approved import starts the download', () => {
    const meta: YoutubeMeta = {
      videoId: 'aqz-KE-bpKQ',
      title: 'Big Buck Bunny',
      channel: 'Blender',
      durationSec: 635,
      uploadDate: null,
      thumbnailUrl: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg',
      license: null,
      isLive: false,
      maxHeight: 2160,
    }
    const p = proposals.proposeImport({ url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', meta, quality: '720', note: 'CC licensed' })
    expect(p).toMatchObject({ kind: 'import', title: 'Import “Big Buck Bunny”', projectId: null })
    const done = proposals.approveImport(p.id)
    expect(done.status).toBe('done')
    expect(projects.get(done.resultProjectId!)).toMatchObject({ status: 'importing', sourceId: 'aqz-KE-bpKQ' })
    expect(queue.activeForProject(done.resultProjectId!)[0]?.payload).toMatchObject({ quality: '720' })
  })
})

describe('manual clips', () => {
  it('are approved straight away and can be renamed', () => {
    const clip = clips.createManual(projectId, { startMs: 5000, endMs: 20_000, title: '  My pick ' })
    expect(clip).toMatchObject({ origin: 'manual', status: 'approved', title: 'My pick', startMs: 4900 })
    expect(clips.rename(clip.id, 'Better name').title).toBe('Better name')
  })

  it('are removed with their project', async () => {
    clips.createManual(projectId, { startMs: 5000, endMs: 20_000, title: 'x' })
    proposals.proposeClips({ projectId, clips: [{ startMs: 30_000, endMs: 45_000, title: 'y' }] })
    projects.trash(projectId)
    await projects.purge(projectId)
    expect(clips.list(projectId)).toEqual([])
    expect(proposals.pendingCount()).toBe(0)
  })
})
