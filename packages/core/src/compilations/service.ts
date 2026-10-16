import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { toClipDto, toRenderDto } from '../clips/service'
import type { Db } from '../db/client'
import { assets, clips, compilations, projects, renders, type CompilationRow, type JobRow } from '../db/schema'
import { ProjectError } from '../errors'
import type { JobQueue } from '../jobs/queue'
import {
  clipScore,
  COMPILATION_MAX_ITEMS,
  CREDIT_PLATFORMS,
  defaultCredit,
  type CompilationChapter,
  type CompilationClipInfo,
  type CompilationDetail,
  type CompilationDto,
  type CompilationItem,
  type Credit,
} from '../shared/compilations'

/** Output size of a compilation (landscape, like most long-form videos). */
export const COMPILATION_W = 1920
export const COMPILATION_H = 1080

function cleanCredit(c: Partial<Credit> | undefined): Credit {
  const platform = CREDIT_PLATFORMS.includes(c?.platform as Credit['platform']) ? (c!.platform as Credit['platform']) : 'other'
  return {
    platform,
    name: (c?.name ?? '').trim().slice(0, 60),
    handle: (c?.handle ?? '').trim().replace(/^@/, '').replace(/\s+/g, '').slice(0, 60),
  }
}

/**
 * Compilations: a long landscape video stitched from approved clips of any projects, each opening with a banner that
 * credits the streamer. Exporting is a `compilation.render` job; the finished file becomes a project of its own
 * (sourceType 'compilation') with one "Full video" clip and its export, so posting, scheduling and Insights work as
 * for any clip.
 */
export class CompilationService {
  constructor(
    private readonly db: Db,
    private readonly queue: JobQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(id: string): CompilationRow | null {
    return this.db.select().from(compilations).where(eq(compilations.id, id)).get() ?? null
  }

  require(id: string): CompilationRow {
    const row = this.get(id)
    if (!row) throw new ProjectError('Compilation not found', 'not_found')
    return row
  }

  list(): CompilationDto[] {
    return this.db.select().from(compilations).orderBy(desc(compilations.updatedAt)).all().map((r) => this.toDto(r))
  }

  dto(id: string): CompilationDto {
    return this.toDto(this.require(id))
  }

  /** The compilation with what each of its clips is (title, project, length), for the editor page. */
  detail(id: string): CompilationDetail {
    const dto = this.dto(id)
    const ids = dto.items.map((i) => i.clipId)
    const rows = ids.length
      ? this.db
          .select({ clip: clips, projectName: projects.name, deletedAt: projects.deletedAt })
          .from(clips)
          .innerJoin(projects, eq(projects.id, clips.projectId))
          .where(inArray(clips.id, ids))
          .all()
      : []
    const found = new Map(rows.map((r) => [r.clip.id, r]))
    const info: Record<string, CompilationClipInfo> = {}
    for (const clipId of ids) {
      const r = found.get(clipId)
      info[clipId] = r
        ? {
            clipId,
            title: r.clip.title,
            projectId: r.clip.projectId,
            projectName: r.projectName,
            startMs: r.clip.startMs,
            endMs: r.clip.endMs,
            score: clipScore(r.clip),
            missing: r.clip.status !== 'approved' || !!r.deletedAt,
          }
        : { clipId, title: 'Removed clip', projectId: '', projectName: '', startMs: 0, endMs: 0, score: null, missing: true }
    }
    return { ...dto, clips: info }
  }

  create(input: { title: string; clipIds?: string[] }): CompilationDto {
    const title = input.title.trim().slice(0, 100)
    if (!title) throw new ProjectError('Give the compilation a title', 'invalid')
    const items = this.itemsFor(input.clipIds ?? [])
    const now = this.now()
    const id = randomUUID()
    this.db.insert(compilations).values({ id, title, items, status: 'draft', version: 1, createdAt: now, updatedAt: now }).run()
    return this.dto(id)
  }

  /** New items for clips, credited from their project's source (the Twitch channel, the YouTube channel). */
  itemsFor(clipIds: string[]): CompilationItem[] {
    const unique = [...new Set(clipIds)]
    if (unique.length > COMPILATION_MAX_ITEMS) throw new ProjectError(`At most ${COMPILATION_MAX_ITEMS} clips per compilation`, 'invalid')
    if (!unique.length) return []
    const rows = this.db
      .select({ clip: clips, project: projects })
      .from(clips)
      .innerJoin(projects, eq(projects.id, clips.projectId))
      .where(inArray(clips.id, unique))
      .all()
    const byId = new Map(rows.map((r) => [r.clip.id, r]))
    return unique.map((clipId) => {
      const r = byId.get(clipId)
      if (!r || r.clip.status !== 'approved') throw new ProjectError('Only approved clips can go in a compilation', 'invalid')
      if (r.clip.origin === 'compilation') throw new ProjectError("A compilation can't contain another compilation", 'invalid')
      return { clipId, credit: defaultCredit(r.project.sourceType, r.project.sourceMeta) }
    })
  }

  /** Saves a new title and/or clip list (order and credits). The version guards against another tab saving first. */
  update(id: string, patch: { title?: string; items?: CompilationItem[] }, expectedVersion: number): CompilationDto {
    const row = this.require(id)
    if (row.version !== expectedVersion) throw new ProjectError('This compilation was changed somewhere else. Reload to see the latest version.', 'conflict')
    const title = patch.title === undefined ? row.title : patch.title.trim().slice(0, 100)
    if (!title) throw new ProjectError('Give the compilation a title', 'invalid')
    let items = row.items
    if (patch.items) {
      if (patch.items.length > COMPILATION_MAX_ITEMS) throw new ProjectError(`At most ${COMPILATION_MAX_ITEMS} clips per compilation`, 'invalid')
      const known = new Set(row.items.map((i) => i.clipId))
      const added = patch.items.filter((i) => !known.has(i.clipId)).map((i) => i.clipId)
      // New clips must be real, approved clips; existing ones may have gone missing since and are kept as they are.
      if (added.length) this.itemsFor(added)
      const seen = new Set<string>()
      items = patch.items.filter((i) => !seen.has(i.clipId) && seen.add(i.clipId)).map((i) => ({ clipId: i.clipId, credit: cleanCredit(i.credit) }))
    }
    this.db
      .update(compilations)
      .set({ title, items, version: row.version + 1, updatedAt: this.now() })
      .where(eq(compilations.id, id))
      .run()
    return this.dto(id)
  }

  /** Deletes the compilation. Its finished video (a project) stays; delete that from Projects if wanted. */
  remove(id: string): void {
    const row = this.require(id)
    if (row.status === 'queued' || row.status === 'running') throw new ProjectError('Wait for the export to finish (or cancel it) first', 'conflict')
    this.db.delete(compilations).where(eq(compilations.id, id)).run()
  }

  /** Queues an export of the compilation as it is now. */
  requestRender(id: string): CompilationDto {
    const row = this.require(id)
    if (row.status === 'queued' || row.status === 'running') return this.toDto(row)
    if (!row.items.length) throw new ProjectError('Add some clips first', 'invalid')
    const detail = this.detail(id)
    const missing = row.items.filter((i) => detail.clips[i.clipId]?.missing)
    if (missing.length) throw new ProjectError(`${missing.length} clip${missing.length === 1 ? ' is' : 's are'} no longer available; remove ${missing.length === 1 ? 'it' : 'them'} first`, 'conflict')
    const notReady = this.db
      .select({ name: projects.name, status: projects.status })
      .from(projects)
      .where(inArray(projects.id, [...new Set(Object.values(detail.clips).map((c) => c.projectId))]))
      .all()
      .find((p) => p.status !== 'ready')
    if (notReady) throw new ProjectError(`"${notReady.name}" isn't ready yet`, 'conflict')
    this.db.transaction(() => {
      this.db.update(compilations).set({ status: 'queued', error: null, updatedAt: this.now() }).where(eq(compilations.id, id)).run()
      this.queue.enqueue('compilation.render', { compilationId: id, version: row.version })
    })
    return this.dto(id)
  }

  markRunning(id: string): void {
    this.db.update(compilations).set({ status: 'running', error: null }).where(eq(compilations.id, id)).run()
  }

  /**
   * Stores a finished export: the project holding it (made the first time, renamed after), its "Full video" clip
   * (made once, then stretched to the new length with its version raised), the export itself, and the chapters.
   * The project is then prepared like an import (preview, cover, transcript), so Shorts can be cut from it too.
   */
  complete(
    id: string,
    result: { projectId: string; renderId: string; storageKey: string; bytes: number; durationMs: number; chapters: CompilationChapter[]; version: number; hasAudio: boolean },
  ): CompilationDto {
    const row = this.require(id)
    const now = this.now()
    this.db.transaction((tx) => {
      const project = tx.select().from(projects).where(eq(projects.id, result.projectId)).get()
      const media = { durationMs: result.durationMs, width: COMPILATION_W, height: COMPILATION_H, fps: 30, hasAudio: result.hasAudio }
      if (!project) {
        tx.insert(projects)
          .values({ id: result.projectId, name: row.title, sourceType: 'compilation', status: 'processing', ...media, createdAt: now, updatedAt: now })
          .run()
      } else {
        tx.update(projects).set({ name: row.title, status: 'processing', error: null, deletedAt: null, ...media, updatedAt: now }).where(eq(projects.id, project.id)).run()
      }
      tx.insert(assets)
        .values({ id: randomUUID(), projectId: result.projectId, kind: 'source', storageKey: result.storageKey, bytes: result.bytes, mimeType: 'video/mp4', createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: [assets.projectId, assets.kind], set: { storageKey: result.storageKey, bytes: result.bytes, mimeType: 'video/mp4', updatedAt: now } })
        .run()

      let full = tx.select().from(clips).where(and(eq(clips.projectId, result.projectId), eq(clips.origin, 'compilation'))).get()
      if (!full) {
        full = tx
          .insert(clips)
          .values({
            id: randomUUID(),
            projectId: result.projectId,
            startMs: 0,
            endMs: result.durationMs,
            title: row.title,
            keywords: [],
            origin: 'compilation',
            status: 'approved',
            version: 1,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get()
      } else {
        full = tx
          .update(clips)
          .set({ endMs: result.durationMs, title: row.title, version: full.version + 1, status: 'approved', updatedAt: now })
          .where(eq(clips.id, full.id))
          .returning()
          .get()
      }
      tx.insert(renders)
        .values({
          id: result.renderId,
          clipId: full.id,
          projectId: result.projectId,
          status: 'done',
          clipVersion: full.version,
          storageKey: result.storageKey,
          bytes: result.bytes,
          durationMs: result.durationMs,
          createdAt: now,
          finishedAt: now,
        })
        .run()
      tx.update(compilations)
        .set({
          status: 'done',
          error: null,
          renderedVersion: result.version,
          durationMs: result.durationMs,
          chapters: result.chapters,
          projectId: result.projectId,
          updatedAt: now,
        })
        .where(eq(compilations.id, id))
        .run()
      this.queue.enqueue('media.prepare', { projectId: result.projectId }, { projectId: result.projectId })
    })
    return this.dto(id)
  }

  fail(id: string, error: string): void {
    if (!this.get(id)) return
    this.db.update(compilations).set({ status: 'failed', error, updatedAt: this.now() }).where(eq(compilations.id, id)).run()
  }

  jobGaveUp(job: JobRow, outcome: 'failed' | 'cancelled'): void {
    if (job.type !== 'compilation.render') return
    const id = (job.payload as { compilationId?: string }).compilationId
    if (id) this.fail(id, outcome === 'cancelled' ? 'Cancelled' : (job.error ?? 'Export failed'))
  }

  jobRetried(job: JobRow): void {
    if (job.type !== 'compilation.render') return
    const id = (job.payload as { compilationId?: string }).compilationId
    if (id && this.get(id)) this.db.update(compilations).set({ status: 'queued', error: null }).where(eq(compilations.id, id)).run()
  }

  private toDto(row: CompilationRow): CompilationDto {
    const full = row.projectId ? this.db.select().from(clips).where(and(eq(clips.projectId, row.projectId), eq(clips.origin, 'compilation'))).get() : null
    const render = full ? (this.db.select().from(renders).where(eq(renders.clipId, full.id)).orderBy(desc(renders.createdAt)).get() ?? null) : null
    return {
      id: row.id,
      title: row.title,
      items: row.items,
      status: row.status,
      error: row.error,
      version: row.version,
      renderedVersion: row.renderedVersion,
      durationMs: row.durationMs,
      chapters: row.chapters ?? [],
      projectId: row.projectId,
      clip: full ? toClipDto(full, render) : null,
      render: render ? toRenderDto(render) : null,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    }
  }
}
