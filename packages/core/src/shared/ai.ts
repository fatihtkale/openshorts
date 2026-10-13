// Safe to import from the browser: no Node or database dependencies.

export const AI_PROVIDERS = ['off', 'anthropic', 'ollama'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

/** Claude models offered for in-app clip finding, best first. Prices are per million tokens (input / output). */
export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Best picks', input: 4, output: 20 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Faster, cheaper', input: 2, output: 10 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Cheapest', input: 0.1, output: 0.5 },
] as const

/** What the browser sees: never the key itself. */
export interface AiSettingsDto {
  provider: AiProvider
  anthropicModel: string
  hasAnthropicKey: boolean
  /** ANTHROPIC_API_KEY is set in .env, used when no key is saved here. */
  envKey: boolean
  ollamaUrl: string
  ollamaModel: string
}

export const DEFAULT_AI = { provider: 'off' as AiProvider, anthropicModel: 'claude-opus-5-5', ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: '' }

/** Who to name as the author of an in-app proposal. */
export function aiClientLabel(s: Pick<AiSettingsDto, 'provider' | 'anthropicModel' | 'ollamaModel'>): string {
  if (s.provider === 'ollama') return `In-app AI (${s.ollamaModel || 'Ollama'})`
  return `In-app AI (${CLAUDE_MODELS.find((m) => m.id === s.anthropicModel)?.label ?? s.anthropicModel})`
}

/**
 * A rough cost for one "Find clips" run with Claude, in US dollars: the transcript (about 4 characters per token)
 * plus instructions in, and up to ~12k tokens of thinking and answer out. Ollama runs on this Mac and costs nothing.
 */
export function estimateFindCost(transcriptChars: number, modelId: string): number {
  const m = CLAUDE_MODELS.find((x) => x.id === modelId) ?? CLAUDE_MODELS[0]
  const input = transcriptChars / 4 + 3_000
  const output = 12_000
  return (input * m.input + output * m.output) / 1_000_000
}

/** What makes a good clip. Shared by the MCP instructions (Claude Code / Desktop) and the in-app "Find clips"; the scoring rubric is CLIP_RUBRIC. */
export const CLIP_PICKING_RULES = `- Pick moments that work on their own, with no earlier context, that open with a hook: start in medias res, on an intense statement, a burning question or the result first. Good: surprising claims, stories, strong opinions, practical tips, emotional or funny moments, quotable lines. Skip: intros, outros, sponsor reads, "as I said earlier", and anything that trails off.
- Open inside the action (an "anti-hook"): no sentence that announces what's coming; the point is clear within 2 seconds. Tension or shock opens better than a calm or happy beat.
- Lead-in: start 1–3 s (at most 5) before the key moment, so viewers see it coming: the approach and obstacles before a jump or crash, the setup line before a punchline. The key moment should land 1–5 s into the clip; never open on the impact or the climax itself, or the payoff is spent before anyone is invested.
- Prefer moments where the feeling changes (tension, then shock, then a laugh) over one flat mood; repeated beats are where viewers leave. Leave out repeats, and the streamer talking to chat or asking to follow, subscribe or comment.
- Trim everything else aggressively. Never start on a greeting, "so", "anyway" or a transition; the app also drops opening greetings and filler itself. End right on the payoff: no wind-down or walking away afterwards; ending a beat early so people rewatch is better than lingering.
- Length: 22–45 s is the sweet spot. Under 15 s rarely has an arc; over 50 s loses viewers unless the story is exceptional (hard limits 3–180 s). Finishing matters more than length. Edges snap to word boundaries.
- For each clip: a title (60 characters or fewer, honest, no hashtags, worded differently from the other clips' titles: YouTube treats repeated titles as spam), a hook (the on-screen text for the first seconds, 10 words or fewer, ideally under 6; your own words that react to or point at what's about to happen, not a copy of the speech), the reason it works, 3–6 keywords from the spoken words (used to highlight captions), and optionally a few emojis for key spoken words.`

/**
 * A rough cost for evaluating clips with Claude, in US dollars: per clip about 40 s of transcript, four small
 * frames and ~2k tokens of thinking and answer, plus the rubric once.
 */
export function estimateEvaluateCost(clipCount: number, modelId: string): number {
  const m = CLAUDE_MODELS.find((x) => x.id === modelId) ?? CLAUDE_MODELS[0]
  const input = 2_500 + clipCount * (400 + 4 * 150)
  const output = clipCount * 2_000
  return (input * m.input + output * m.output) / 1_000_000
}
