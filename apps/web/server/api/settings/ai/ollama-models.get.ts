import { AiError, ollamaModels } from '@clipstudio/ai'
import { z } from 'zod'

/** The models installed in the user's Ollama, for the Settings picker. */
export default defineEventHandler(async (event) => {
  const { url } = await getValidatedQuery(event, z.object({ url: z.url({ protocol: /^https?$/ }) }).parse)
  try {
    return { models: await ollamaModels(url.replace(/\/+$/, ''), AbortSignal.timeout(5_000)) }
  } catch (error) {
    if (error instanceof AiError) throw createError({ statusCode: 502, statusMessage: error.message })
    throw error
  }
})
