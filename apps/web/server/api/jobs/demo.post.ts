import { jobDefinitions, toJobDto } from '@clipstudio/core'

export default defineEventHandler(async (event) => {
  const payload = await readValidatedBody(event, (body) => jobDefinitions['demo.count'].payload.parse(body ?? {}))
  return toJobDto(useCore().queue.enqueue('demo.count', payload))
})
