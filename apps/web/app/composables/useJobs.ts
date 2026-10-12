import type { JobDto } from '@clipstudio/core/shared'

const ACTIVE = new Set<JobDto['status']>(['queued', 'running'])

type StatusListener = (job: JobDto, previous: JobDto | undefined) => void
const statusListeners = new Set<StatusListener>()

/** Calls `listener` whenever a job appears or changes status, while the calling component is mounted. */
export function onJobStatusChange(listener: StatusListener) {
  onMounted(() => statusListeners.add(listener))
  onBeforeUnmount(() => statusListeners.delete(listener))
}

export function emitJobStatusChange(job: JobDto, previous: JobDto | undefined) {
  for (const listener of statusListeners) listener(job, previous)
}

/** Live job list. The connection itself lives in plugins/jobs.client.ts. */
export function useJobs() {
  const byId = useState<Record<string, JobDto>>('jobs', () => ({}))
  const connected = useState('jobs-connected', () => false)

  const jobs = computed(() => Object.values(byId.value).sort((a, b) => b.createdAt - a.createdAt))
  const active = computed(() => jobs.value.filter((j) => ACTIVE.has(j.status)))

  /** Applies updates, ignoring any that are older than what we already have. */
  function merge(updates: JobDto[]) {
    const next = { ...byId.value }
    for (const job of updates) {
      const known = next[job.id]
      if (!known || job.rev >= known.rev) next[job.id] = job
    }
    byId.value = next
  }

  async function cancel(id: string) {
    merge([await $fetch<JobDto>(`/api/jobs/${id}/cancel`, { method: 'POST' })])
  }

  async function retry(id: string) {
    merge([await $fetch<JobDto>(`/api/jobs/${id}/retry`, { method: 'POST' })])
  }

  /** The newest queued or running job for a project, if any. */
  function activeFor(projectId: string): JobDto | undefined {
    return active.value.find((j) => j.projectId === projectId)
  }

  return { byId, jobs, active, connected, merge, cancel, retry, activeFor }
}
