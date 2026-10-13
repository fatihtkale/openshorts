import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ClipService,
  JobQueue,
  LocalStorage,
  ProjectService,
  ProposalService,
  TranscriptService,
  type Word,
} from '@clipstudio/core'
import { createTestDb } from '@clipstudio/core/testing'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMcpServer } from './server'

const words: Word[] = 'Welcome back. Today I will show you the one trick that doubled our views. It is surprisingly simple. Thanks.'
  .split(' ')
  .map((text, i) => ({ text, start: i * 600, end: i * 600 + 500, p: 0.9 }))

let root: string
let client: Client
let projectId: string
let proposals: ProposalService

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clipstudio-mcp-'))
  const db = createTestDb()
  const queue = new JobQueue(db)
  const storage = new LocalStorage(root)
  const projects = new ProjectService(db, queue, storage)
  const transcripts = new TranscriptService(db, queue)
  const clips = new ClipService(db)
  proposals = new ProposalService(db, clips, projects)

  const { project, sourceKey } = projects.createForUpload({ name: 'Growth talk', filename: 'talk.mp4' })
  projects.sourceReady(project.id, sourceKey, 10, 'video/mp4')
  projects.markReady(project.id, { durationMs: 12_000, width: 1920, height: 1080, fps: 30, hasAudio: true })
  for (const job of queue.activeForProject(project.id)) queue.requestCancel(job.id)
  transcripts.request(project.id)
  transcripts.complete(project.id, { engine: 'test', model: 'test', language: 'en', words })
  projectId = project.id

  const server = createMcpServer({ projects, transcripts, clips, proposals, storage, appUrl: 'http://127.0.0.1:3000', client: 'test-client' })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  client = new Client({ name: 'test-client', version: '1' })
  await client.connect(clientSide)
})

afterEach(async () => {
  await client.close()
  await rm(root, { recursive: true, force: true })
})

const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n')

describe('MCP server', () => {
  it('explains itself and lists read and propose tools', async () => {
    expect(client.getInstructions()).toMatch(/can only PROPOSE/)
    expect(client.getInstructions()).toMatch(/Hook, seconds 0–3 \(40%\)/)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['evaluate_clip', 'get_frames', 'get_highlights', 'get_transcript', 'list_clips', 'list_projects', 'list_proposals', 'propose_clips', 'propose_import', 'propose_schedule', 'search_transcript'].sort(),
    )
    expect(tools.find((t) => t.name === 'get_transcript')?.annotations?.readOnlyHint).toBe(true)
  })

  it('reads projects and transcripts', async () => {
    const list = JSON.parse(text(await client.callTool({ name: 'list_projects', arguments: {} })))
    expect(list[0]).toMatchObject({ id: projectId, name: 'Growth talk', transcript: { status: 'ready', words: words.length } })

    const transcript = text(await client.callTool({ name: 'get_transcript', arguments: { projectId } }))
    expect(transcript).toContain('[0–1.1] Welcome back.')
    expect(transcript).toContain('This is the end of the transcript.')

    const search = text(await client.callTool({ name: 'search_transcript', arguments: { projectId, query: 'one trick' } }))
    expect(search).toMatch(/1 match .*\n\[1\.2–8\.3\] Today I will show you the one trick that doubled our views\./)
  })

  it('pages long transcripts', async () => {
    const page = text(await client.callTool({ name: 'get_transcript', arguments: { projectId, fromSec: 9 } }))
    expect(page).not.toContain('Welcome back')
    expect(page).toContain('It is surprisingly simple.')
  })

  it('sends proposals to the Inbox and reports problems as tool errors', async () => {
    const result = await client.callTool({
      name: 'propose_clips',
      arguments: {
        projectId,
        note: 'The trick is the hook',
        clips: [
          { startSec: 1.2, endSec: 10.5, title: 'The one trick', hook: 'This doubled our views', score: 88, keywords: ['trick'] },
          { startSec: 11, endSec: 11.5, title: 'Too short' },
        ],
      },
    })
    expect(result.isError).toBeFalsy()
    expect(text(result)).toMatch(/Sent 1 clip to the Inbox: http:\/\/127\.0\.0\.1:3000\/inbox/)
    expect(text(result)).toMatch(/Too short: Too short/)
    expect(proposals.list('pending')[0]).toMatchObject({ client: 'test-client', note: 'The trick is the hook' })

    const missing = await client.callTool({ name: 'get_transcript', arguments: { projectId: 'nope' } })
    expect(missing.isError).toBe(true)
    expect(text(missing)).toBe('Project not found')

    const listed = JSON.parse(text(await client.callTool({ name: 'list_clips', arguments: { projectId } })))
    expect(listed[0]).toMatchObject({ title: 'The one trick', status: 'waiting in Inbox', evaluation: 'not evaluated' })

    // Evaluating saves a note; the clip's edges stay where they are.
    const evaluation = {
      hook: 8, pacing: 6, payoff: 7, standalone: 9, hookNotes: 'Starts on the result.', retentionRisk: 'Slows at 6 s.', payoffNotes: 'Kept.',
      muteTest: 'fail', muteNotes: 'All talk.', suggestedStartSec: null, suggestedEndSec: 8.3, trimNotes: 'End on the payoff.',
    }
    const saved = await client.callTool({ name: 'evaluate_clip', arguments: { clipId: listed[0].id, evaluation } })
    expect(saved.isError).toBeFalsy()
    expect(text(saved)).toMatch(/Saved: 7.3\/10 for “The one trick”/)
    expect(text(saved)).toMatch(/Only the user can apply it/)
    const after = JSON.parse(text(await client.callTool({ name: 'list_clips', arguments: { projectId } })))
    expect(after[0]).toMatchObject({ evaluation: '7.3/10', startSec: listed[0].startSec, endSec: listed[0].endSec })
  })

  it('only proposes schedules for exported clips', async () => {
    await client.callTool({ name: 'propose_clips', arguments: { projectId, clips: [{ startSec: 1.2, endSec: 10.5, title: 'The one trick' }] } })
    const pending = proposals.list('pending')[0]!
    proposals.decideClips(pending.id, [{ clipId: pending.clips[0]!.id, approve: true }])
    const result = await client.callTool({
      name: 'propose_schedule',
      arguments: { clips: [{ projectId, title: 'The one trick' }], date: '2026-10-20' },
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/not exported yet/)
  })

  it('offers a find_clips prompt', async () => {
    const prompt = await client.getPrompt({ name: 'find_clips', arguments: { project: 'Growth talk', count: '3' } })
    const message = prompt.messages[0]!.content as { text: string }
    expect(message.text).toMatch(/Find the 3 best short-form clips in the Clip Studio project "Growth talk"/)
  })
})
