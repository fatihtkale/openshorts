import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { toRenderDto } from '../clips/service'
import type { Db } from '../db/client'
import { clips, projects, renders, type JobRow, type RenderRow } from '../db/schema'
import { ProjectError } from '../errors'
import type { JobQueue } from '../jobs/queue'
import type { RenderDto } from '../shared/clips'

/** Exports of clips as MP4 files. Each export is a `clip.render` job. */
export class RenderService {
  constructor(
    private readonly db: Db,
    private readonly queue: JobQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Queues an export of the clip as it is now. */
  request(clipId: string): RenderDto {
    const clip = this.db.select().from(clips).where(eq(clips.id, clipId)).get()
    if (!clip) throw new ProjectError('Clip not found', 'not_found')
    if (clip.status !== 'approved') throw new ProjectError('Approve the clip before exporting it', 'conflict')
    const project = this.db.select().from(projects).where(eq(projects.id, clip.projectId)).get()
    if (!project || project.status !== 'ready' || project.deletedAt) throw new ProjectError('The video is not ready', 'conflict')
    const busy = this.db
      .select()
      .from(renders)
      .where(and(eq(renders.clipId, clipId), eq(renders.clipVersion, clip.version)))
      .all()
      .find((r) => r.status === 'queued' || r.status === 'running')
    if (busy) return toRenderDto(busy)

    const id = randomUUID()
    this.db.transaction(() => {
      this.db
        .insert(renders)
        .values({ id, clipId, projectId: clip.projectId, status: 'queued', clipVersion: clip.version, createdAt: this.now() })
        .run()
      this.queue.enqueue('clip.render', { renderId: id }, { projectId: clip.projectId })
    })
    return this.dto(id)
  }

  get(id: string): RenderRow | null {
    return this.db.select().from(renders).where(eq(renders.id, id)).get() ?? null
  }

  dto(id: string): RenderDto {
    const row = this.get(id)
    if (!row) throw new ProjectError('Export not found', 'not_found')
    return toRenderDto(row)
  }

  listForClip(clipId: string): RenderDto[] {
    return this.db.select().from(renders).where(eq(renders.clipId, clipId)).orderBy(desc(renders.createdAt)).all().map(toRenderDto)
  }

  markRunning(id: string): void {
    this.db.update(renders).set({ status: 'running', error: null }).where(eq(renders.id, id)).run()
  }

  complete(id: string, result: { storageKey: string; bytes: number; durationMs: number }): void {
    this.db
      .update(renders)
      .set({ status: 'done', ...result, error: null, finishedAt: this.now() })
      .where(eq(renders.id, id))
      .run()
  }

  fail(id: string, error: string): void {
    this.db.update(renders).set({ status: 'failed', error, finishedAt: this.now() }).where(eq(renders.id, id)).run()
  }

  jobGaveUp(job: JobRow, outcome: 'failed' | 'cancelled'): void {
    if (job.type !== 'clip.render') return
    const id = (job.payload as { renderId?: string }).renderId
    if (id && this.get(id)) this.fail(id, outcome === 'cancelled' ? 'Cancelled' : (job.error ?? 'Export failed'))
  }

  jobRetried(job: JobRow): void {
    if (job.type !== 'clip.render') return
    const id = (job.payload as { renderId?: string }).renderId
    if (id && this.get(id)) this.db.update(renders).set({ status: 'queued', error: null, finishedAt: null }).where(eq(renders.id, id)).run()
  }
}
