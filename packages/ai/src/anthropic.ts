import Anthropic from '@anthropic-ai/sdk'
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { AiError } from './errors'

/** Prompt content: text, or text and JPEG frames. */
export type PromptBlock = { type: 'text'; text: string } | { type: 'image'; jpeg: Buffer }

function toContent(user: string | PromptBlock[]): string | BetaContentBlockParam[] {
  if (typeof user === 'string') return user
  return user.map((b) =>
    b.type === 'text' ? { type: 'text', text: b.text } : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.jpeg.toString('base64') } },
  )
}

/** Models with server-side refusal fallback (`fallbacks: "default"`); Haiku has none. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])

/**
 * One structured-output request to Claude. Streams (long transcripts, long answers) and returns the parsed JSON.
 * A declined request falls back server-side to the model Anthropic recommends for that case.
 */
export async function askClaude(opts: {
  apiKey: string
  model: string
  system: string
  user: string | PromptBlock[]
  schema: Record<string, unknown>
  signal?: AbortSignal
  baseURL?: string
  onText?: (chars: number) => void
}): Promise<unknown> {
  const client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 2 })
  const fallback = FALLBACK_MODELS.has(opts.model)
  try {
    const stream = client.beta.messages.stream(
      {
        model: opts.model,
        max_tokens: 32_000,
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high', format: { type: 'json_schema', schema: opts.schema } },
        system: opts.system,
        messages: [{ role: 'user', content: toContent(opts.user) }],
      },
      { signal: opts.signal },
    )
    let chars = 0
    stream.on('text', (t) => opts.onText?.((chars += t.length)))
    const message = await stream.finalMessage()
    if (message.stop_reason === 'refusal') throw new AiError('Claude declined to work on this transcript.')
    if (message.stop_reason === 'max_tokens') throw new AiError('The answer was cut off. Try asking for fewer clips.')
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    try {
      return JSON.parse(text)
    } catch {
      throw new AiError('Claude returned an answer the app could not read.')
    }
  } catch (error) {
    if (error instanceof AiError || opts.signal?.aborted) throw error
    if (error instanceof Anthropic.AuthenticationError) throw new AiError('Anthropic refused the API key. Check it in Settings.')
    if (error instanceof Anthropic.PermissionDeniedError) throw new AiError(`This API key can't use ${opts.model}.`)
    if (error instanceof Anthropic.NotFoundError) throw new AiError(`Model ${opts.model} was not found.`)
    if (error instanceof Anthropic.RateLimitError) throw new AiError('Anthropic is rate-limiting this key. Try again in a minute.')
    if (error instanceof Anthropic.BadRequestError) throw new AiError(`Anthropic rejected the request: ${error.message}`)
    if (error instanceof Anthropic.APIConnectionError) throw new AiError('Could not reach Anthropic. Check the internet connection.')
    if (error instanceof Anthropic.APIError) throw new AiError(`Anthropic had a problem (${error.status ?? 'no status'}). Try again later.`)
    throw error
  }
}
