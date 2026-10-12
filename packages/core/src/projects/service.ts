import { randomUUID } from 'node:crypto'
import { and, desc, eq, getTableColumns, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { Db } from '../db/client'
import { ProjectError } from '../errors'
import { assets, projects, transcripts, type AssetRow, type JobRow, type ProjectRow } from '../db/schema'
import type { JobQueue } from '../jobs/queue'
import type { AssetKind, DownloadQuality, ProjectDto, TimeRange, YoutubeMeta } from '../shared/projects'
import { UPLOAD_EXTENSIONS } from '../shared/projects'
import type { Storage } from '../storage'
import type { TranscriptSummary } from '../shared/transcripts'
import { toTranscriptSummary } from '../transcripts/service'

export function projectPrefix(projectId: string): string {
  return `projects/${projectId}`
}

export class ProjectService {
  constructor(
    private readonly db: Db,
    private readonly queue: JobQueue,
    private readonly storage: Storage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list({ deleted = false } = {}): ProjectDto[] {
    const rows = this.db
      .select()
      .from(projects)
      .where(deleted ? isNotNull(projects.deletedAt) : isNull(projects.deletedAt))
      .orderBy(desc(deleted ? projects.deletedAt : projects.createdAt))
      .all()
    return this.withAssets(rows)
  }

  get(id: string): ProjectRow | null {
    return this.db.select().from(projects).where(eq(projects.id, id)).get() ?? null
  }

  require(id: string): ProjectRow {
    const row = this.get(id)
    if (!row) throw new ProjectError('Project not found', 'not_found')
    return row
  }

  getDto(id: string): ProjectDto {
    return this.withAssets([this.require(id)])[0]!
  }

  /** Projects outside the Trash that were imported from this YouTube video. */
  findByYoutubeId(videoId: string): { id: string; name: string }[] {
    return this.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.sourceId, videoId), isNull(projects.deletedAt)))
      .all()
  }

  createFromYoutube(input: {
    url: string
    meta: YoutubeMeta
    quality: DownloadQuality
    range?: TimeRange
    name?: string
  }): ProjectRow {
    if (input.range && input.range.end <= input.range.start) {
      throw new ProjectError('The end time must be after the start time', 'invalid')
    }
    const now = this.now()
    return this.db.transaction((tx) => {
      const row = tx
        .insert(projects)
        .values({
          id: randomUUID(),
          name: (input.name?.trim() || input.meta.title).slice(0, 200),
          sourceType: 'youtube',
          sourceUrl: input.url,
          sourceId: input.meta.videoId,
          sourceMeta: input.meta,
          status: 'importing',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get()
      this.queue.enqueue(
        'ingest.download',
        { projectId: row.id, url: input.url, quality: input.quality, range: input.range },
        { projectId: row.id },
      )
      return row
    })
  }

  /** Creates a project waiting for its file. Returns the storage key the upload must be written to. */
  createForUpload(input: { name: string; filename: string }): { project: ProjectRow; sourceKey: string } {
    const ext = input.filename.split('.').pop()?.toLowerCase() ?? ''
    if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new ProjectError(`Unsupported file type ".${ext}". Use ${UPLOAD_EXTENSIONS.join(', ')}.`, 'invalid')
    }
    const now = this.now()
    const project = this.db
      .insert(projects)
      .values({
        id: randomUUID(),
        name: input.name.trim().slice(0, 200) || 'Untitled video',
        sourceType: 'upload',
        status: 'importing',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
    return { project, sourceKey: `${projectPrefix(project.id)}/source.${ext}` }
  }

  /** The upload's source key, if this project is still waiting for its file. */
  pendingUploadKey(id: string, filename: string): string {
    const project = this.require(id)
    if (project.sourceType !== 'upload' || project.status !== 'importing' || this.asset(id, 'source')) {
      throw new ProjectError('This project is not waiting for an upload', 'conflict')
    }
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new ProjectError(`Unsupported file type ".${ext}"`, 'invalid')
    }
    return `${projectPrefix(id)}/source.${ext}`
  }

  /** Records a finished download or upload and queues the preparation step. */
  sourceReady(id: string, storageKey: string, bytes: number, mimeType: string): void {
    this.db.transaction(() => {
      this.setAsset(id, 'source', storageKey, bytes, mimeType)
      this.update(id, { status: 'processing', error: null })
      this.queue.enqueue('media.prepare', { projectId: id }, { projectId: id })
    })
  }

  /** Queues face analysis (used to frame vertical clips automatically), unless it's already running. */
  requestFaces(id: string): void {
    const project = this.require(id)
    if (project.status !== 'ready') throw new ProjectError('The video has to finish importing first', 'conflict')
    if (this.queue.activeForProject(id).some((j) => j.type === 'media.faces')) return
    this.queue.enqueue('media.faces', { projectId: id }, { projectId: id })
  }

  markReady(id: string, media: { durationMs: number; width: number; height: number; fps: number; hasAudio: boolean }) {
    this.update(id, { ...media, status: 'ready', error: null })
  }

  markFailed(id: string, error: string): void {
    this.update(id, { status: 'failed', error })
  }

  /**
   * A project's import job stopped for good (out of retries, or cancelled): show it as failed so it can be retried.
   * Called by the worker, and by the API when a queued job is cancelled before it ever ran.
   */
  jobGaveUp(job: JobRow, outcome: 'failed' | 'cancelled'): void {
    if (!job.projectId || !this.get(job.projectId)) return
    if (job.type !== 'ingest.download' && job.type !== 'media.prepare') return
    this.markFailed(job.projectId, outcome === 'cancelled' ? 'Cancelled' : (job.error ?? 'Something went wrong'))
  }

  /** A failed import job was retried from the activity tray: show the project as in progress again. */
  jobRetried(job: JobRow): void {
    if (!job.projectId || !this.get(job.projectId)) return
    if (job.type === 'ingest.download') this.update(job.projectId, { status: 'importing', error: null })
    if (job.type === 'media.prepare') this.update(job.projectId, { status: 'processing', error: null })
  }

  rename(id: string, name: string): ProjectDto {
    const trimmed = name.trim()
    if (!trimmed) throw new ProjectError('A name is required', 'invalid')
    this.require(id)
    this.update(id, { name: trimmed.slice(0, 200) })
    return this.getDto(id)
  }

  /** Starts the failed step again: the download for YouTube projects without a file, otherwise preparation. */
  retry(id: string): ProjectDto {
    const project = this.require(id)
    if (project.status !== 'failed') throw new ProjectError('Only failed projects can be retried', 'conflict')
    if (this.queue.activeForProject(id).length) throw new ProjectError('This project is already being worked on', 'conflict')

    if (this.asset(id, 'source')) {
      this.db.transaction(() => {
        this.update(id, { status: 'processing', error: null })
        this.queue.enqueue('media.prepare', { projectId: id }, { projectId: id })
      })
    } else if (project.sourceType === 'youtube' && project.sourceUrl) {
      const lastDownload = this.lastDownloadPayload(id)
      this.db.transaction(() => {
        this.update(id, { status: 'importing', error: null })
        this.queue.enqueue(
          'ingest.download',
          { projectId: id, url: project.sourceUrl!, quality: lastDownload?.quality ?? '1080', range: lastDownload?.range },
          { projectId: id },
        )
      })
    } else {
      throw new ProjectError('The upload did not finish. Move this project to the Trash and upload the file again.', 'conflict')
    }
    return this.getDto(id)
  }

  /** Moves a project to the Trash and stops any work on it. */
  trash(id: string): ProjectDto {
    this.require(id)
    for (const job of this.queue.activeForProject(id)) this.queue.requestCancel(job.id)
    this.update(id, { deletedAt: this.now() })
    return this.getDto(id)
  }

  restore(id: string): ProjectDto {
    this.require(id)
    this.update(id, { deletedAt: null })
    return this.getDto(id)
  }

  /** Deletes a project in the Trash for good, files included. */
  async purge(id: string): Promise<void> {
    const project = this.require(id)
    if (!project.deletedAt) throw new ProjectError('Move the project to the Trash first', 'conflict')
    if (this.queue.activeForProject(id).length) {
      throw new ProjectError('Work on this project is still stopping. Try again in a moment.', 'conflict')
    }
    await this.storage.delete(projectPrefix(id))
    this.db.delete(projects).where(eq(projects.id, id)).run()
  }

  asset(projectId: string, kind: AssetKind): AssetRow | null {
    return (
      this.db
        .select()
        .from(assets)
        .where(and(eq(assets.projectId, projectId), eq(assets.kind, kind)))
        .get() ?? null
    )
  }

  setAsset(projectId: string, kind: AssetKind, storageKey: string, bytes: number, mimeType: string): void {
    const now = this.now()
    this.db
      .insert(assets)
      .values({ id: randomUUID(), projectId, kind, storageKey, bytes, mimeType, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [assets.projectId, assets.kind],
        set: { storageKey, bytes, mimeType, updatedAt: now },
      })
      .run()
  }

  private update(id: string, values: Partial<typeof projects.$inferInsert>): void {
    this.db
      .update(projects)
      .set({ ...values, updatedAt: this.now() })
      .where(eq(projects.id, id))
      .run()
  }

  private lastDownloadPayload(projectId: string) {
    const last = this.queue
      .listForProject(projectId)
      .find((job) => job.type === 'ingest.download')
    return last?.payload as { quality?: DownloadQuality; range?: TimeRange } | undefined
  }

  private withAssets(rows: ProjectRow[]): ProjectDto[] {
    if (rows.length === 0) return []
    const all = this.db
      .select()
      .from(assets)
      .where(inArray(assets.projectId, rows.map((r) => r.id)))
      .all()
    // Everything but the words, which can run to megabytes.
    const { words: _words, ...summaryColumns } = getTableColumns(transcripts)
    const summaries = this.db
      .select(summaryColumns)
      .from(transcripts)
      .where(inArray(transcripts.projectId, rows.map((r) => r.id)))
      .all()
    return rows.map((row) => {
      const summary = summaries.find((t) => t.projectId === row.id)
      return toProjectDto(row, all.filter((a) => a.projectId === row.id), summary ? toTranscriptSummary(summary) : null)
    })
  }
}

export function toProjectDto(row: ProjectRow, rowAssets: AssetRow[], transcript: TranscriptSummary | null = null): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    sourceType: row.sourceType,
    sourceUrl: row.sourceUrl,
    sourceMeta: row.sourceMeta ?? null,
    status: row.status,
    error: row.error,
    durationMs: row.durationMs,
    width: row.width,
    height: row.height,
    fps: row.fps,
    hasAudio: row.hasAudio,
    storageBytes: rowAssets.reduce((sum, a) => sum + a.bytes, 0),
    assets: Object.fromEntries(rowAssets.map((a) => [a.kind, { bytes: a.bytes, updatedAt: a.updatedAt.getTime() }])),
    transcript,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    deletedAt: row.deletedAt?.getTime() ?? null,
  }
}
