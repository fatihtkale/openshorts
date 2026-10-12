import {
  DOWNLOAD_QUALITIES,
  ProjectError,
  parseYoutubeUrl,
  searchWords,
  toSentences,
  type ClipService,
  type ProjectService,
  type ProposalService,
  type Storage,
  type TranscriptService,
} from '@clipstudio/core'
import { fetchYoutubeInfo, grabFrame } from '@clipstudio/media'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { FIND_CLIPS_PROMPT, SERVER_INSTRUCTIONS } from './instructions'

export interface McpDeps {
  projects: ProjectService
  transcripts: TranscriptService
  clips: ClipService
  proposals: ProposalService
  storage: Storage
  /** Base URL of the app, for Inbox links, e.g. http://127.0.0.1:3000 */
  appUrl: string
  /** Name of the connected client, stored on proposals. */
  client: string | null
}

/** Characters of transcript per get_transcript page; roughly 12k tokens. */
const TRANSCRIPT_PAGE_CHARS = 45_000

const sec = (ms: number) => Math.round(ms / 100) / 10
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function ok(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] }
}

function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

/** Expected problems (bad id, wrong state) go back to Claude as tool errors it can act on. */
async function guard(fn: () => Promise<CallToolResult> | CallToolResult): Promise<CallToolResult> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof ProjectError) return fail(error.message)
    return fail(`Something went wrong: ${(error as Error).message}`)
  }
}

export function createMcpServer(deps: McpDeps): McpServer {
  const { projects, transcripts, clips, proposals, storage } = deps
  const server = new McpServer({ name: 'clipstudio', version: '0.1.0' }, { instructions: SERVER_INSTRUCTIONS })
  const inboxUrl = `${deps.appUrl}/inbox`

  function readyTranscript(projectId: string) {
    const project = projects.require(projectId)
    if (project.deletedAt) throw new ProjectError('This project is in the Trash', 'conflict')
    const transcript = transcripts.get(projectId)
    if (!transcript || !transcript.words.length) {
      throw new ProjectError(
        transcript?.status === 'pending'
          ? 'The transcript is still being made. Try again in a few minutes.'
          : 'This project has no transcript yet. Ask the user to transcribe it in the app.',
        'conflict',
      )
    }
    return { project, transcript }
  }

  // ── Read ────────────────────────────────────────────────────────────

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'All projects (one source video each) that are not in the Trash, newest first, with transcript and clip status.',
      annotations: { readOnlyHint: true },
    },
    () =>
      guard(() => {
        const list = projects.list()
        if (!list.length) return ok('There are no projects yet. The user can add videos in the app, or you can propose_import a YouTube link.')
        return ok(
          list.map((p) => {
            const all = clips.list(p.id)
            return {
              id: p.id,
              name: p.name,
              status: p.status,
              lengthSec: p.durationMs ? sec(p.durationMs) : null,
              size: p.width && p.height ? `${p.width}x${p.height}` : null,
              source: p.sourceType === 'youtube' ? (p.sourceUrl ?? 'youtube') : 'uploaded file',
              transcript: p.transcript ? { status: p.transcript.status, language: p.transcript.language, words: p.transcript.wordCount } : null,
              clips: { approved: all.filter((c) => c.status === 'approved').length, waitingInInbox: all.filter((c) => c.status === 'proposed').length },
              added: new Date(p.createdAt).toISOString(),
            }
          }),
        )
      }),
  )

  server.registerTool(
    'get_transcript',
    {
      title: 'Read a transcript',
      description:
        'The transcript as sentences with start–end times in seconds. Long transcripts come in pages: call again with fromSec set to nextFromSec until there is none.',
      inputSchema: {
        projectId: z.string(),
        fromSec: z.number().min(0).optional().describe('Start reading here (seconds). Defaults to the beginning.'),
        toSec: z.number().positive().optional().describe('Stop here (seconds). Defaults to the end.'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ projectId, fromSec, toSec }) =>
      guard(() => {
        const { project, transcript } = readyTranscript(projectId)
        const fromMs = (fromSec ?? 0) * 1000
        const toMs = toSec === undefined ? Infinity : toSec * 1000
        const sentences = toSentences(transcript.words).filter((s) => s.end > fromMs && s.start < toMs)
        const lines: string[] = []
        let used = 0
        let nextFromSec: number | null = null
        for (const s of sentences) {
          const line = `[${sec(s.start)}–${sec(s.end)}] ${s.text}`
          if (used + line.length > TRANSCRIPT_PAGE_CHARS && lines.length) {
            nextFromSec = sec(s.start)
            break
          }
          lines.push(line)
          used += line.length + 1
        }
        const header = [
          `Project "${project.name}" · ${project.durationMs ? clock(project.durationMs) : '?'} long · language ${transcript.language ?? 'unknown'} · ${transcript.wordCount} words`,
          nextFromSec === null ? 'This is the end of the transcript.' : `More follows: call get_transcript again with fromSec=${nextFromSec}.`,
          '',
        ]
        return ok([...header, ...lines].join('\n'))
      }),
  )

  server.registerTool(
    'search_transcript',
    {
      title: 'Search a transcript',
      description: 'Finds a word or phrase and returns each sentence it appears in, with times in seconds.',
      inputSchema: { projectId: z.string(), query: z.string().min(2) },
      annotations: { readOnlyHint: true },
    },
    ({ projectId, query }) =>
      guard(() => {
        const { transcript } = readyTranscript(projectId)
        const sentences = toSentences(transcript.words)
        const hits = searchWords(transcript.words, query)
        if (!hits.length) return ok(`No matches for "${query}".`)
        const seen = new Set<number>()
        const lines: string[] = []
        for (const hit of hits) {
          const ms = transcript.words[hit.from]!.start
          const i = sentences.findIndex((s) => s.start <= ms && s.end >= ms)
          if (i < 0 || seen.has(i)) continue
          seen.add(i)
          const s = sentences[i]!
          lines.push(`[${sec(s.start)}–${sec(s.end)}] ${s.text}`)
          if (lines.length >= 50) break
        }
        return ok(`${hits.length} match${hits.length === 1 ? '' : 'es'} for "${query}":\n${lines.join('\n')}`)
      }),
  )

  server.registerTool(
    'get_frames',
    {
      title: 'Look at the video',
      description: 'Still frames from the video at the given times, so you can see what is on screen.',
      inputSchema: {
        projectId: z.string(),
        timesSec: z.array(z.number().min(0)).min(1).max(8),
        width: z.number().int().min(256).max(768).optional().describe('Pixels wide; default 512.'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ projectId, timesSec, width }) =>
      guard(async () => {
        const project = projects.require(projectId)
        const proxy = projects.asset(projectId, 'proxy')
        if (!proxy || !project.durationMs) return fail('This video has not finished importing.')
        const src = await storage.localPath(proxy.storageKey)
        const content: CallToolResult['content'] = []
        for (const t of timesSec) {
          const at = Math.min(t, project.durationMs / 1000 - 0.1)
          const jpeg = await grabFrame(src, at, width ?? 512)
          content.push({ type: 'text', text: `Frame at ${at.toFixed(1)} s:` })
          content.push({ type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' })
        }
        return { content }
      }),
  )

  server.registerTool(
    'list_clips',
    {
      title: 'List clips',
      description: 'Clips of a project: approved ones, ones waiting in the Inbox, and rejected ones (so you do not suggest them again).',
      inputSchema: { projectId: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ projectId }) =>
      guard(() => {
        projects.require(projectId)
        const all = clips.list(projectId)
        if (!all.length) return ok('This project has no clips yet.')
        return ok(
          all.map((c) => ({
            title: c.title,
            status: c.status === 'proposed' ? 'waiting in Inbox' : c.status,
            startSec: sec(c.startMs),
            endSec: sec(c.endMs),
            lengthSec: sec(c.endMs - c.startMs),
            hook: c.hook,
            exported: c.render?.status === 'done' ? (c.render.clipVersion === c.version ? 'yes' : 'yes, but edited since') : 'no',
          })),
        )
      }),
  )

  server.registerTool(
    'list_proposals',
    {
      title: 'List proposals',
      description: 'What you (or another assistant) proposed and what the user decided. Pending ones are still waiting in the Inbox.',
      inputSchema: { status: z.enum(['pending', 'done', 'dismissed']).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ status }) =>
      guard(() =>
        ok(
          proposals.list(status, 20).map((p) => ({
            id: p.id,
            title: p.title,
            status: p.status,
            created: new Date(p.createdAt).toISOString(),
            clips: p.clips.map((c) => ({ title: c.title, decision: c.status === 'proposed' ? 'undecided' : c.status })),
          })),
        ),
      ),
  )

  // ── Propose ─────────────────────────────────────────────────────────

  server.registerTool(
    'propose_clips',
    {
      title: 'Propose clips',
      description:
        'Sends clip suggestions to the Inbox for the user to approve. Nothing is cut or published. Send all clips for a project in one call, best first.',
      inputSchema: {
        projectId: z.string(),
        note: z.string().max(1000).optional().describe('A short message to the user about this batch.'),
        clips: z
          .array(
            z.object({
              startSec: z.number().min(0),
              endSec: z.number().positive(),
              title: z.string().min(1).max(120),
              hook: z.string().max(160).optional().describe('On-screen text for the first seconds, 10 words or fewer.'),
              reason: z.string().max(600).optional().describe('Why this moment works as a short.'),
              score: z.number().min(0).max(100).optional(),
              keywords: z.array(z.string()).max(12).optional().describe('Spoken words to highlight in captions.'),
              emojis: z
                .array(z.object({ word: z.string(), emoji: z.string().max(16) }))
                .max(12)
                .optional()
                .describe('Emoji to pop up above spoken words (used by the Emoji caption style). One emoji per word.'),
            }),
          )
          .min(1)
          .max(30),
      },
    },
    ({ projectId, note, clips: drafts }) =>
      guard(() => {
        const { proposal, skipped } = proposals.proposeClips({
          projectId,
          note,
          client: deps.client,
          clips: drafts.map((c) => ({
            ...c,
            startMs: Math.round(c.startSec * 1000),
            endMs: Math.round(c.endSec * 1000),
            emojis: Object.fromEntries((c.emojis ?? []).map((e) => [e.word, e.emoji])),
          })),
        })
        const lines = [
          `Sent ${proposal.clips.length} clip${proposal.clips.length === 1 ? '' : 's'} to the Inbox: ${inboxUrl}`,
          'Nothing happens until the user approves them there. Edges were snapped to word boundaries:',
          ...proposal.clips.map((c) => `- ${c.title} (${sec(c.startMs)}–${sec(c.endMs)} s, ${sec(c.endMs - c.startMs)} s)`),
        ]
        if (skipped.length) lines.push('', 'Skipped:', ...skipped.map((s) => `- ${s.title}: ${s.reason}`))
        return ok(lines.join('\n'))
      }),
  )

  server.registerTool(
    'propose_import',
    {
      title: 'Propose a YouTube import',
      description:
        'Suggests downloading a YouTube video as a new project. The user sees the title, length and quality in the Inbox and confirms the download there.',
      inputSchema: {
        url: z.string().describe('A YouTube video link.'),
        quality: z.enum(DOWNLOAD_QUALITIES).optional().describe('Default 1080.'),
        startSec: z.number().min(0).optional().describe('Only import from here.'),
        endSec: z.number().positive().optional().describe('Only import up to here.'),
        note: z.string().max(1000).optional(),
      },
    },
    ({ url, quality, startSec, endSec, note }) =>
      guard(async () => {
        const parsed = parseYoutubeUrl(url)
        if (!parsed) return fail('That is not a YouTube video link.')
        const meta = await fetchYoutubeInfo(parsed.url, AbortSignal.timeout(45_000))
        if (meta.isLive) return fail('This is a live stream or upcoming premiere. It can be imported after it ends.')
        const range =
          startSec !== undefined || endSec !== undefined
            ? { start: startSec ?? 0, end: endSec ?? meta.durationSec ?? Number.MAX_SAFE_INTEGER }
            : undefined
        const existing = projects.findByYoutubeId(meta.videoId)
        proposals.proposeImport({ url: parsed.url, meta, quality: quality ?? '1080', range, note, client: deps.client })
        return ok(
          [
            `Proposed importing "${meta.title}" (${meta.durationSec ? clock(meta.durationSec * 1000) : 'unknown length'}). It's waiting in the Inbox: ${inboxUrl}`,
            existing.length ? `Note: this video is already a project ("${existing[0]!.name}").` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        )
      }),
  )

  server.registerTool(
    'propose_schedule',
    {
      title: 'Propose a posting day',
      description:
        'Suggests posting some exported clips on a day. The user opens it from the Inbox in the scheduler, checks the times, accounts and texts, and confirms there. Use list_clips to find clips that are exported.',
      inputSchema: {
        clips: z.array(z.object({ projectId: z.string(), title: z.string() })).min(1).max(20).describe('Clips by project and exact title, in posting order.'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD in the audience time zone (default: the user picks).'),
        note: z.string().max(1000).optional(),
      },
    },
    ({ clips: wanted, date, note }) =>
      guard(() => {
        const ids: string[] = []
        const problems: string[] = []
        for (const w of wanted) {
          const clip = clips.list(w.projectId, ['approved']).find((c) => c.title.trim().toLowerCase() === w.title.trim().toLowerCase())
          if (!clip) problems.push(`"${w.title}": no approved clip with that title in that project`)
          else if (clip.render?.status !== 'done') problems.push(`"${w.title}": not exported yet (the user exports it in the editor)`)
          else ids.push(clip.id)
        }
        if (!ids.length) return fail(`Nothing to schedule. ${problems.join('; ')}`)
        proposals.proposeSchedule({ clipIds: ids, date: date ?? null, accountIds: [], note, client: deps.client, title: `Post ${ids.length} ${ids.length === 1 ? 'clip' : 'clips'}${date ? ` on ${date}` : ''}` })
        return ok(
          [
            `Proposed a posting plan for ${ids.length} clip${ids.length === 1 ? '' : 's'}. The user finishes it in the scheduler from the Inbox: ${inboxUrl}`,
            problems.length ? `Left out: ${problems.join('; ')}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        )
      }),
  )

  // ── Prompts ─────────────────────────────────────────────────────────

  server.registerPrompt(
    'find_clips',
    {
      title: 'Find clips',
      description: 'Ask Claude to find the best short clips in a project and send them to the Inbox.',
      argsSchema: {
        project: z.string().optional().describe('Project name (default: the newest with a transcript)'),
        count: z.string().optional().describe('How many clips, e.g. "5"'),
        focus: z.string().optional().describe('A topic or style to look for'),
      },
    },
    (args) => ({
      messages: [{ role: 'user', content: { type: 'text', text: FIND_CLIPS_PROMPT(args) } }],
    }),
  )

  return server
}
