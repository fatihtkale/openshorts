import { randomUUID } from 'node:crypto'
import { defaultEdit, type ClipEdit } from '@clipstudio/captions'
import { and, asc, count, desc, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { Db } from '../db/client'
import { clips, posts, projects, renders, transcripts, type ClipRow, type RenderRow } from '../db/schema'
import { ProjectError } from '../errors'
import {
  CLIP_MAX_MS,
  CLIP_MIN_MS,
  overlapRatio,
  snapToWords,
  clipEditSchema,
  type ClipDto,
  type ClipStatus,
  type RenderDto,
} from '../shared/clips'
import { evaluationInputSchema, evaluationTotal, trimLeadIn, type ClipEvaluation, type EvaluationInput } from '../shared/evaluation'
import type { Word } from '../shared/transcripts'

export function toRenderDto(row: RenderRow): RenderDto {
  return {
    id: row.id,
    clipId: row.clipId,
    projectId: row.projectId,
    status: row.status,
    clipVersion: row.clipVersion,
    durationMs: row.durationMs,
    bytes: row.bytes,
    error: row.error,
    createdAt: row.createdAt.getTime(),
    finishedAt: row.finishedAt?.getTime() ?? null,
  }
}

/** The clip's edit, or the defaults for a clip that was never edited. */
export function resolveEdit(row: Pick<ClipRow, 'edit' | 'hook'>): ClipEdit {
  return row.edit ?? defaultEdit({ hook: row.hook })
}

export function toClipDto(row: ClipRow, render: RenderRow | null = null): ClipDto {
  return {
    id: row.id,
    projectId: row.projectId,
    proposalId: row.proposalId,
    startMs: row.startMs,
    endMs: row.endMs,
    title: row.title,
    hook: row.hook,
    reason: row.reason,
    score: row.score,
    keywords: row.keywords,
    evaluation: row.evaluation ?? null,
    origin: row.origin,
    status: row.status,
    edit: resolveEdit(row),
    version: row.version,
    render: render ? toRenderDto(render) : null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

export interface ClipDraft {
  startMs: number
  endMs: number
  title: string
  hook?: string | null
  reason?: string | null
  score?: number | null
  keywords?: string[]
  /** Word → emoji, for the emoji caption preset. */
  emojis?: Record<string, string>
  /** A 4-pillar judgement from the model that proposed it (times in seconds). */
  evaluation?: EvaluationInput | null
  /** Set by `prepare`: the evaluation, checked and with suggested edges snapped. */
  checked?: ClipEvaluation | null
}

/**
 * Checks a model's evaluation and turns it into what is stored: the total is computed here, suggested edges are
 * snapped to words and dropped when they barely differ from the current ones.
 */
export function checkEvaluation(
  input: EvaluationInput,
  range: { startMs: number; endMs: number },
  ctx: { words: Word[]; durationMs: number; by: string | null; at: number },
): ClipEvaluation | null {
  const parsed = evaluationInputSchema.safeParse(input)
  if (!parsed.success) return null
  const e = parsed.data
  let suggestedStartMs: number | null = null
  let suggestedEndMs: number | null = null
  if (e.suggestedStartSec !== null || e.suggestedEndSec !== null) {
    const rawStart = e.suggestedStartSec === null ? range.startMs : e.suggestedStartSec * 1000
    const rawEnd = e.suggestedEndSec === null ? range.endMs : e.suggestedEndSec * 1000
    if (rawEnd > rawStart && rawStart < ctx.durationMs) {
      const snapped = snapToWords(ctx.words, rawStart, Math.min(rawEnd, ctx.durationMs), ctx.durationMs)
      // An edge the model left alone stays exactly where it is.
      if (e.suggestedStartSec === null) snapped.startMs = range.startMs
      if (e.suggestedEndSec === null) snapped.endMs = range.endMs
      const length = snapped.endMs - snapped.startMs
      const moved = Math.abs(snapped.startMs - range.startMs) > 300 || Math.abs(snapped.endMs - range.endMs) > 300
      if (moved && length >= CLIP_MIN_MS && length <= CLIP_MAX_MS) {
        suggestedStartMs = snapped.startMs
        suggestedEndMs = snapped.endMs
      }
    }
  }
  return {
    hook: e.hook,
    pacing: e.pacing,
    payoff: e.payoff,
    standalone: e.standalone,
    total: evaluationTotal(e),
    hookNotes: e.hookNotes,
    retentionRisk: e.retentionRisk,
    payoffNotes: e.payoffNotes,
    muteTest: e.muteTest,
    muteNotes: e.muteNotes,
    suggestedStartMs,
    suggestedEndMs,
    trimNotes: suggestedStartMs === null ? '' : e.trimNotes,
    evaluatedStartMs: range.startMs,
    evaluatedEndMs: range.endMs,
    by: ctx.by,
    at: ctx.at,
  }
}

export class ClipService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(projectId: string, statuses?: ClipStatus[]): ClipDto[] {
    const rows = this.db
      .select()
      .from(clips)
      .where(and(eq(clips.projectId, projectId), statuses ? inArray(clips.status, statuses) : undefined))
      .orderBy(asc(clips.startMs))
      .all()
    const latest = this.latestRenders(rows.map((r) => r.id))
    return rows.map((r) => toClipDto(r, latest.get(r.id) ?? null))
  }

  /** Approved clips with a finished export, across all projects (what the scheduler can post). */
  exported(): { clip: ClipDto; projectName: string; posts: number }[] {
    const rows = this.db
      .select({ clip: clips, projectName: projects.name })
      .from(clips)
      .innerJoin(projects, eq(projects.id, clips.projectId))
      .where(and(eq(clips.status, 'approved'), isNull(projects.deletedAt)))
      .orderBy(desc(clips.updatedAt))
      .all()
    const latest = this.latestRenders(rows.map((r) => r.clip.id))
    const postCounts = new Map(
      this.db
        .select({ clipId: posts.clipId, n: count() })
        .from(posts)
        .where(ne(posts.status, 'cancelled'))
        .groupBy(posts.clipId)
        .all()
        .map((r) => [r.clipId, r.n]),
    )
    return rows
      .map((r) => ({ clip: toClipDto(r.clip, latest.get(r.clip.id) ?? null), projectName: r.projectName, posts: postCounts.get(r.clip.id) ?? 0 }))
      .filter((r) => r.clip.render?.status === 'done')
  }

  /** The newest render of each clip. */
  private latestRenders(clipIds: string[]): Map<string, RenderRow> {
    const out = new Map<string, RenderRow>()
    if (!clipIds.length) return out
    const rows = this.db.select().from(renders).where(inArray(renders.clipId, clipIds)).orderBy(desc(renders.createdAt)).all()
    for (const r of rows) if (!out.has(r.clipId)) out.set(r.clipId, r)
    return out
  }

  forProposal(proposalId: string): ClipDto[] {
    return this.db.select().from(clips).where(eq(clips.proposalId, proposalId)).orderBy(asc(clips.startMs)).all().map((r) => toClipDto(r))
  }

  /**
   * Checks a draft against the project and snaps it to word boundaries.
   * Returns the cleaned clip, or a reason it can't be used.
   */
  /**
   * Validates a clip and snaps it to words. `trimLeadIn` (for model proposals) also drops an opening greeting
   * or filler, so clips start on the point. `by` names who wrote an included evaluation.
   */
  prepare(projectId: string, draft: ClipDraft, opts: { trimLeadIn?: boolean; by?: string | null } = {}): { clip: ClipDraft } | { error: string } {
    const project = this.db.select().from(projects).where(eq(projects.id, projectId)).get()
    if (!project) return { error: 'Project not found' }
    if (project.status !== 'ready' || !project.durationMs) return { error: 'The video has not finished importing' }
    const title = draft.title.trim()
    if (!title) return { error: 'A title is required' }
    if (!(draft.endMs > draft.startMs)) return { error: 'The end must be after the start' }
    if (draft.startMs < 0 || draft.startMs >= project.durationMs) return { error: 'The start is outside the video' }

    const transcript = this.db.select({ words: transcripts.words }).from(transcripts).where(eq(transcripts.projectId, projectId)).get()
    const words = transcript?.words ?? []
    const snapped = snapToWords(words, draft.startMs, Math.min(draft.endMs, project.durationMs), project.durationMs)
    if (opts.trimLeadIn) snapped.startMs = trimLeadIn(words, snapped.startMs, snapped.endMs)
    const length = snapped.endMs - snapped.startMs
    if (length < CLIP_MIN_MS) return { error: `Too short (${(length / 1000).toFixed(1)} s; at least ${CLIP_MIN_MS / 1000} s)` }
    if (length > CLIP_MAX_MS) return { error: `Too long (${Math.round(length / 1000)} s; at most ${CLIP_MAX_MS / 1000} s)` }

    const checked = draft.evaluation
      ? checkEvaluation(draft.evaluation, snapped, { words, durationMs: project.durationMs, by: opts.by ?? null, at: this.now().getTime() })
      : null
    const score = checked ? Math.round(checked.total * 10) : draft.score
    return {
      clip: {
        ...snapped,
        checked,
        title: title.slice(0, 120),
        hook: draft.hook?.trim().slice(0, 160) || null,
        reason: draft.reason?.trim().slice(0, 600) || null,
        score: score === null || score === undefined ? null : Math.max(0, Math.min(100, Math.round(score))),
        keywords: (draft.keywords ?? []).map((k) => k.trim()).filter(Boolean).slice(0, 12),
        emojis: Object.fromEntries(
          Object.entries(draft.emojis ?? {})
            .map(([word, emoji]) => [word.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ''), emoji.trim()] as const)
            .filter(([word, emoji]) => word && emoji && emoji.length <= 16)
            .slice(0, 20),
        ),
      },
    }
  }

  /** A clip that mostly overlaps one already proposed or approved, if any. */
  findDuplicate(projectId: string, range: { startMs: number; endMs: number }): ClipDto | null {
    const existing = this.db
      .select()
      .from(clips)
      .where(and(eq(clips.projectId, projectId), ne(clips.status, 'rejected')))
      .all()
    const match = existing.find((c) => overlapRatio(c, range) > 0.8)
    return match ? toClipDto(match) : null
  }

  insert(projectId: string, clip: ClipDraft, extra: { origin: ClipDto['origin']; status: ClipStatus; proposalId?: string }): ClipDto {
    const now = this.now()
    const row = this.db
      .insert(clips)
      .values({
        id: randomUUID(),
        projectId,
        proposalId: extra.proposalId ?? null,
        startMs: clip.startMs,
        endMs: clip.endMs,
        title: clip.title,
        hook: clip.hook ?? null,
        reason: clip.reason ?? null,
        score: clip.score ?? null,
        keywords: clip.keywords ?? [],
        evaluation: clip.checked ?? null,
        edit: defaultEdit({ hook: clip.hook, emojis: clip.emojis }),
        origin: extra.origin,
        status: extra.status,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
    return toClipDto(row)
  }

  /** A clip the user made by hand (from a transcript selection). It's approved right away. */
  createManual(projectId: string, draft: ClipDraft): ClipDto {
    const prepared = this.prepare(projectId, draft)
    if ('error' in prepared) throw new ProjectError(prepared.error, 'invalid')
    return this.insert(projectId, prepared.clip, { origin: 'manual', status: 'approved' })
  }

  setStatus(ids: string[], status: ClipStatus): void {
    if (!ids.length) return
    this.db.update(clips).set({ status, updatedAt: this.now() }).where(inArray(clips.id, ids)).run()
  }

  require(id: string): ClipDto {
    const row = this.db.select().from(clips).where(eq(clips.id, id)).get()
    if (!row) throw new ProjectError('Clip not found', 'not_found')
    return toClipDto(row, this.latestRenders([id]).get(id) ?? null)
  }

  /**
   * Saves editor changes. `expectedVersion` must match the stored version (another tab may have saved first);
   * the version then goes up by one.
   */
  update(id: string, patch: { title?: string; startMs?: number; endMs?: number; edit?: unknown }, expectedVersion: number): ClipDto {
    const row = this.db.select().from(clips).where(eq(clips.id, id)).get()
    if (!row) throw new ProjectError('Clip not found', 'not_found')
    if (row.version !== expectedVersion) {
      throw new ProjectError('This clip was changed somewhere else. Reload to see the latest version.', 'conflict')
    }
    const project = this.db.select().from(projects).where(eq(projects.id, row.projectId)).get()
    const duration = project?.durationMs ?? 0
    const startMs = Math.round(patch.startMs ?? row.startMs)
    const endMs = Math.round(patch.endMs ?? row.endMs)
    if (startMs < 0 || endMs > duration + 1 || endMs - startMs < CLIP_MIN_MS) {
      throw new ProjectError(`A clip must be inside the video and at least ${CLIP_MIN_MS / 1000} s long`, 'invalid')
    }
    if (endMs - startMs > CLIP_MAX_MS) throw new ProjectError(`A clip can be at most ${CLIP_MAX_MS / 1000} s long`, 'invalid')
    let edit = row.edit
    if (patch.edit !== undefined) {
      const parsed = clipEditSchema.safeParse(patch.edit)
      if (!parsed.success) throw new ProjectError(`Invalid edit: ${parsed.error.issues[0]?.message ?? 'unknown problem'}`, 'invalid')
      edit = parsed.data
    }
    const title = patch.title === undefined ? row.title : patch.title.trim().slice(0, 120)
    if (!title) throw new ProjectError('A title is required', 'invalid')
    this.db
      .update(clips)
      .set({ title, startMs, endMs, edit, version: row.version + 1, updatedAt: this.now() })
      .where(eq(clips.id, id))
      .run()
    return this.require(id)
  }

  /**
   * Stores an evaluation of the clip as it is now. It's a note: the clip itself, its version and its export
   * are untouched; the user applies a suggested trim in the editor.
   */
  setEvaluation(id: string, input: EvaluationInput, by: string | null): ClipDto {
    const row = this.db.select().from(clips).where(eq(clips.id, id)).get()
    if (!row) throw new ProjectError('Clip not found', 'not_found')
    const project = this.db.select().from(projects).where(eq(projects.id, row.projectId)).get()
    const transcript = this.db.select({ words: transcripts.words }).from(transcripts).where(eq(transcripts.projectId, row.projectId)).get()
    const evaluation = checkEvaluation(input, row, { words: transcript?.words ?? [], durationMs: project?.durationMs ?? row.endMs, by, at: this.now().getTime() })
    if (!evaluation) throw new ProjectError('The evaluation is incomplete', 'invalid')
    this.db
      .update(clips)
      .set({ evaluation, score: Math.round(evaluation.total * 10), updatedAt: this.now() })
      .where(eq(clips.id, id))
      .run()
    return this.require(id)
  }

  /** Moves the clip's edges to its evaluation's suggested trim (the user clicked "Apply trim"). */
  applySuggestedTrim(id: string, expectedVersion: number): ClipDto {
    const clip = this.require(id)
    const e = clip.evaluation
    if (!e || e.suggestedStartMs === null || e.suggestedEndMs === null) throw new ProjectError('This clip has no suggested trim', 'conflict')
    return this.update(id, { startMs: e.suggestedStartMs, endMs: e.suggestedEndMs }, expectedVersion)
  }

  rename(id: string, title: string): ClipDto {
    const trimmed = title.trim()
    if (!trimmed) throw new ProjectError('A title is required', 'invalid')
    this.require(id)
    this.db
      .update(clips)
      .set({ title: trimmed.slice(0, 120), updatedAt: this.now() })
      .where(eq(clips.id, id))
      .run()
    return this.require(id)
  }
}
