import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JobQueue } from '../jobs/queue'
import { ProjectService } from '../projects/service'
import { ProposalService } from '../proposals/service'
import { evaluationState, evaluationTotal, lengthAdvice, trimLeadIn, type EvaluationInput } from '../shared/evaluation'
import type { Word } from '../shared/transcripts'
import { LocalStorage } from '../storage'
import { createTestDb } from '../testing'
import { TranscriptService } from '../transcripts/service'
import { ClipService, cleanCuts } from './service'

/** Words 500 ms apart from `at` (ms). */
function say(text: string, at = 0): Word[] {
  return text.split(' ').map((t, i) => ({ text: t, start: at + i * 500, end: at + i * 500 + 400, p: 0.9 }))
}

const evaluation = (over: Partial<EvaluationInput> = {}): EvaluationInput => ({
  hook: 9,
  pacing: 7,
  payoff: 8,
  standalone: 6,
  hookNotes: 'Opens on the result.',
  retentionRisk: 'A slow patch at 12 s.',
  payoffNotes: 'Promise kept.',
  muteTest: 'weak',
  muteNotes: 'Mostly talk.',
  suggestedStartSec: null,
  suggestedEndSec: null,
  trimNotes: '',
  ...over,
})

describe('rubric maths', () => {
  it('weights the pillars 40/30/20/10 and rounds to one decimal', () => {
    expect(evaluationTotal({ hook: 9, pacing: 7, payoff: 8, standalone: 6 })).toBe(7.9)
    expect(evaluationTotal({ hook: 10, pacing: 10, payoff: 10, standalone: 10 })).toBe(10)
  })

  it('judges length against the 22–45 s sweet spot', () => {
    expect(lengthAdvice(12_000).tone).toBe('warn')
    expect(lengthAdvice(18_000).tone).toBe('ok')
    expect(lengthAdvice(30_000).tone).toBe('good')
    expect(lengthAdvice(48_000).tone).toBe('ok')
    expect(lengthAdvice(55_000).tone).toBe('warn')
  })
})

describe('trimLeadIn', () => {
  const tail = say(Array.from({ length: 60 }, (_, i) => `point${i}`).join(' '), 10_000)

  it('drops a greeting sentence and opening filler', () => {
    const words = [...say('Hey guys, welcome back to the channel. So, um, okay', 0), ...tail]
    // "So, um, okay" are words 7–9; the clip should start at "point0" (10 s), minus a little room.
    expect(trimLeadIn(words, 0, 40_000)).toBe(10_000 - 120)
  })

  it('matches greetings the way Whisper writes them (commas, no full stop)', () => {
    // Real whisper.cpp output for the e2e clip: "Hey guys, welcome back to the channel, so, um, here is the thing, …"
    const words = [...say('Hey guys, welcome back to the channel, so, um,', 0), ...tail]
    expect(trimLeadIn(words, 0, 40_000)).toBe(10_000 - 120)
    // Only the greeting goes; the sentence after it stays whole.
    const life = [...say('Hey guys, this video changed my life', 8_000), ...tail]
    expect(trimLeadIn(life, 8_000, 40_000)).toBe(9_000 - 120)
    expect(trimLeadIn([...say("What's up everyone and welcome to my podcast. Today", 6_000), ...tail], 6_000, 40_000)).toBe(6_000 + 8 * 500 - 120)
  })

  it('handles "all right" and keeps meaningful openers', () => {
    expect(trimLeadIn([...say('All right, so', 8_500), ...tail], 8_500, 40_000)).toBe(10_000 - 120)
    expect(trimLeadIn([...say('Like most people I', 8_000), ...tail], 8_000, 40_000)).toBe(8_000)
    expect(trimLeadIn([...say('Hey Siri broke my', 8_000), ...tail], 8_000, 40_000)).toBe(8_000)
    expect(trimLeadIn([...say("Hey, that's not how", 8_000), ...tail], 8_000, 40_000)).toBe(8_000)
  })

  it('leaves the start alone when trimming would leave too little', () => {
    const words = [...say('So um well anyway', 0), ...say('short point here.', 2_000)]
    expect(trimLeadIn(words, 0, 12_000)).toBe(0)
  })
})

describe('evaluations on clips', () => {
  let root: string
  let clips: ClipService
  let proposals: ProposalService
  let projectId: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'clipstudio-eval-'))
    const db = createTestDb()
    const queue = new JobQueue(db)
    const projects = new ProjectService(db, queue, new LocalStorage(root))
    clips = new ClipService(db)
    proposals = new ProposalService(db, clips, projects)
    const transcripts = new TranscriptService(db, queue)
    const { project, sourceKey } = projects.createForUpload({ name: 'Talk', filename: 't.mp4' })
    projects.sourceReady(project.id, sourceKey, 10, 'video/mp4')
    projects.markReady(project.id, { durationMs: 120_000, width: 1920, height: 1080, fps: 30, hasAudio: true })
    for (const job of queue.activeForProject(project.id)) queue.requestCancel(job.id)
    transcripts.request(project.id)
    const words = [...say('Hey everyone, welcome back. So', 0), ...say(Array.from({ length: 200 }, (_, i) => `w${i}${i % 10 === 9 ? '.' : ''}`).join(' '), 4_000)]
    transcripts.complete(project.id, { engine: 'test', model: 'test', language: 'en', words })
    projectId = project.id
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('stores a proposal’s evaluation, scores it from the pillars and trims the greeting', () => {
    const { proposal } = proposals.proposeClips({
      projectId,
      client: 'claude-code',
      clips: [{ startMs: 0, endMs: 34_000, title: 'Opener', score: 12, evaluation: evaluation({ suggestedStartSec: 9.1, suggestedEndSec: 31.2, trimNotes: 'Start on the claim.' }) }],
    })
    const clip = proposal.clips[0]!
    expect(clip.startMs).toBe(4_000 - 120)
    expect(clip.score).toBe(79)
    expect(clip.evaluation).toMatchObject({ total: 7.9, by: 'claude-code', muteTest: 'weak', evaluatedStartMs: clip.startMs, trimNotes: 'Start on the claim.' })
    // Suggested edges are snapped to words: 9.1 s is inside w10 (9000–9400), 31.2 s is just after w54.
    expect(clip.evaluation!.suggestedStartMs).toBe(8_900)
    expect(clip.evaluation!.suggestedEndMs).toBeGreaterThan(31_000)
  })

  it('saves an evaluation as a note and applies the trim only when asked', () => {
    const manual = clips.createManual(projectId, { startMs: 10_000, endMs: 40_000, title: 'Mine' })
    const evaluated = clips.setEvaluation(manual.id, evaluation({ hook: 4, suggestedStartSec: 15, suggestedEndSec: 39.9 }), 'In-app AI (Claude Opus 5.5)')
    expect(evaluated.version).toBe(manual.version)
    expect([evaluated.startMs, evaluated.endMs]).toEqual([manual.startMs, manual.endMs])
    expect(evaluated.evaluation!.total).toBe(5.9)
    expect(evaluationState(evaluated.evaluation!, evaluated)).toBe('current')

    const trimmed = clips.applySuggestedTrim(manual.id, evaluated.version)
    expect(trimmed.startMs).toBe(evaluated.evaluation!.suggestedStartMs)
    expect(trimmed.version).toBe(manual.version + 1)
    expect(evaluationState(trimmed.evaluation!, trimmed)).toBe('trimmed')

    // A suggestion within 0.3 s of the current edges isn't a suggestion.
    const tiny = clips.setEvaluation(manual.id, evaluation({ suggestedStartSec: trimmed.startMs / 1000 + 0.1, suggestedEndSec: null }), null)
    expect(tiny.evaluation!.suggestedStartMs).toBeNull()
    expect(() => clips.applySuggestedTrim(manual.id, tiny.version)).toThrow(/no suggested trim/)
  })
})

describe('clips with cuts', () => {
  it('keeps cuts inside the clip, merges overlaps and drops slivers', () => {
    expect(cleanCuts([{ start: 5_000, end: 9_000 }, { start: 8_000, end: 12_000 }, { start: 20_000, end: 20_100 }, { start: 0, end: 11_500 }], { startMs: 10_000, endMs: 40_000 })).toEqual([
      { start: 10_000, end: 12_000 },
    ])
    expect(cleanCuts([{ start: 10_000, end: 38_000 }], { startMs: 10_000, endMs: 40_000 })).toBeNull()
  })
})
