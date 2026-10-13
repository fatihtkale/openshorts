import { AI_PROVIDERS, CLAUDE_MODELS, saveAiSettings } from '@clipstudio/core'
import { z } from 'zod'

const body = z.object({
  provider: z.enum(AI_PROVIDERS),
  anthropicModel: z.enum(CLAUDE_MODELS.map((m) => m.id) as [string, ...string[]]),
  /** A new key, null to remove the saved one, or left out to keep it. */
  anthropicKey: z.string().trim().min(20).max(300).nullable().optional(),
  ollamaUrl: z.url({ protocol: /^https?$/ }),
  ollamaModel: z.string().max(120),
})

export default defineEventHandler(async (event) => {
  const value = await readValidatedBody(event, body.parse)
  const core = useCore()
  return saveAiSettings(core.db, core.secretKey, value)
})
