import { toJobDto } from '@clipstudio/core'

export default defineEventHandler((event) => {
  const { queue, projects, transcripts, renders, posts } = useCore()
  const row = queue.requestCancel(getRouterParam(event, 'id')!)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  // A queued job is cancelled right here; a running one is stopped by the worker, which updates its project.
  if (row.status === 'cancelled') {
    projects.jobGaveUp(row, 'cancelled')
    transcripts.jobGaveUp(row, 'cancelled')
    renders.jobGaveUp(row, 'cancelled')
    posts.jobGaveUp(row, 'cancelled')
  }
  return toJobDto(row)
})
