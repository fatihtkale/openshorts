import { formatTimecode, type JobDto, type ProjectDto } from '@clipstudio/core/shared'
import type { UploadState } from '~/composables/useUploads'

export type ActivityTone = 'neutral' | 'primary' | 'success' | 'error' | 'warning'

export interface ProjectActivity {
  label: string
  detail: string | null
  /** 0..1, or null when there's no bar to show (or it can't be measured). */
  progress: number | null
  tone: ActivityTone
  busy: boolean
}

export function formatDuration(ms: number | null): string {
  return ms === null ? '' : formatTimecode(ms / 1000)
}

export function resolutionLabel(p: Pick<ProjectDto, 'width' | 'height'>): string {
  if (!p.width || !p.height) return ''
  if (p.height > p.width) return `Vertical ${p.width}×${p.height}`
  return `${p.height}p`
}

export function thumbnailUrl(p: ProjectDto): string | null {
  if (p.assets.thumbnail) return `/api/projects/${p.id}/media/thumbnail?v=${p.assets.thumbnail.updatedAt}`
  return p.sourceMeta?.thumbnailUrl ?? null
}

const JOB_WORDS: Record<string, [running: string, queued: string]> = {
  'ingest.download': ['Downloading', 'Waiting to download'],
  'media.prepare': ['Preparing video', 'Waiting to prepare'],
  transcribe: ['Transcribing', 'Waiting to transcribe'],
  'media.faces': ['Finding faces', 'Waiting to find faces'],
  'clip.render': ['Exporting', 'Waiting to export'],
}

/** What a project is doing right now, combining its status, its active job and any upload in this tab. */
export function describeProject(p: ProjectDto, job: JobDto | undefined, upload: UploadState | undefined): ProjectActivity {
  if (upload) {
    return {
      label: 'Uploading',
      detail: `${formatBytes(upload.loaded)} of ${formatBytes(upload.total)}`,
      progress: upload.total ? upload.loaded / upload.total : null,
      tone: 'primary',
      busy: true,
    }
  }
  if (job) {
    const running = job.status === 'running'
    const [doing, waiting] = JOB_WORDS[job.type] ?? ['Working', 'Waiting']
    return {
      label: running ? doing : waiting,
      detail: running ? job.message : job.error ? `Last try failed: ${job.error}` : null,
      progress: running ? job.progress : null,
      tone: 'primary',
      busy: true,
    }
  }
  if (p.status === 'ready') {
    return {
      label: [formatDuration(p.durationMs), resolutionLabel(p)].filter(Boolean).join(' · '),
      detail: null,
      progress: null,
      tone: 'neutral',
      busy: false,
    }
  }
  if (p.status === 'failed') return { label: 'Failed', detail: p.error, progress: null, tone: 'error', busy: false }
  if (p.sourceType === 'upload' && p.status === 'importing') {
    return {
      label: 'Upload interrupted',
      detail: 'The page was closed before the file finished uploading.',
      progress: null,
      tone: 'warning',
      busy: false,
    }
  }
  return { label: 'Starting…', detail: null, progress: null, tone: 'primary', busy: true }
}
