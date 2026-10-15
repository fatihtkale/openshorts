import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { projects, transcripts, type JobRow, type TranscriptRow } from '../db/schema'
import type { JobQueue } from '../jobs/queue'
import { ProjectError } from '../errors'
import type { TranscriptDto, TranscriptSummary, Word, WordEdit } from '../shared/transcripts'

const LANGUAGE_CODE = /^(auto|[a-z]{2,3})$/

export function toTranscriptSummary(row: Omit<TranscriptRow, 'words'>): TranscriptSummary {
  return {
    status: row.status,
    error: row.error,
    language: row.language,
    requestedLanguage: row.requestedLanguage,
    model: row.model,
    wordCount: row.wordCount,
    edited: row.edited,
    updatedAt: row.updatedAt.getTime(),
  }
}

export class TranscriptService {
  constructor(
    private readonly db: Db,
    private readonly queue: JobQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Projects with a finished transcript. */
  readyProjectIds(): string[] {
    return this.db.select({ id: transcripts.projectId }).from(transcripts).where(eq(transcripts.status, 'ready')).all().map((r) => r.id)
  }

  get(projectId: string): TranscriptRow | null {
    return this.db.select().from(transcripts).where(eq(transcripts.projectId, projectId)).get() ?? null
  }

  dto(projectId: string): TranscriptDto {
    const row = this.get(projectId)
    if (!row) throw new ProjectError('This project has no transcript yet', 'not_found')
    return { ...toTranscriptSummary(row), words: row.words }
  }

  /** Queues a (new) transcription. An existing transcript stays readable until the new one replaces it. */
  request(projectId: string, language = 'auto'): TranscriptSummary {
    if (!LANGUAGE_CODE.test(language)) throw new ProjectError(`Unknown language "${language}"`, 'invalid')
    const project = this.db.select().from(projects).where(eq(projects.id, projectId)).get()
    if (!project) throw new ProjectError('Project not found', 'not_found')
    if (project.status !== 'ready') throw new ProjectError('The video has to finish importing first', 'conflict')
    if (project.hasAudio === false) throw new ProjectError('This video has no sound to transcribe', 'conflict')
    if (this.queue.activeForProject(projectId).some((j) => j.type === 'transcribe')) {
      throw new ProjectError('A transcription is already running for this project', 'conflict')
    }

    const now = this.now()
    this.db.transaction(() => {
      this.db
        .insert(transcripts)
        .values({ projectId, status: 'pending', requestedLanguage: language, words: [], createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: transcripts.projectId,
          set: { status: 'pending', error: null, requestedLanguage: language, updatedAt: now },
        })
        .run()
      this.queue.enqueue('transcribe', { projectId, language }, { projectId })
    })
    return toTranscriptSummary(this.get(projectId)!)
  }

  complete(projectId: string, result: { engine: string; model: string; language: string | null; words: Word[] }): void {
    this.db
      .update(transcripts)
      .set({
        status: 'ready',
        error: null,
        engine: result.engine,
        model: result.model,
        language: result.language,
        words: result.words,
        wordCount: result.words.length,
        edited: false,
        updatedAt: this.now(),
      })
      .where(eq(transcripts.projectId, projectId))
      .run()
  }

  /**
   * New timings for the same words (from lining them up with the audio). Text, fixes and the edited flag stay;
   * only start and end change.
   */
  retime(projectId: string, timed: Pick<Word, 'start' | 'end'>[]): void {
    const row = this.get(projectId)
    if (!row || row.status !== 'ready') throw new ProjectError('This project has no finished transcript', 'conflict')
    if (timed.length !== row.words.length) throw new ProjectError('The transcript changed meanwhile; line it up again', 'conflict')
    const words = row.words.map((w, i) => ({ ...w, start: timed[i]!.start, end: timed[i]!.end }))
    this.db.update(transcripts).set({ words, updatedAt: this.now() }).where(eq(transcripts.projectId, projectId)).run()
  }

  fail(projectId: string, error: string): void {
    this.db
      .update(transcripts)
      .set({ status: 'failed', error, updatedAt: this.now() })
      .where(eq(transcripts.projectId, projectId))
      .run()
  }

  /**
   * Fixes the text of individual words (timings stay). `expectedUpdatedAt` guards against
   * overwriting a transcript that changed since the editor loaded it.
   */
  edit(projectId: string, edits: WordEdit[], expectedUpdatedAt: number): TranscriptDto {
    const row = this.get(projectId)
    if (!row) throw new ProjectError('This project has no transcript yet', 'not_found')
    if (row.status !== 'ready' && row.status !== 'failed') {
      throw new ProjectError('Wait for the transcription to finish before editing', 'conflict')
    }
    if (row.updatedAt.getTime() !== expectedUpdatedAt) {
      throw new ProjectError('The transcript changed since you opened it. Reload to see the latest version.', 'conflict')
    }
    const words = row.words.slice()
    for (const { index, text } of edits) {
      const word = words[index]
      const trimmed = text.trim().replace(/\s+/g, ' ')
      if (!word) throw new ProjectError(`There is no word number ${index}`, 'invalid')
      if (!trimmed) throw new ProjectError('A word cannot be empty', 'invalid')
      // A fixed word is certain now.
      words[index] = { ...word, text: trimmed, p: 1 }
    }
    this.db
      .update(transcripts)
      .set({ words, edited: true, updatedAt: this.now() })
      .where(eq(transcripts.projectId, projectId))
      .run()
    return this.dto(projectId)
  }

  /** A transcription job stopped for good: keep any earlier words, but show what happened. */
  jobGaveUp(job: JobRow, outcome: 'failed' | 'cancelled'): void {
    if (job.type !== 'transcribe' || !job.projectId || !this.get(job.projectId)) return
    this.fail(job.projectId, outcome === 'cancelled' ? 'Cancelled' : (job.error ?? 'Transcription failed'))
  }

  jobRetried(job: JobRow): void {
    if (job.type !== 'transcribe' || !job.projectId || !this.get(job.projectId)) return
    this.db
      .update(transcripts)
      .set({ status: 'pending', error: null, updatedAt: this.now() })
      .where(eq(transcripts.projectId, job.projectId))
      .run()
  }
}
