import { z } from 'zod'

const body = z.object({
  name: z.string().max(200),
  filename: z.string().min(1).max(500),
})

/** Creates a project that waits for its file; the browser then PUTs the file to /api/projects/:id/source. */
export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body.parse)
  const { projects } = useCore()
  return withProjectErrors(() => projects.getDto(projects.createForUpload(input).project.id))
})
