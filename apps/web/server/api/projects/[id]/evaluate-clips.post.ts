import { aiSettings } from '@clipstudio/core'
import { z } from 'zod'

const body = z.object({ clipIds: z.array(z.string()).min(1).max(20) })

/** Starts an in-app AI evaluation of some clips (the user confirmed it and its cost). */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const { clipIds } = await readValidatedBody(event, body.parse)
  const core = useCore()
  const ai = aiSettings(core.db)
  if (ai.provider === 'off') throw createError({ statusCode: 409, statusMessage: 'Turn on in-app AI in Settings first' })
  if (ai.provider === 'anthropic' && !ai.hasAnthropicKey && !ai.envKey) throw createError({ statusCode: 409, statusMessage: 'Add an Anthropic API key in Settings first' })
  return withProjectErrors(() => {
    core.projects.require(id)
    for (const clipId of clipIds) if (core.clips.require(clipId).projectId !== id) throw createError({ statusCode: 400, statusMessage: 'A clip is not in this project' })
    if (core.transcripts.get(id)?.status !== 'ready') throw createError({ statusCode: 409, statusMessage: 'This project has no finished transcript yet' })
    if (core.queue.activeForProject(id).some((j) => j.type === 'clips.evaluate')) throw createError({ statusCode: 409, statusMessage: 'Already evaluating clips in this project' })
    return core.queue.enqueue('clips.evaluate', { projectId: id, clipIds }, { projectId: id })
  })
})
