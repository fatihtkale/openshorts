import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClipService, JobQueue, LocalStorage, ProjectService, ProposalService, TranscriptService, type AiSettingsDto, type Word } from '@clipstudio/core'
import { createTestDb } from '@clipstudio/core/testing'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AiError } from './errors'
import { evaluateClips } from './evaluate'
import { findClips, type FindDeps } from './find'
import { ollamaModels } from './ollama'
import { buildPrompt } from './prompt'

/** One word every 500 ms for a minute, a full stop every 10 words. */
const words: Word[] = Array.from({ length: 120 }, (_, i) => ({ text: `w${i}${i % 10 === 9 ? '.' : ''}`, start: i * 500, end: i * 500 + 400, p: 0.9 }))

const judged = (hook: number, more: Record<string, unknown> = {}) => ({
  hook,
  pacing: 8,
  payoff: 8,
  standalone: 7,
  hookNotes: 'Starts on the claim.',
  retentionRisk: 'None.',
  payoffNotes: 'Kept.',
  muteTest: 'weak',
  muteNotes: 'Talking head.',
  suggestedStartSec: null,
  suggestedEndSec: null,
  trimNotes: '',
  ...more,
})
const answer = {
  note: 'Two strong moments.',
  clips: [
    { startSec: 5, endSec: 29.9, title: 'The big claim', hook: 'Nobody tells you this', reason: 'Bold opening', keywords: ['w10'], emojis: [{ word: 'w12', emoji: '🔥' }], evaluation: judged(9) },
    { startSec: 30, endSec: 54.9, title: 'The payoff', hook: '', reason: 'Clear ending', keywords: [], emojis: [], evaluation: judged(12) },
  ],
}

// ── A fake Anthropic API and Ollama, recording what they were sent ──
let server: Server
let base = ''
const seen: { path: string; headers: IncomingMessage['headers']; body: Record<string, unknown> }[] = []
let anthropicStatus = 200

function sse(res: ServerResponse, text: string) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const events: [string, unknown][] = [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, 20) } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(20) } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 50 } }],
    ['message_stop', { type: 'message_stop' }],
  ]
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  res.end()
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks).toString()
    const url = new URL(req.url!, base)
    seen.push({ path: url.pathname, headers: req.headers, body: raw ? JSON.parse(raw) : {} })
    if (url.pathname === '/v1/messages') {
      const evaluating = JSON.stringify(seen.at(-1)!.body).includes('evaluations')
      if (anthropicStatus !== 200) {
        res.writeHead(anthropicStatus, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }))
      }
      if (evaluating) {
        const ids = [...JSON.stringify(seen.at(-1)!.body).matchAll(/Clip ([0-9a-f-]{36})/g)].map((m) => m[1])
        return sse(res, JSON.stringify({ evaluations: ids.map((clipId) => ({ clipId, evaluation: judged(6, { suggestedStartSec: 12, suggestedEndSec: null, trimNotes: 'Start on the point.' }) })) }))
      }
      return sse(res, JSON.stringify(answer))
    }
    if (url.pathname === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ models: [{ name: 'qwen3:14b' }] }))
    }
    if (url.pathname === '/api/chat') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ message: { role: 'assistant', content: JSON.stringify({ ...answer, clips: answer.clips.slice(0, 1) }) } }))
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

let root: string
let deps: FindDeps
let projectId: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clipstudio-ai-'))
  const db = createTestDb()
  const queue = new JobQueue(db)
  const projects = new ProjectService(db, queue, new LocalStorage(root))
  const clips = new ClipService(db)
  const transcripts = new TranscriptService(db, queue)
  deps = { projects, transcripts, clips, proposals: new ProposalService(db, clips, projects) }
  const { project, sourceKey } = projects.createForUpload({ name: 'Podcast', filename: 'p.mp4' })
  projects.sourceReady(project.id, sourceKey, 10, 'video/mp4')
  projects.markReady(project.id, { durationMs: 60_000, width: 1920, height: 1080, fps: 30, hasAudio: true })
  for (const job of queue.activeForProject(project.id)) queue.requestCancel(job.id)
  transcripts.request(project.id)
  transcripts.complete(project.id, { engine: 'test', model: 'test', language: 'en', words })
  projectId = project.id
  seen.length = 0
  anthropicStatus = 200
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const settings = (over: Partial<AiSettingsDto & { anthropicKey: string | null }> = {}) => ({
  provider: 'anthropic' as const,
  anthropicModel: 'claude-opus-5-5',
  hasAnthropicKey: true,
  envKey: false,
  ollamaUrl: base,
  ollamaModel: 'qwen3:14b',
  anthropicKey: 'sk-ant-test-key-000000000000',
  ...over,
})

describe('in-app Find clips', () => {
  it('builds a prompt with the timed transcript, existing clips and focus', () => {
    const { system, user } = buildPrompt({ projectName: 'Podcast', durationMs: 60_000, words, existing: [{ title: 'Old', startMs: 0, endMs: 5000 }], count: 5, focus: 'jokes' })
    expect(system).toContain('22–45 s is the sweet spot')
    expect(system).toContain('Hook, seconds 0–3 (40%)')
    expect(user).toContain('[0–4.9] w0 w1')
    expect(user).toContain('- Old (0–5 s)')
    expect(user).toContain('Focus on: jokes')
  })

  it('asks Claude with structured output and fallbacks, then sends the picks to the Inbox', async () => {
    const { proposal } = await findClips(deps, settings(), { projectId, count: 5 }, { anthropicBaseURL: base })
    const req = seen.find((s) => s.path === '/v1/messages')!
    expect(req.headers['x-api-key']).toBe('sk-ant-test-key-000000000000')
    expect(req.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01')
    expect(req.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', stream: true, thinking: { type: 'adaptive' }, output_config: { effort: 'high', format: { type: 'json_schema' } } })

    expect(proposal.client).toBe('In-app AI (Claude Opus 5.5)')
    expect(proposal.note).toBe('Two strong moments.')
    expect(proposal.clips.map((c) => c.title)).toEqual(['The big claim', 'The payoff'])
    // Scores come from the pillars (12 is clamped to 10): 0.4·9 + 0.3·8 + 0.2·8 + 0.1·7 = 8.3.
    expect(proposal.clips.map((c) => c.score)).toEqual([83, 87])
    expect(proposal.clips[0]!.evaluation).toMatchObject({ total: 8.3, hookNotes: 'Starts on the claim.', by: 'In-app AI (Claude Opus 5.5)' })
  })

  it('leaves out fallbacks for Haiku and caps the clip count', async () => {
    const { proposal } = await findClips(deps, settings({ anthropicModel: 'claude-haiku-5-5' }), { projectId, count: 1 }, { anthropicBaseURL: base })
    const req = seen.find((s) => s.path === '/v1/messages')!
    expect(req.body.fallbacks).toBeUndefined()
    expect(proposal.clips).toHaveLength(1)
  })

  it('explains a refused key in plain words', async () => {
    anthropicStatus = 401
    await expect(findClips(deps, settings(), { projectId, count: 5 }, { anthropicBaseURL: base })).rejects.toThrow(/refused the API key/)
    await expect(findClips(deps, settings({ anthropicKey: null }), { projectId, count: 5 })).rejects.toBeInstanceOf(AiError)
  })

  it('works with a local Ollama model', async () => {
    expect(await ollamaModels(base)).toEqual(['qwen3:14b'])
    const { proposal } = await findClips(deps, settings({ provider: 'ollama' }), { projectId, count: 5 })
    const req = seen.find((s) => s.path === '/api/chat')!
    expect(req.body).toMatchObject({ model: 'qwen3:14b', stream: false, format: { type: 'object' } })
    expect(proposal.client).toBe('In-app AI (qwen3:14b)')
    expect(proposal.clips).toHaveLength(1)
  })

  it('evaluates existing clips with frames for the mute test and stores the notes', async () => {
    const clip = deps.clips.createManual(projectId, { startMs: 10_000, endMs: 40_000, title: 'Mine' })
    const jpeg = Buffer.from('fake-jpeg')
    const asked: number[][] = []
    const [saved] = await evaluateClips(deps, settings(), [clip.id], {
      anthropicBaseURL: base,
      frames: async (_projectId, times) => {
        asked.push(times)
        return times.map((atSec) => ({ atSec, jpeg }))
      },
    })
    const req = seen.find((s) => s.path === '/v1/messages')!
    const content = (req.body.messages as { content: { type: string; source?: { data: string } }[] }[])[0]!.content
    expect(content.filter((b) => b.type === 'image')).toHaveLength(4)
    expect(content.find((b) => b.type === 'image')!.source!.data).toBe(jpeg.toString('base64'))
    expect(asked[0]![0]).toBeCloseTo((clip.startMs + 0.03 * (clip.endMs - clip.startMs)) / 1000)
    expect(saved!.evaluation).toMatchObject({ total: 7.1, by: 'In-app AI (Claude Opus 5.5)', suggestedStartMs: 11_900 })
    // The clip itself is unchanged.
    expect([saved!.startMs, saved!.endMs, saved!.version]).toEqual([clip.startMs, clip.endMs, clip.version])
  })
})
