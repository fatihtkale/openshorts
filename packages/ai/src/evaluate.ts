import { aiClientLabel, type AiSettingsDto, type ClipDto } from '@clipstudio/core/shared'
import type { ClipService, ProjectService, TranscriptService } from '@clipstudio/core'
import { askClaude } from './anthropic'
import { AiError } from './errors'
import { askOllama } from './ollama'
import { EVALUATE_SCHEMA, buildEvaluatePrompt, evaluateAnswerSchema, type EvaluateItem } from './prompt'

export interface EvaluateDeps {
  projects: ProjectService
  transcripts: TranscriptService
  clips: ClipService
}

/** Where frames are taken for the mute test, as fractions of the clip. */
const FRAME_POINTS = [0.03, 0.35, 0.65, 0.95]

/**
 * Scores clips of one project with the 4-pillar rubric and stores each evaluation as a note on the clip.
 * Claude also sees four frames per clip (for the mute test); Ollama works from the transcript.
 */
export async function evaluateClips(
  deps: EvaluateDeps,
  ai: AiSettingsDto & { anthropicKey: string | null },
  clipIds: string[],
  opts: {
    signal?: AbortSignal
    onProgress?: (message: string) => void
    /** JPEG frames of the project's video at these times (seconds). */
    frames?: (projectId: string, times: number[]) => Promise<{ atSec: number; jpeg: Buffer }[]>
    anthropicBaseURL?: string
  } = {},
): Promise<ClipDto[]> {
  const clips = clipIds.map((id) => deps.clips.require(id))
  const projectId = clips[0]?.projectId
  if (!projectId || clips.some((c) => c.projectId !== projectId)) throw new AiError('Evaluate clips of one project at a time.')
  const project = deps.projects.require(projectId)
  const transcript = deps.transcripts.get(projectId)
  if (!transcript || transcript.status !== 'ready') throw new AiError('This project has no finished transcript yet.')

  const withFrames = ai.provider === 'anthropic' && !!opts.frames
  const items: EvaluateItem[] = []
  for (const clip of clips) {
    opts.onProgress?.(withFrames ? `Looking at “${clip.title}”` : 'Reading the transcript')
    const times = FRAME_POINTS.map((f) => (clip.startMs + f * (clip.endMs - clip.startMs)) / 1000)
    items.push({ clip, frames: withFrames ? await opts.frames!(projectId, times) : [] })
  }
  const { system, blocks } = buildEvaluatePrompt(project.name, transcript.words, items, withFrames)

  let raw: unknown
  if (ai.provider === 'anthropic') {
    if (!ai.anthropicKey) throw new AiError('Add an Anthropic API key in Settings first.')
    opts.onProgress?.('Claude is judging the clips')
    raw = await askClaude({ apiKey: ai.anthropicKey, model: ai.anthropicModel, system, user: blocks, schema: EVALUATE_SCHEMA, signal: opts.signal, baseURL: opts.anthropicBaseURL })
  } else if (ai.provider === 'ollama') {
    opts.onProgress?.(`${ai.ollamaModel} is judging the clips`)
    const user = blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n\n')
    raw = await askOllama({ baseUrl: ai.ollamaUrl, model: ai.ollamaModel, system, user, schema: EVALUATE_SCHEMA, signal: opts.signal })
  } else {
    throw new AiError('In-app AI is off. Turn it on in Settings.')
  }

  const parsed = evaluateAnswerSchema.safeParse(raw)
  if (!parsed.success) throw new AiError('The model returned evaluations in a shape the app could not use.')
  const by = aiClientLabel(ai)
  const saved: ClipDto[] = []
  for (const { clipId, evaluation } of parsed.data.evaluations) {
    if (!clipIds.includes(clipId)) continue
    saved.push(deps.clips.setEvaluation(clipId, evaluation, by))
  }
  if (!saved.length) throw new AiError('The model did not evaluate any of the clips.')
  return saved
}
