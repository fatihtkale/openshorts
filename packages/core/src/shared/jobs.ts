// Safe to import from the browser: no Node or database dependencies.
import { z } from 'zod'
import { DOWNLOAD_QUALITIES } from './projects'
import { WHISPER_MODEL_IDS } from './transcripts'

export interface JobDefinition {
  /** Human label shown in the activity tray. */
  label: string
  /** Concurrency group; the worker caps how many jobs of a group run at once. */
  group: string
  maxAttempts: number
  payload: z.ZodType
}

export const jobDefinitions = {
  'demo.count': {
    label: 'Test job',
    group: 'default',
    maxAttempts: 2,
    payload: z.object({
      seconds: z.number().int().min(1).max(600).default(15),
      /** Make the first attempt fail at this percentage, to see a retry happen. */
      failAtPercent: z.number().int().min(1).max(99).optional(),
    }),
  },
  'ingest.download': {
    label: 'Download from YouTube',
    group: 'download',
    maxAttempts: 3,
    payload: z.object({
      projectId: z.string(),
      url: z.url(),
      quality: z.enum(DOWNLOAD_QUALITIES),
      range: z.object({ start: z.number().min(0), end: z.number().positive() }).optional(),
    }),
  },
  'media.prepare': {
    label: 'Prepare video',
    group: 'media',
    maxAttempts: 2,
    payload: z.object({ projectId: z.string() }),
  },
  'media.faces': {
    label: 'Find faces',
    group: 'media',
    maxAttempts: 2,
    payload: z.object({ projectId: z.string() }),
  },
  transcribe: {
    label: 'Transcribe',
    group: 'transcribe',
    maxAttempts: 2,
    payload: z.object({ projectId: z.string(), language: z.string().default('auto') }),
  },
  'transcript.retime': {
    label: 'Line up words with the audio',
    group: 'default',
    maxAttempts: 2,
    payload: z.object({ projectId: z.string() }),
  },
  'clip.render': {
    label: 'Export clip',
    group: 'render',
    maxAttempts: 2,
    payload: z.object({ renderId: z.string() }),
  },
  'compilation.render': {
    label: 'Export compilation',
    group: 'render',
    maxAttempts: 2,
    payload: z.object({ compilationId: z.string(), version: z.number().int() }),
  },
  'post.publish': {
    label: 'Post video',
    group: 'upload',
    maxAttempts: 3,
    payload: z.object({ postId: z.string() }),
  },
  'post.stats': {
    label: 'Check views',
    group: 'default',
    maxAttempts: 3,
    payload: z.object({ postId: z.string() }),
  },
  'clips.find': {
    label: 'Find clips with AI',
    group: 'default',
    // Each try costs money and a finished answer may already be in the Inbox, so never retry by itself.
    maxAttempts: 1,
    payload: z.object({ projectId: z.string(), count: z.number().int().min(1).max(20), focus: z.string().max(300).optional() }),
  },
  'clips.evaluate': {
    label: 'Evaluate clips with AI',
    group: 'default',
    maxAttempts: 1,
    payload: z.object({ projectId: z.string(), clipIds: z.array(z.string()).min(1).max(20) }),
  },
  'media.highlights': {
    label: 'Find highlights',
    group: 'default',
    maxAttempts: 2,
    payload: z.object({ projectId: z.string() }),
  },
  'data.backup': {
    label: 'Back up the database',
    group: 'default',
    maxAttempts: 2,
    payload: z.object({}),
  },
  'models.download': {
    label: 'Download speech model',
    group: 'download',
    maxAttempts: 2,
    payload: z.object({ modelId: z.enum(WHISPER_MODEL_IDS) }),
  },
} satisfies Record<string, JobDefinition>

export type JobType = keyof typeof jobDefinitions
export type JobPayload<T extends JobType> = z.output<(typeof jobDefinitions)[T]['payload']>
export type JobPayloadInput<T extends JobType> = z.input<(typeof jobDefinitions)[T]['payload']>

export function isJobType(type: string): type is JobType {
  return Object.hasOwn(jobDefinitions, type)
}

export function jobLabel(type: string): string {
  return isJobType(type) ? jobDefinitions[type].label : type
}

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/** What the API and the event stream send to the browser. Times are epoch milliseconds. */
export interface JobDto {
  id: string
  type: string
  label: string
  status: JobStatus
  progress: number
  message: string | null
  error: string | null
  attempts: number
  maxAttempts: number
  cancelRequested: boolean
  projectId: string | null
  /** The export or model this job works on, if any (from its payload). */
  subjectId: string | null
  rev: number
  runAt: number
  createdAt: number
  updatedAt: number
  startedAt: number | null
  finishedAt: number | null
}
