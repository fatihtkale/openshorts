// Safe to import from the browser: no Node or database dependencies.
import { z } from 'zod'
import type { Word } from './transcripts'

/**
 * How a clip is judged. YouTube Shorts (and TikTok) mostly reward two things: viewers not swiping away in the
 * first 1–3 seconds, and viewers staying to the last frame. Four pillars, weighted.
 */
export const PILLARS = [
  { key: 'hook', label: 'Hook', weight: 0.4, question: 'Do the first 3 s drop you into the action and stop the scroll?' },
  { key: 'pacing', label: 'Pacing', weight: 0.3, question: 'Does every second add something, with the feeling changing?' },
  { key: 'payoff', label: 'Payoff', weight: 0.2, question: 'Is the hook’s promise kept, ending right on it?' },
  { key: 'standalone', label: 'Standalone', weight: 0.1, question: 'Does it make sense to a stranger?' },
] as const
export type PillarKey = (typeof PILLARS)[number]['key']

export const MUTE_TEST = ['pass', 'weak', 'fail'] as const
export type MuteTest = (typeof MUTE_TEST)[number]
export const MUTE_TEST_LABELS: Record<MuteTest, string> = { pass: 'Works on mute', weak: 'Partly works on mute', fail: 'Needs sound' }

/** Length targets: 22–45 s is the sweet spot; under 15 s rarely has an arc, over 50 s loses viewers fast. */
export const SWEET_SPOT_MIN_MS = 22_000
export const SWEET_SPOT_MAX_MS = 45_000
export const SHORT_ARC_MS = 15_000
export const DROP_OFF_MS = 50_000

export function lengthAdvice(ms: number): { tone: 'good' | 'ok' | 'warn'; text: string } {
  if (ms < SHORT_ARC_MS) return { tone: 'warn', text: 'Under 15 s: often too short for a satisfying arc' }
  if (ms > DROP_OFF_MS) return { tone: 'warn', text: 'Over 50 s: expect heavy drop-off unless the story is exceptional' }
  if (ms >= SWEET_SPOT_MIN_MS && ms <= SWEET_SPOT_MAX_MS) return { tone: 'good', text: 'In the 22–45 s sweet spot' }
  return { tone: 'ok', text: ms < SWEET_SPOT_MIN_MS ? 'A little short; 22–45 s is the sweet spot' : 'A little long; 22–45 s is the sweet spot' }
}

/** The rubric, shared by the MCP instructions, the in-app finder and the in-app evaluator. */
export const CLIP_RUBRIC = `Judge every clip like a YouTube Shorts growth strategist. Two numbers decide a Short: how many viewers stay past the first seconds instead of swiping (strong Shorts keep about 80% or more), and average view duration against the length (the best reach 100% or more: watched to the end and partly rewatched). Every second either holds attention or loses it. Score four pillars from 1 to 10:

1. Hook, seconds 0–3 (40%). Stop power: the viewer is dropped straight into the action or story without being told what's coming (an "anti-hook": "he floors it toward the cops…" beats "you won't believe what happened"); the point is clear within 2 seconds. Never "hey guys", greetings, "have you ever wondered", "in this video" or a streamer setting up ("chat, watch this"). Build-up: the key moment (jump, crash, reveal, punchline) lands 1–5 s in, after a short lead-in that shows it coming; a clip that opens on the impact itself gives the payoff away and scores lower. Tension or shock opens better than a calm or happy beat. Recognition: a viewer instantly gets who or what it's about. Tension: it opens a loop (the shocking result first, a big mistake, a contrarian fact) that makes them stay to see it closed.
2. Pacing, second 3 to the end (30%). Density: every second adds something; no dead air, stammering, filler or repetition. Emotional change: attention follows a change in feeling (tension → shock → laugh → relief); the same beat twice in a row (a repeated joke, reaction, line, sound, or the streamer saying "chat" again and again) is where viewers leave. Micro-pacing: the story shifts or escalates every 5–7 seconds. Calls to action ("subscribe", "follow", "comment below") cost viewers; flag them for trimming. Mute test: could it be followed on mute, through on-screen text, gestures, expressions or action, or does it rely entirely on the words?
3. Payoff (20%). The hook's promise is fully kept (no clickbait that earns "Not interested"). The clip ends on the payoff, abruptly: no walking away, wind-down, outro or reaction to the reaction afterwards (viewers see the progress bar and leave). Bonus if it invites a rewatch: the last beat flows back into the first, or it cuts a moment into the payoff so people replay it. Rewatches are the strongest signal a Short gets.
4. Standalone (10%). A stranger who never saw the long video, and doesn't know the game, server or streamer, understands and enjoys it.

Trim aggressively: models tend to include too much context. Start in medias res: cut greetings, intros, "so", "anyway" and transitions, but keep 1–3 s of build-up before the key moment (suggest an earlier start when a clip opens right on it). End right on the payoff. 22–45 s is the sweet spot; under 15 s rarely has an arc; over 50 s loses viewers unless the story is exceptional. Finishing matters more than length: a 20 s clip watched twice beats a 45 s clip abandoned halfway. When the boundaries could be better, give exact new start and end times.`

/** Weighted 1–10 total, computed here rather than trusted from the model. One decimal. */
export function evaluationTotal(p: Record<PillarKey, number>): number {
  const total = PILLARS.reduce((sum, pillar) => sum + pillar.weight * p[pillar.key], 0)
  return Math.round(total * 10) / 10
}

const pillarScore = z.number().transform((n) => Math.min(10, Math.max(1, Math.round(n))))
const note = (max: number) => z.string().transform((s) => s.trim().slice(0, max))

/** An evaluation as a model writes it (times in seconds, suggested edges optional). */
export const evaluationInputSchema = z.object({
  hook: pillarScore,
  pacing: pillarScore,
  payoff: pillarScore,
  standalone: pillarScore,
  hookNotes: note(600),
  retentionRisk: note(600),
  payoffNotes: note(400),
  muteTest: z.enum(MUTE_TEST),
  muteNotes: note(300),
  suggestedStartSec: z.number().min(0).nullable(),
  suggestedEndSec: z.number().positive().nullable(),
  trimNotes: note(400),
})
export type EvaluationInput = z.input<typeof evaluationInputSchema>

/** What is stored on a clip. */
export interface ClipEvaluation {
  hook: number
  pacing: number
  payoff: number
  standalone: number
  total: number
  hookNotes: string
  retentionRisk: string
  payoffNotes: string
  muteTest: MuteTest
  muteNotes: string
  /** Better edges, already snapped to words; null when the current ones are fine. */
  suggestedStartMs: number | null
  suggestedEndMs: number | null
  trimNotes: string
  /** The range that was judged; when the clip has moved since, the evaluation is out of date. */
  evaluatedStartMs: number
  evaluatedEndMs: number
  /** Who judged it ("Claude", "In-app AI (Claude Opus 5.5)"). */
  by: string | null
  at: number
}

/** JSON schema of one evaluation, for structured outputs (every field required, no extras). */
export const EVALUATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hook', 'pacing', 'payoff', 'standalone', 'hookNotes', 'retentionRisk', 'payoffNotes', 'muteTest', 'muteNotes', 'suggestedStartSec', 'suggestedEndSec', 'trimNotes'],
  properties: {
    hook: { type: 'integer', description: '1–10' },
    pacing: { type: 'integer', description: '1–10' },
    payoff: { type: 'integer', description: '1–10' },
    standalone: { type: 'integer', description: '1–10' },
    hookNotes: { type: 'string', description: 'Why the first 3 seconds succeed or fail.' },
    retentionRisk: { type: 'string', description: 'Dead spots or pacing drop-offs, with times.' },
    payoffNotes: { type: 'string', description: 'Is the promise kept? Does it loop?' },
    muteTest: { type: 'string', enum: [...MUTE_TEST] },
    muteNotes: { type: 'string' },
    suggestedStartSec: { type: ['number', 'null'], description: 'Better start in seconds from the video start, or null if fine.' },
    suggestedEndSec: { type: ['number', 'null'], description: 'Better end in seconds from the video start, or null if fine.' },
    trimNotes: { type: 'string', description: 'What the trim removes and why.' },
  },
} as const

const AUDIENCE = "(guys|everyone|everybody|folks|friends|y'?all|all|team|people)"
const WELCOME = `welcome( back)?( to( the| my| our)? (channel|video|podcast|show|episode|stream))?( ${AUDIENCE})?`
/**
 * A greeting at the start of a clip, on lower-cased words without punctuation: "hey guys welcome back to the channel",
 * "hi everyone", "what's up guys", "hello and welcome". A bare "hey" is not enough ("Hey, that's wrong" stays).
 */
const GREETING = new RegExp(
  `^((hey|hi|hello|yo|what'?s up|good (morning|afternoon|evening))( ${AUDIENCE}( and)?( ${WELCOME})?|( and)? ${WELCOME})|${WELCOME})(?= |$)`,
)
/** Openers that delay the point; a clip should start on the statement itself. */
const LEAD_IN = /^(so|okay|ok|alright|well|um+|uh+|erm|ah+|hmm+|yeah|anyway|anyways|and)[,.!?…]*$/i

/**
 * Where a proposed clip should really start: skips a greeting ("Hey guys, welcome back…") and opening
 * filler ("So, um, okay…"). Leaves the start alone when trimming would leave less than 15 s or half the clip.
 */
export function trimLeadIn(words: Word[], startMs: number, endMs: number): number {
  const inside = words.filter((w) => w.start >= startMs - 50 && w.end <= endMs + 50)
  if (!inside.length) return startMs
  let i = 0
  // A greeting phrase at the very start (checked on the first 12 words).
  const opening = inside
    .slice(0, 12)
    .map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ''))
    .join(' ')
  const greeting = GREETING.exec(opening)
  if (greeting) i = greeting[0].split(' ').length
  // Up to four filler/lead-in words ("so", "um", "okay", "all right").
  for (let n = 0; n < 4 && i < inside.length; n++) {
    if (LEAD_IN.test(inside[i]!.text)) i++
    else if (/^all$/i.test(inside[i]!.text) && /^right[,.!?…]*$/i.test(inside[i + 1]?.text ?? '')) i += 2
    else break
  }
  if (i === 0 || i >= inside.length) return startMs
  const newStart = Math.max(startMs, inside[i]!.start - 120)
  const kept = endMs - newStart
  if (kept < SHORT_ARC_MS || kept < (endMs - startMs) / 2) return startMs
  return newStart
}

export function verdict(total: number): { label: string; tone: 'success' | 'warning' | 'error'; icon: string } {
  if (total >= 8) return { label: 'Strong', tone: 'success', icon: 'i-lucide-rocket' }
  if (total >= 6) return { label: 'Promising', tone: 'warning', icon: 'i-lucide-trending-up' }
  return { label: 'Weak', tone: 'error', icon: 'i-lucide-trending-down' }
}

/** Whether an evaluation still describes the clip: current, trimmed as suggested, or out of date. */
export function evaluationState(e: ClipEvaluation, range: { startMs: number; endMs: number }): 'current' | 'trimmed' | 'stale' {
  const same = (a: number, b: number) => Math.abs(a - b) < 50
  if (same(e.evaluatedStartMs, range.startMs) && same(e.evaluatedEndMs, range.endMs)) return 'current'
  if (e.suggestedStartMs !== null && same(e.suggestedStartMs, range.startMs) && same(e.suggestedEndMs!, range.endMs)) return 'trimmed'
  return 'stale'
}
