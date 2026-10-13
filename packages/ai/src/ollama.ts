import { AiError } from './errors'

/** Ollama runs models on this Mac; nothing leaves it. */
export async function ollamaModels(baseUrl: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/tags`, { signal }).catch(() => {
    throw new AiError(`Ollama isn't running at ${baseUrl}. Install it from ollama.com and open it.`)
  })
  if (!res.ok) throw new AiError(`Ollama answered with HTTP ${res.status}.`)
  const data = (await res.json()) as { models?: { name: string }[] }
  return (data.models ?? []).map((m) => m.name)
}

export async function askOllama(opts: {
  baseUrl: string
  model: string
  system: string
  user: string
  schema: Record<string, unknown>
  signal?: AbortSignal
}): Promise<unknown> {
  if (!opts.model) throw new AiError('Choose an Ollama model in Settings.')
  // Room for the whole prompt plus the answer (about 3.5 characters per token).
  const numCtx = Math.min(131_072, Math.ceil((opts.system.length + opts.user.length) / 3.5) + 8_192)
  const res = await fetch(`${opts.baseUrl}/api/chat`, {
    method: 'POST',
    signal: opts.signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      format: opts.schema,
      options: { temperature: 0.3, num_ctx: numCtx },
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    }),
  }).catch((e: Error) => {
    if (opts.signal?.aborted) throw e
    throw new AiError(`Ollama isn't running at ${opts.baseUrl}. Open the Ollama app and try again.`)
  })
  const body = (await res.json().catch(() => ({}))) as { message?: { content?: string }; error?: string }
  if (!res.ok) {
    if (res.status === 404) throw new AiError(`Ollama doesn't have “${opts.model}”. Run: ollama pull ${opts.model}`)
    throw new AiError(`Ollama failed: ${body.error ?? `HTTP ${res.status}`}`)
  }
  try {
    return JSON.parse(body.message?.content ?? '')
  } catch {
    throw new AiError(`${opts.model} returned an answer the app could not read. A larger model usually does better.`)
  }
}
