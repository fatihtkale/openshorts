import { z } from 'zod'

const body = z.object({ language: z.string().default('auto') })

/** Starts (or restarts) transcription with the active speech model. */
export default defineEventHandler(async (event) => {
  const { language } = await readValidatedBody(event, (b) => body.parse(b ?? {}))
  const { transcripts, models } = useCore()
  if (!models.active()) {
    throw createError({ statusCode: 409, statusMessage: 'Download a speech model on the System check page first' })
  }
  return withProjectErrors(() => transcripts.request(getRouterParam(event, 'id')!, language))
})
