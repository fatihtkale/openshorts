import type { SocialApps } from '@clipstudio/social'
import type {
  AccountService,
  AiSettingsDto,
  ClipService,
  JobPayload,
  JobRow,
  JobType,
  ModelService,
  PostService,
  ProjectService,
  ProposalService,
  RenderService,
  Storage,
  TranscriptService,
} from '@clipstudio/core'
import { demoCount } from './demo'
import { createDownloadHandler } from './download'
import { createFacesHandler } from './faces'
import { createEvaluateClipsHandler, createFindClipsHandler } from './find'
import { createModelDownloadHandler } from './models'
import { createPrepareHandler } from './prepare'
import { createPublishHandler } from './publish'
import { createRenderHandler } from './render'
import { createStatsHandler } from './stats'
import { createTranscribeHandler } from './transcribe'

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
  transcripts: TranscriptService
  models: ModelService
  clips: ClipService
  proposals: ProposalService
  /** In-app AI settings with the Anthropic key unsealed; read per job so Settings changes apply at once. */
  ai: () => AiSettingsDto & { anthropicKey: string | null }
  renders: RenderService
  posts: PostService
  accounts: AccountService
  socialApps: SocialApps
  storage: Storage
}

export function createHandlers(deps: HandlerDeps): JobHandlers {
  return {
    'demo.count': demoCount,
    'ingest.download': createDownloadHandler(deps),
    'media.prepare': createPrepareHandler(deps),
    'media.faces': createFacesHandler(deps),
    transcribe: createTranscribeHandler(deps),
    'models.download': createModelDownloadHandler(deps),
    'clip.render': createRenderHandler(deps),
    'post.publish': createPublishHandler(deps),
    'post.stats': createStatsHandler(deps),
    'clips.find': createFindClipsHandler(deps),
    'clips.evaluate': createEvaluateClipsHandler(deps),
  }
}

/** Runs when a job stops for good (out of retries, or cancelled), so its project can show what happened. */
export function createGiveUpHook({ projects, transcripts, renders, posts }: HandlerDeps) {
  return (job: JobRow, outcome: 'failed' | 'cancelled') => {
    projects.jobGaveUp(job, outcome)
    transcripts.jobGaveUp(job, outcome)
    renders.jobGaveUp(job, outcome)
    posts.jobGaveUp(job, outcome)
  }
}
