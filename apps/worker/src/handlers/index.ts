import type { JobPayload, JobRow, JobType, ProjectService, Storage } from '@clipstudio/core'
import { demoCount } from './demo'
import { createDownloadHandler } from './download'
import { createPrepareHandler } from './prepare'

export interface JobContext {
  jobId: string
  /** 1 on the first try, 2 on the first retry, and so on. */
  attempt: number
  /** Aborted when the job is cancelled or the worker shuts down. Pass it to anything long-running. */
  signal: AbortSignal
  /**
   * Reports progress as a fraction 0..1 with an optional status line for the UI.
   * Pass null to update only the message (for steps with no measurable progress).
   */
  progress(fraction: number | null, message?: string): void
  log(message: string): void
}

export type JobHandler<T extends JobType> = (payload: JobPayload<T>, ctx: JobContext) => Promise<unknown>

/** Every job type must have a handler; TypeScript enforces it through this mapped type. */
export type JobHandlers = { [K in JobType]: JobHandler<K> }

export interface HandlerDeps {
  projects: ProjectService
  storage: Storage
}

export function createHandlers(deps: HandlerDeps): JobHandlers {
  return {
    'demo.count': demoCount,
    'ingest.download': createDownloadHandler(deps),
    'media.prepare': createPrepareHandler(deps),
  }
}

/** Runs when a job stops for good (out of retries, or cancelled), so its project can show what happened. */
export function createGiveUpHook({ projects }: HandlerDeps) {
  return (job: JobRow, outcome: 'failed' | 'cancelled') => projects.jobGaveUp(job, outcome)
}
