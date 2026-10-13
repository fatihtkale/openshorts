import { aiSettings } from '@clipstudio/core'
import { z } from 'zod'

const body = z.object({ count: z.number().int().min(1).max(20), focus: z.string().trim().max(300).optional() })

/** Starts an in-app AI run (the user confirmed it and its cost). Its clips arrive in the Inbox as a proposal. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const input = await readValidatedBody(event, body.parse)
  const core = useCore()
  const ai = aiSettings(core.db)
  if (ai.provider === 'off') throw createError({ statusCode: 409, statusMessage: 'Turn on in-app AI in Settings first' })
  if (ai.provider === 'anthropic' && !ai.hasAnthropicKey && !ai.envKey) throw createError({ statusCode: 409, statusMessage: 'Add an Anthropic API key in Settings first' })
  return withProjectErrors(() => {
    core.projects.require(id)
    const transcript = core.transcripts.get(id)
    if (transcript?.status !== 'ready') throw createError({ statusCode: 409, statusMessage: 'This project has no finished transcript yet' })
    if (core.queue.activeForProject(id).some((j) => j.type === 'clips.find')) throw createError({ statusCode: 409, statusMessage: 'Already looking for clips in this project' })
    return core.queue.enqueue('clips.find', { projectId: id, count: input.count, focus: input.focus || undefined }, { projectId: id })
  })
})
