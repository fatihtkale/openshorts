import { jobDefinitions, type JobQueue, type JobRow, type JobType } from '@clipstudio/core'
import type { JobContext, JobHandler, JobHandlers } from './handlers'

export interface WorkerOptions {
  queue: JobQueue
  handlers: JobHandlers
  workerId: string
  /** Max running jobs per concurrency group; `default` covers unlisted groups. */
  concurrency: Record<string, number>
  pollMs?: number
  heartbeatMs?: number
  /** A running job whose heartbeat is older than this is treated as orphaned. */
  staleAfterMs?: number
  /** How often to look for orphaned jobs (left behind by a worker that was killed). */
  staleCheckMs?: number
  /** Minimum gap between progress writes for one job. */
  progressThrottleMs?: number
  log?: (message: string) => void
  /** Called once a job stops for good: out of retries, or cancelled. */
  onGaveUp?: (job: JobRow, outcome: 'failed' | 'cancelled') => void
}

type StopReason = 'cancel' | 'shutdown' | 'lost'

interface RunningJob {
  job: JobRow
  controller: AbortController
  reason?: StopReason
  done: Promise<void>
}

export class Worker {
  private readonly running = new Map<string, RunningJob>()
  private readonly groups = [...new Set(Object.values(jobDefinitions).map((d) => d.group))]
  private stopping = false
  private pollTimer?: NodeJS.Timeout
  private heartbeatTimer?: NodeJS.Timeout
  private lastStaleCheck = 0
  private readonly log: (message: string) => void

  constructor(private readonly opts: WorkerOptions) {
    this.log = opts.log ?? ((m) => console.log(`[worker] ${m}`))
  }

  get runningCount(): number {
    return this.running.size
  }

  start(): void {
    this.recoverOrphans()
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.opts.heartbeatMs ?? 5_000)
    this.poll()
  }

  /** Claims every job there is capacity for. Exposed for tests. */
  tick(): void {
    while (!this.stopping) {
      const job = this.opts.queue.claim(this.opts.workerId, this.openGroups())
      if (!job) return
      this.launch(job)
    }
  }

  /** Stops claiming, asks running jobs to stop, and hands back any that don't finish in time. */
  async stop(timeoutMs = 10_000): Promise<void> {
    this.stopping = true
    clearTimeout(this.pollTimer)
    clearInterval(this.heartbeatTimer)
    for (const entry of this.running.values()) this.abort(entry, 'shutdown')
    const all = Promise.all([...this.running.values()].map((e) => e.done))
    await Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs))])
    for (const entry of this.running.values()) this.opts.queue.release(entry.job.id, this.opts.workerId)
  }

  private poll(): void {
    try {
      this.tick()
    } catch (error) {
      this.log(`poll failed: ${errorMessage(error)}`)
    }
    if (!this.stopping) this.pollTimer = setTimeout(() => this.poll(), this.opts.pollMs ?? 500)
  }

  private limit(group: string): number {
    return this.opts.concurrency[group] ?? this.opts.concurrency.default ?? 1
  }

  private openGroups(): string[] {
    const counts = new Map<string, number>()
    for (const { job } of this.running.values()) counts.set(job.group, (counts.get(job.group) ?? 0) + 1)
    return this.groups.filter((g) => (counts.get(g) ?? 0) < this.limit(g))
  }

  private abort(entry: RunningJob, reason: StopReason): void {
    if (entry.controller.signal.aborted) return
    entry.reason = reason
    entry.controller.abort()
  }

  /** Jobs still marked running by a worker that died (kill -9, crash) go back to the queue. */
  private recoverOrphans(): void {
    this.lastStaleCheck = Date.now()
    const recovered = this.opts.queue.recoverStale(this.opts.staleAfterMs ?? 30_000)
    if (recovered.length) this.log(`recovered ${recovered.length} orphaned job(s)`)
    for (const row of recovered) if (row.status === 'failed') this.gaveUp(row, 'failed')
  }

  private heartbeat(): void {
    if (Date.now() - this.lastStaleCheck >= (this.opts.staleCheckMs ?? 15_000)) {
      try {
        this.recoverOrphans()
      } catch (error) {
        this.log(`orphan check failed: ${errorMessage(error)}`)
      }
    }
    for (const entry of this.running.values()) {
      try {
        const state = this.opts.queue.heartbeat(entry.job.id, this.opts.workerId)
        if (!state) this.abort(entry, 'lost')
        else if (state.cancelRequested) this.abort(entry, 'cancel')
      } catch (error) {
        this.log(`heartbeat failed for ${entry.job.id}: ${errorMessage(error)}`)
      }
    }
  }

  private launch(job: JobRow): void {
    const entry = { job, controller: new AbortController() } as RunningJob
    this.running.set(job.id, entry)
    entry.done = this.execute(entry).finally(() => {
      this.running.delete(job.id)
      if (!this.stopping) setImmediate(() => this.poll())
    })
  }

  private async execute(entry: RunningJob): Promise<void> {
    const { job, controller } = entry
    const { queue, workerId } = this.opts
    const throttleMs = this.opts.progressThrottleMs ?? 250
    let lastWrite = 0
    let lastFraction = 0
    let lastMessage: string | undefined

    const ctx: JobContext = {
      jobId: job.id,
      attempt: job.attempts,
      signal: controller.signal,
      progress: (fraction, message) => {
        const now = Date.now()
        const messageChanged = message !== undefined && message !== lastMessage
        if (now - lastWrite < throttleMs && fraction !== 1 && !messageChanged) return
        lastWrite = now
        if (fraction !== null) lastFraction = fraction
        if (message !== undefined) lastMessage = message
        const state = queue.progress(job.id, workerId, lastFraction, message)
        if (!state) this.abort(entry, 'lost')
        else if (state.cancelRequested) this.abort(entry, 'cancel')
      },
      log: (message) => this.log(`${job.type} ${job.id.slice(0, 8)}: ${message}`),
    }

    this.log(`start ${job.type} ${job.id.slice(0, 8)} (attempt ${job.attempts}/${job.maxAttempts})`)
    try {
      const handler = this.opts.handlers[job.type as JobType] as JobHandler<JobType> | undefined
      if (!handler) throw new Error(`No handler registered for job type "${job.type}"`)
      const payload = jobDefinitions[job.type as JobType].payload.parse(job.payload)
      const result = await handler(payload as never, ctx)
      if (controller.signal.aborted) this.settleAborted(entry)
      else {
        queue.succeed(job.id, workerId, result)
        this.log(`done ${job.type} ${job.id.slice(0, 8)}`)
      }
    } catch (error) {
      if (controller.signal.aborted) this.settleAborted(entry)
      else {
        const row = queue.fail(job.id, workerId, errorMessage(error))
        this.log(`failed ${job.type} ${job.id.slice(0, 8)}: ${errorMessage(error)}`)
        if (row?.status === 'failed') this.gaveUp(row, 'failed')
      }
    }
  }

  private gaveUp(row: JobRow, outcome: 'failed' | 'cancelled'): void {
    try {
      this.opts.onGaveUp?.(row, outcome)
    } catch (error) {
      this.log(`give-up hook failed for ${row.id}: ${errorMessage(error)}`)
    }
  }

  private settleAborted(entry: RunningJob): void {
    const { queue, workerId } = this.opts
    if (entry.reason === 'cancel') {
      const row = queue.cancelled(entry.job.id, workerId)
      if (row) this.gaveUp(row, 'cancelled')
    } else if (entry.reason === 'shutdown') queue.release(entry.job.id, workerId)
    // 'lost': another process owns the job now, so there is nothing to write.
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'ZodError') return 'The job had invalid settings.'
  return error instanceof Error ? error.message : String(error)
}
