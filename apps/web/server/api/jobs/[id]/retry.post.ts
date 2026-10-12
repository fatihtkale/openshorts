import { toJobDto } from '@clipstudio/core'

export default defineEventHandler((event) => {
  const { queue, projects, transcripts, renders, posts } = useCore()
  const id = getRouterParam(event, 'id')!
  const row = queue.retry(id)
  if (row) {
    projects.jobRetried(row)
    transcripts.jobRetried(row)
    renders.jobRetried(row)
    posts.jobRetried(row)
    return toJobDto(row)
  }
  if (!queue.get(id)) throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  throw createError({ statusCode: 409, statusMessage: 'Only failed or cancelled jobs can be retried' })
})
