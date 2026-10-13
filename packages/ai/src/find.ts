import { aiClientLabel, type AiSettingsDto, type ProposalDto } from '@clipstudio/core/shared'
import type { ClipService, ProjectService, ProposalService, TranscriptService } from '@clipstudio/core'
import { askClaude } from './anthropic'
import { AiError } from './errors'
import { askOllama } from './ollama'
import { ANSWER_SCHEMA, answerSchema, buildPrompt } from './prompt'

/** Small local models can't read a long transcript well; above this, use Claude. */
const OLLAMA_MAX_CHARS = 120_000

export interface FindDeps {
  projects: ProjectService
  transcripts: TranscriptService
  clips: ClipService
  proposals: ProposalService
}

/**
 * Reads a project's transcript with the configured model and sends its picks to the Inbox as one proposal.
 * Nothing is cut: the user approves each clip there, as with Claude through MCP.
 */
export async function findClips(
  deps: FindDeps,
  ai: AiSettingsDto & { anthropicKey: string | null },
  input: { projectId: string; count: number; focus?: string },
  opts: { signal?: AbortSignal; onProgress?: (message: string) => void; anthropicBaseURL?: string } = {},
): Promise<{ proposal: ProposalDto; skipped: { title: string; reason: string }[] }> {
  const project = deps.projects.require(input.projectId)
  const transcript = deps.transcripts.get(input.projectId)
  if (!transcript || transcript.status !== 'ready' || !transcript.words.length) throw new AiError('This project has no finished transcript yet.')

  const { system, user } = buildPrompt({
    projectName: project.name,
    durationMs: project.durationMs ?? 0,
    words: transcript.words,
    existing: deps.clips.list(input.projectId),
    count: input.count,
    focus: input.focus,
  })

  let raw: unknown
  if (ai.provider === 'anthropic') {
    if (!ai.anthropicKey) throw new AiError('Add an Anthropic API key in Settings first.')
    opts.onProgress?.('Claude is reading the transcript')
    raw = await askClaude({
      apiKey: ai.anthropicKey,
      model: ai.anthropicModel,
      system,
      user,
      schema: ANSWER_SCHEMA,
      signal: opts.signal,
      baseURL: opts.anthropicBaseURL,
      onText: () => opts.onProgress?.('Writing suggestions'),
    })
  } else if (ai.provider === 'ollama') {
    if (user.length > OLLAMA_MAX_CHARS) throw new AiError('This transcript is too long for a local model. Use Claude, or Claude Code through MCP.')
    opts.onProgress?.(`${ai.ollamaModel} is reading the transcript`)
    raw = await askOllama({ baseUrl: ai.ollamaUrl, model: ai.ollamaModel, system, user, schema: ANSWER_SCHEMA, signal: opts.signal })
  } else {
    throw new AiError('In-app AI is off. Turn it on in Settings.')
  }

  const parsed = answerSchema.safeParse(raw)
  if (!parsed.success) throw new AiError('The model returned clips in a shape the app could not use.')
  const drafts = parsed.data.clips.filter((c) => c.endSec > c.startSec).slice(0, input.count)
  if (!drafts.length) throw new AiError('The model found no clips worth suggesting.')

  return deps.proposals.proposeClips({
    projectId: input.projectId,
    note: parsed.data.note || null,
    client: aiClientLabel(ai),
    clips: drafts.map((c) => ({
      startMs: Math.round(c.startSec * 1000),
      endMs: Math.round(c.endSec * 1000),
      title: c.title,
      hook: c.hook || null,
      reason: c.reason || null,
      keywords: c.keywords,
      evaluation: c.evaluation,
      emojis: Object.fromEntries(c.emojis.map((e) => [e.word, e.emoji])),
    })),
  })
}
