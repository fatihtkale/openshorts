import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, inArray, lt, lte, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { jobs, type JobRow } from '../db/schema'
import { jobDefinitions, jobLabel, type JobDto, type JobPayloadInput, type JobType } from '../shared/jobs'

/** Next value of the jobs change counter. SQLite serialises writers, so this is monotonic. */
const nextRev = sql`(SELECT COALESCE(MAX(rev), 0) + 1 FROM jobs)`

const BACKOFF_BASE_MS = 5_000
const BACKOFF_MAX_MS = 5 * 60_000

export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_MAX_MS)
}

export interface EnqueueOptions {
  runAt?: Date
  projectId?: string
  createdBy?: string
}

export class JobQueue {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  enqueue<T extends JobType>(type: T, payload: JobPayloadInput<T>, opts: EnqueueOptions = {}): JobRow {
    const def = jobDefinitions[type]
    const now = this.now()
    return this.db
      .insert(jobs)
      .values({
        id: randomUUID(),
        type,
        group: def.group,
        payload: def.payload.parse(payload),
        status: 'queued',
        maxAttempts: def.maxAttempts,
        runAt: opts.runAt ?? now,
        projectId: opts.projectId ?? null,
        createdBy: opts.createdBy ?? null,
        rev: nextRev,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
  }

  /** Atomically takes the next due job in one of `groups`, or returns null. */
  claim(workerId: string, groups: string[]): JobRow | null {
    if (groups.length === 0) return null
    const now = this.now()
    return this.db.transaction(
      (tx) => {
        const next = tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.status, 'queued'), lte(jobs.runAt, now), inArray(jobs.group, groups)))
          .orderBy(asc(jobs.runAt), asc(jobs.createdAt))
          .limit(1)
          .get()
        if (!next) return null
        return (
          tx
            .update(jobs)
            .set({
              status: 'running',
              lockedBy: workerId,
              attempts: sql`${jobs.attempts} + 1`,
              progress: 0,
              message: null,
              startedAt: now,
              heartbeatAt: now,
              updatedAt: now,
              rev: nextRev,
            })
            .where(and(eq(jobs.id, next.id), eq(jobs.status, 'queued')))
            .returning()
            .get() ?? null
        )
      },
      { behavior: 'immediate' },
    )
  }

  /**
   * Records progress (0..1) for a job this worker holds.
   * Returns whether a cancel was requested, or null when the worker no longer holds the job.
   */
  progress(id: string, workerId: string, progress: number, message?: string | null): { cancelRequested: boolean } | null {
    const now = this.now()
    const row = this.db
      .update(jobs)
      .set({
        progress: Math.min(1, Math.max(0, progress)),
        ...(message !== undefined ? { message } : {}),
        heartbeatAt: now,
        updatedAt: now,
        rev: nextRev,
      })
      .where(this.heldBy(id, workerId))
      .returning({ cancelRequested: jobs.cancelRequested })
      .get()
    return row ?? null
  }

  /** Keeps the lock alive without notifying listeners. Same return contract as `progress`. */
  heartbeat(id: string, workerId: string): { cancelRequested: boolean } | null {
    const row = this.db
      .update(jobs)
      .set({ heartbeatAt: this.now() })
      .where(this.heldBy(id, workerId))
      .returning({ cancelRequested: jobs.cancelRequested })
      .get()
    return row ?? null
  }

  succeed(id: string, workerId: string, result?: unknown): JobRow | null {
    const now = this.now()
    return (
      this.db
        .update(jobs)
        .set({
          status: 'succeeded',
          progress: 1,
          result: result ?? null,
          error: null,
          lockedBy: null,
          finishedAt: now,
          updatedAt: now,
          rev: nextRev,
        })
        .where(this.heldBy(id, workerId))
        .returning()
        .get() ?? null
    )
  }

  /**
   * Fails the current attempt: requeues with backoff while attempts remain, otherwise marks it failed.
   * `permanent` skips the retries (for errors another try can't fix, like a refused permission).
   */
  fail(id: string, workerId: string, error: string, opts: { permanent?: boolean } = {}): JobRow | null {
    const row = this.db.select().from(jobs).where(this.heldBy(id, workerId)).get()
    if (!row) return null
    return this.failRow(opts.permanent ? { ...row, attempts: row.maxAttempts } : row, error)
  }

  cancelled(id: string, workerId: string): JobRow | null {
    const now = this.now()
    return (
      this.db
        .update(jobs)
        .set({ status: 'cancelled', lockedBy: null, message: 'Cancelled', finishedAt: now, updatedAt: now, rev: nextRev })
        .where(this.heldBy(id, workerId))
        .returning()
        .get() ?? null
    )
  }

  /** Hands a running job back to the queue without using up an attempt (worker shutting down). */
  release(id: string, workerId: string): JobRow | null {
    const now = this.now()
    return (
      this.db
        .update(jobs)
        .set({
          status: 'queued',
          attempts: sql`MAX(${jobs.attempts} - 1, 0)`,
          lockedBy: null,
          startedAt: null,
          progress: 0,
          message: 'Waiting: the worker restarted',
          runAt: now,
          updatedAt: now,
          rev: nextRev,
        })
        .where(this.heldBy(id, workerId))
        .returning()
        .get() ?? null
    )
  }

  /** Cancels a queued job right away, or asks the worker to stop a running one. */
  requestCancel(id: string): JobRow | null {
    const now = this.now()
    return this.db.transaction((tx) => {
      const row = tx.select().from(jobs).where(eq(jobs.id, id)).get()
      if (!row) return null
      if (row.status === 'queued') {
        return tx
          .update(jobs)
          .set({ status: 'cancelled', message: 'Cancelled', finishedAt: now, updatedAt: now, rev: nextRev })
          .where(eq(jobs.id, id))
          .returning()
          .get()!
      }
      if (row.status === 'running' && !row.cancelRequested) {
        return tx
          .update(jobs)
          .set({ cancelRequested: true, message: 'Cancelling…', updatedAt: now, rev: nextRev })
          .where(eq(jobs.id, id))
          .returning()
          .get()!
      }
      return row
    })
  }

  /** Starts a failed or cancelled job again from scratch. Returns null if it isn't retryable. */
  retry(id: string): JobRow | null {
    const now = this.now()
    return (
      this.db
        .update(jobs)
        .set({
          status: 'queued',
          attempts: 0,
          progress: 0,
          message: null,
          error: null,
          result: null,
          cancelRequested: false,
          lockedBy: null,
          runAt: now,
          startedAt: null,
          finishedAt: null,
          updatedAt: now,
          rev: nextRev,
        })
        .where(and(eq(jobs.id, id), inArray(jobs.status, ['failed', 'cancelled'])))
        .returning()
        .get() ?? null
    )
  }

  /** Fails running jobs whose worker stopped sending heartbeats (crash, kill -9). */
  recoverStale(staleAfterMs: number): JobRow[] {
    const cutoff = new Date(this.now().getTime() - staleAfterMs)
    const stale = this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, 'running'), lt(jobs.heartbeatAt, cutoff)))
      .all()
    return stale.map((row) => this.failRow(row, 'The worker stopped while running this job'))
  }

  get(id: string): JobRow | null {
    return this.db.select().from(jobs).where(eq(jobs.id, id)).get() ?? null
  }

  /** Queued or running jobs that belong to a project. */
  activeForProject(projectId: string): JobRow[] {
    return this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.projectId, projectId), inArray(jobs.status, ['queued', 'running'])))
      .all()
  }

  /** All of a project's jobs, newest first. */
  listForProject(projectId: string): JobRow[] {
    return this.db.select().from(jobs).where(eq(jobs.projectId, projectId)).orderBy(desc(jobs.createdAt)).all()
  }

  listRecent(limit = 50): JobRow[] {
    return this.db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit).all()
  }

  changesSince(rev: number, limit = 200): JobRow[] {
    return this.db.select().from(jobs).where(gt(jobs.rev, rev)).orderBy(asc(jobs.rev)).limit(limit).all()
  }

  latestRev(): number {
    const row = this.db.select({ rev: sql<number>`COALESCE(MAX(${jobs.rev}), 0)` }).from(jobs).get()
    return row?.rev ?? 0
  }

  private heldBy(id: string, workerId: string) {
    return and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId))
  }

  private failRow(row: JobRow, error: string): JobRow {
    const now = this.now()
    const retrying = row.attempts < row.maxAttempts
    const delay = backoffMs(row.attempts)
    return this.db
      .update(jobs)
      .set(
        retrying
          ? {
              status: 'queued',
              error,
              lockedBy: null,
              message: `Failed, retrying in ${Math.round(delay / 1000)}s`,
              runAt: new Date(now.getTime() + delay),
              updatedAt: now,
              rev: nextRev,
            }
          : { status: 'failed', error, lockedBy: null, message: null, finishedAt: now, updatedAt: now, rev: nextRev },
      )
      .where(eq(jobs.id, row.id))
      .returning()
      .get()!
  }
}

function subjectOf(payload: unknown): string | null {
  const p = payload as { renderId?: unknown; modelId?: unknown; compilationId?: unknown } | null
  const id = p?.renderId ?? p?.modelId ?? p?.compilationId
  return typeof id === 'string' ? id : null
}

export function toJobDto(row: JobRow): JobDto {
  return {
    id: row.id,
    type: row.type,
    label: jobLabel(row.type),
    status: row.status,
    progress: row.progress,
    message: row.message,
    error: row.error,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    cancelRequested: row.cancelRequested,
    projectId: row.projectId,
    subjectId: subjectOf(row.payload),
    rev: row.rev,
    runAt: row.runAt.getTime(),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    startedAt: row.startedAt?.getTime() ?? null,
    finishedAt: row.finishedAt?.getTime() ?? null,
  }
}
