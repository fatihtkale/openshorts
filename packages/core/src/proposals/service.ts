import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { ClipService, type ClipDraft } from '../clips/service'
import type { Db } from '../db/client'
import { clips, projects, proposals, type ProposalRow } from '../db/schema'
import { ProjectError } from '../errors'
import type { ProjectService } from '../projects/service'
import type { ClipDto, ImportProposalPayload, ProposalDto, ProposalStatus, ScheduleProposalPayload } from '../shared/clips'

export interface ProposeClipsResult {
  proposal: ProposalDto
  skipped: { title: string; reason: string }[]
}

/**
 * Proposals are how Claude (via MCP) suggests work. They change nothing on their own:
 * the user approves or rejects them in the Inbox, and only then does anything happen.
 */
export class ProposalService {
  constructor(
    private readonly db: Db,
    private readonly clipService: ClipService,
    private readonly projectService: ProjectService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  proposeClips(input: { projectId: string; clips: ClipDraft[]; note?: string | null; client?: string | null }): ProposeClipsResult {
    const project = this.projectService.require(input.projectId)
    if (project.deletedAt) throw new ProjectError('This project is in the Trash', 'conflict')
    if (!input.clips.length) throw new ProjectError('Propose at least one clip', 'invalid')

    const accepted: ClipDraft[] = []
    const skipped: ProposeClipsResult['skipped'] = []
    for (const draft of input.clips) {
      const prepared = this.clipService.prepare(input.projectId, draft, { trimLeadIn: true, by: input.client ?? null })
      if ('error' in prepared) {
        skipped.push({ title: draft.title, reason: prepared.error })
        continue
      }
      const duplicate =
        this.clipService.findDuplicate(input.projectId, prepared.clip) ??
        accepted.find((a) => Math.min(a.endMs, prepared.clip.endMs) - Math.max(a.startMs, prepared.clip.startMs) > 0.8 * Math.min(a.endMs - a.startMs, prepared.clip.endMs - prepared.clip.startMs))
      if (duplicate) {
        skipped.push({ title: draft.title, reason: `Overlaps “${duplicate.title}”, which already exists or is in this proposal` })
        continue
      }
      accepted.push(prepared.clip)
    }
    if (!accepted.length) {
      throw new ProjectError(`None of the clips could be used: ${skipped.map((s) => `${s.title}: ${s.reason}`).join('; ')}`, 'invalid')
    }

    const now = this.now()
    const id = randomUUID()
    this.db.transaction(() => {
      this.db
        .insert(proposals)
        .values({
          id,
          kind: 'clips',
          status: 'pending',
          title: `${accepted.length} ${accepted.length === 1 ? 'clip' : 'clips'} from “${project.name}”`,
          note: input.note?.trim() || null,
          client: input.client ?? null,
          projectId: input.projectId,
          createdAt: now,
          updatedAt: now,
        })
        .run()
      for (const clip of accepted) this.clipService.insert(input.projectId, clip, { origin: 'claude', status: 'proposed', proposalId: id })
    })
    return { proposal: this.get(id), skipped }
  }

  proposeImport(input: ImportProposalPayload & { note?: string | null; client?: string | null }): ProposalDto {
    const { note, client, ...payload } = input
    if (payload.range && payload.range.end <= payload.range.start) throw new ProjectError('The end must be after the start', 'invalid')
    const now = this.now()
    const id = randomUUID()
    this.db
      .insert(proposals)
      .values({
        id,
        kind: 'import',
        status: 'pending',
        title: `Import “${payload.meta.title}”`,
        note: note?.trim() || null,
        client: client ?? null,
        payload,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    return this.get(id)
  }

  /** Suggests a posting day for some exported clips. Approving opens the scheduler; nothing posts from here. */
  proposeSchedule(input: ScheduleProposalPayload & { note?: string | null; client?: string | null; title: string }): ProposalDto {
    if (!input.clipIds.length) throw new ProjectError('Choose at least one clip', 'invalid')
    const now = this.now()
    const id = randomUUID()
    this.db
      .insert(proposals)
      .values({
        id,
        kind: 'schedule',
        status: 'pending',
        title: input.title,
        note: input.note?.trim() || null,
        client: input.client ?? null,
        payload: { clipIds: input.clipIds, date: input.date, accountIds: input.accountIds },
        createdAt: now,
        updatedAt: now,
      })
      .run()
    return this.get(id)
  }

  /** The user confirmed the schedule this proposal led to. */
  completeSchedule(id: string): void {
    this.requirePending(id, 'schedule')
    this.finish(id, 'done')
  }

  get(id: string): ProposalDto {
    const row = this.db.select().from(proposals).where(eq(proposals.id, id)).get()
    if (!row) throw new ProjectError('Proposal not found', 'not_found')
    return this.toDto([row])[0]!
  }

  list(status?: ProposalStatus, limit = 50): ProposalDto[] {
    const rows = this.db
      .select()
      .from(proposals)
      .where(status ? eq(proposals.status, status) : undefined)
      .orderBy(desc(proposals.createdAt))
      .limit(limit)
      .all()
    return this.toDto(rows)
  }

  pendingCount(): number {
    return this.db.select({ n: count() }).from(proposals).where(eq(proposals.status, 'pending')).get()?.n ?? 0
  }

  /** Approves or rejects clips of a clips proposal. The proposal is done once none is left undecided. */
  decideClips(proposalId: string, decisions: { clipId: string; approve: boolean }[]): ProposalDto {
    const proposal = this.requirePending(proposalId, 'clips')
    const own = new Set(this.clipService.forProposal(proposal.id).map((c) => c.id))
    for (const d of decisions) if (!own.has(d.clipId)) throw new ProjectError('That clip is not part of this proposal', 'invalid')
    this.db.transaction(() => {
      this.clipService.setStatus(decisions.filter((d) => d.approve).map((d) => d.clipId), 'approved')
      this.clipService.setStatus(decisions.filter((d) => !d.approve).map((d) => d.clipId), 'rejected')
      const open = this.db
        .select({ n: count() })
        .from(clips)
        .where(and(eq(clips.proposalId, proposalId), eq(clips.status, 'proposed')))
        .get()?.n
      if (!open) this.finish(proposalId, 'done')
      else this.touch(proposalId)
    })
    return this.get(proposalId)
  }

  /** Starts the download an import proposal describes; `resultProjectId` names the new project. */
  approveImport(proposalId: string): ProposalDto {
    const row = this.requirePending(proposalId, 'import')
    const payload = row.payload as ImportProposalPayload
    // createFromYoutube runs its own transaction, and SQLite transactions don't nest here.
    const project = this.projectService.createFromYoutube(payload)
    this.db.update(proposals).set({ resultProjectId: project.id }).where(eq(proposals.id, proposalId)).run()
    this.finish(proposalId, 'done')
    return this.get(proposalId)
  }

  /** Turns the whole proposal down; any undecided clips are rejected. */
  dismiss(proposalId: string): ProposalDto {
    const row = this.requirePending(proposalId)
    this.db.transaction(() => {
      if (row.kind === 'clips') {
        const open = this.clipService.forProposal(proposalId).filter((c) => c.status === 'proposed')
        this.clipService.setStatus(open.map((c) => c.id), 'rejected')
      }
      this.finish(proposalId, 'dismissed')
    })
    return this.get(proposalId)
  }

  private requirePending(id: string, kind?: ProposalRow['kind']): ProposalRow {
    const row = this.db.select().from(proposals).where(eq(proposals.id, id)).get()
    if (!row) throw new ProjectError('Proposal not found', 'not_found')
    if (kind && row.kind !== kind) throw new ProjectError(`This is not a ${kind} proposal`, 'invalid')
    if (row.status !== 'pending') throw new ProjectError('This proposal was already decided', 'conflict')
    return row
  }

  private finish(id: string, status: ProposalStatus): void {
    const now = this.now()
    this.db.update(proposals).set({ status, decidedAt: now, updatedAt: now }).where(eq(proposals.id, id)).run()
  }

  private touch(id: string): void {
    this.db.update(proposals).set({ updatedAt: this.now() }).where(eq(proposals.id, id)).run()
  }

  private toDto(rows: ProposalRow[]): ProposalDto[] {
    if (!rows.length) return []
    const projectIds = [...new Set(rows.map((r) => r.projectId).filter((id): id is string => !!id))]
    const names = projectIds.length
      ? new Map(
          this.db
            .select({ id: projects.id, name: projects.name })
            .from(projects)
            .where(inArray(projects.id, projectIds))
            .all()
            .map((p) => [p.id, p.name]),
        )
      : new Map<string, string>()
    const clipsByProposal = new Map<string, ClipDto[]>()
    for (const row of rows) if (row.kind === 'clips') clipsByProposal.set(row.id, this.clipService.forProposal(row.id))
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      title: row.title,
      note: row.note,
      client: row.client,
      projectId: row.projectId,
      projectName: row.projectId ? (names.get(row.projectId) ?? null) : null,
      clips: clipsByProposal.get(row.id) ?? [],
      import: row.kind === 'import' ? (row.payload as ImportProposalPayload) : null,
      schedule: row.kind === 'schedule' ? (row.payload as ScheduleProposalPayload) : null,
      resultProjectId: row.resultProjectId,
      createdAt: row.createdAt.getTime(),
      decidedAt: row.decidedAt?.getTime() ?? null,
    }))
  }
}
