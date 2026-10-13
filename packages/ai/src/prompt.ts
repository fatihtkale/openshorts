import { CLIP_PICKING_RULES, CLIP_RUBRIC, EVALUATION_JSON_SCHEMA, evaluationInputSchema, toSentences, type ClipDto, type Word } from '@clipstudio/core/shared'
import { z } from 'zod'

const sec = (ms: number) => Math.round(ms / 100) / 10

export interface FindRequest {
  projectName: string
  durationMs: number
  words: Word[]
  existing: Pick<ClipDto, 'title' | 'startMs' | 'endMs'>[]
  count: number
  focus?: string
}

/** The transcript as timed sentences, the same shape Claude sees through MCP. */
export function transcriptText(words: Word[]): string {
  return toSentences(words)
    .map((s) => `[${sec(s.start)}–${sec(s.end)}] ${s.text}`)
    .join('\n')
}

export function buildPrompt(req: FindRequest): { system: string; user: string } {
  const system = `You find the best short-form clips (TikTok, YouTube Shorts, Reels) in a video transcript for Clip Studio. Your answer becomes suggestions in the app's Inbox, where the user approves or rejects each one.

${CLIP_PICKING_RULES}

${CLIP_RUBRIC}

You only have the transcript, so judge the mute test from what the words suggest is on screen. Evaluate every candidate and leave out the weak ones. Times are seconds from the start of the video, taken from the transcript's [start–end] marks. Return the clips best first, each with its evaluation, and a one-sentence note to the user about the batch.`
  const user = [
    `Video: "${req.projectName}" (${Math.round(req.durationMs / 1000)} s).`,
    `Find up to ${req.count} clips. Fewer is fine if there aren't that many good moments.`,
    req.focus?.trim() ? `Focus on: ${req.focus.trim()}` : '',
    req.existing.length
      ? `Clips that already exist (don't propose these again):\n${req.existing.map((c) => `- ${c.title} (${sec(c.startMs)}–${sec(c.endMs)} s)`).join('\n')}`
      : '',
    `Transcript:\n<transcript>\n${transcriptText(req.words)}\n</transcript>`,
  ]
    .filter(Boolean)
    .join('\n\n')
  return { system, user }
}

/** JSON schema for the answer (structured outputs / Ollama `format`): every field required, no extras. */
export const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['note', 'clips'],
  properties: {
    note: { type: 'string' },
    clips: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['startSec', 'endSec', 'title', 'hook', 'reason', 'keywords', 'emojis', 'evaluation'],
        properties: {
          startSec: { type: 'number' },
          endSec: { type: 'number' },
          title: { type: 'string' },
          hook: { type: 'string' },
          reason: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } },
          emojis: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['word', 'emoji'],
              properties: { word: { type: 'string' }, emoji: { type: 'string' } },
            },
          },
          evaluation: EVALUATION_JSON_SCHEMA,
        },
      },
    },
  },
} as const

/** Checks (and gently tidies) what the model returned; lengths are clamped rather than rejected. */
export const answerSchema = z.object({
  note: z.string().transform((s) => s.slice(0, 1000)),
  clips: z.array(
    z.object({
      startSec: z.number().min(0),
      endSec: z.number().positive(),
      title: z.string().min(1).transform((s) => s.slice(0, 120)),
      hook: z.string().transform((s) => s.slice(0, 160)),
      reason: z.string().transform((s) => s.slice(0, 600)),
      keywords: z.array(z.string()).transform((k) => k.slice(0, 12)),
      emojis: z.array(z.object({ word: z.string(), emoji: z.string().max(16) })).transform((e) => e.slice(0, 12)),
      evaluation: evaluationInputSchema,
    }),
  ),
})
export type Answer = z.infer<typeof answerSchema>

// ── Evaluating existing clips ─────────────────────────────────────────

/** Transcript shown around a clip, so the model can suggest moving the edges. */
export const EVALUATE_CONTEXT_BEFORE_MS = 15_000
export const EVALUATE_CONTEXT_AFTER_MS = 10_000

export interface EvaluateItem {
  clip: Pick<ClipDto, 'id' | 'title' | 'startMs' | 'endMs' | 'hook'>
  /** Frames from the clip (for the mute test), if the model can see images. */
  frames: { atSec: number; jpeg: Buffer }[]
}

export function buildEvaluatePrompt(projectName: string, words: Word[], items: EvaluateItem[], withFrames: boolean) {
  const system = `You evaluate short-form clips (YouTube Shorts, TikTok, Reels) for Clip Studio. The user sees your evaluation next to the clip and decides whether to apply any trim you suggest.

${CLIP_RUBRIC}

${withFrames ? 'Frames from each clip are attached; use them for the mute test.' : 'You only have the transcript, so judge the mute test from what the words suggest is on screen.'} The transcript of each clip comes with some context before and after it; lines marked » are inside the clip. Times are seconds from the start of the video. Return one evaluation per clip id.`
  const blocks: ({ type: 'text'; text: string } | { type: 'image'; jpeg: Buffer })[] = [{ type: 'text', text: `Video: "${projectName}".` }]
  for (const { clip, frames } of items) {
    const from = clip.startMs - EVALUATE_CONTEXT_BEFORE_MS
    const to = clip.endMs + EVALUATE_CONTEXT_AFTER_MS
    const lines = toSentences(words)
      .filter((s) => s.end > from && s.start < to)
      .map((s) => `${s.end > clip.startMs && s.start < clip.endMs ? '»' : ' '} [${sec(s.start)}–${sec(s.end)}] ${s.text}`)
    blocks.push({
      type: 'text',
      text: `Clip ${clip.id}: "${clip.title}", ${sec(clip.startMs)}–${sec(clip.endMs)} s (${sec(clip.endMs - clip.startMs)} s)${clip.hook ? `, on-screen hook "${clip.hook}"` : ''}.\n${lines.join('\n')}`,
    })
    for (const f of withFrames ? frames : []) {
      blocks.push({ type: 'text', text: `Frame at ${sec(f.atSec * 1000)} s:` }, { type: 'image', jpeg: f.jpeg })
    }
  }
  return { system, blocks }
}

export const EVALUATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['evaluations'],
  properties: {
    evaluations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['clipId', 'evaluation'],
        properties: { clipId: { type: 'string' }, evaluation: EVALUATION_JSON_SCHEMA },
      },
    },
  },
} as const

export const evaluateAnswerSchema = z.object({
  evaluations: z.array(z.object({ clipId: z.string(), evaluation: evaluationInputSchema })),
})
