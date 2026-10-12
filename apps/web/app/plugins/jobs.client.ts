import type { JobDto } from '@clipstudio/core/shared'

/** Loads recent jobs, then follows changes over server-sent events, reconnecting with the latest cursor. */
export default defineNuxtPlugin(() => {
  const { byId, merge, connected } = useJobs()
  const toast = useToast()
  let rev = 0
  let source: EventSource | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  function notify(previous: JobDto | undefined, job: JobDto) {
    if (!previous || previous.status === job.status) return
    if (job.status === 'failed') {
      toast.add({ title: `${job.label} failed`, description: job.error ?? undefined, color: 'error', icon: 'i-lucide-circle-x' })
    } else if (job.status === 'succeeded' && job.type === 'media.prepare') {
      toast.add({ title: 'A video is ready', description: 'Open it from Projects.', color: 'success', icon: 'i-lucide-circle-check' })
    } else if (job.status === 'succeeded' && job.type === 'demo.count') {
      toast.add({ title: `${job.label} finished`, color: 'success', icon: 'i-lucide-circle-check' })
    }
  }

  function connect() {
    source = new EventSource(`/api/events?rev=${rev}`)
    source.onopen = () => (connected.value = true)
    source.addEventListener('jobs', (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as { rev: number; jobs: JobDto[] }
      rev = Math.max(rev, data.rev)
      const previous = new Map(data.jobs.map((job) => [job.id, byId.value[job.id]]))
      for (const job of data.jobs) notify(previous.get(job.id), job)
      merge(data.jobs)
      for (const job of data.jobs) {
        const before = previous.get(job.id)
        if (!before || before.status !== job.status) emitJobStatusChange(job, before)
      }
    })
    source.onerror = () => {
      connected.value = false
      source?.close()
      clearTimeout(retryTimer)
      retryTimer = setTimeout(connect, 2_000)
    }
  }

  async function start() {
    try {
      const initial = await $fetch<{ rev: number; jobs: JobDto[] }>('/api/jobs')
      rev = initial.rev
      merge(initial.jobs)
    } catch {
      // The stream below will catch us up once the server answers.
    }
    connect()
  }

  void start()
})
