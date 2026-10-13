import { join } from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { MEDIA_DIR } from './playwright.config'

/** Console errors and page crashes, collected per page; a page that logs one fails its test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' || /hydration/i.test(m.text())) errors.push(`${m.type()}: ${m.text()}`)
  })
  return errors
}

async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>): Promise<string> {
  const res = await request.post('/mcp', {
    headers: { accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  })
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } }
  expect(body.result.isError, body.result.content[0]?.text).toBeFalsy()
  return body.result.content[0]!.text
}

test.describe.configure({ mode: 'serial' })

test('every page loads without errors', async ({ page }) => {
  const errors = watchErrors(page)
  for (const path of ['/', '/inbox', '/calendar', '/insights', '/accounts', '/trash', '/system', '/settings', '/schedule', '/guide']) {
    await page.goto(path)
    await expect(page.locator('main, [data-slot="body"]').first()).toBeVisible()
    await page.waitForLoadState('networkidle')
  }
  expect(errors).toEqual([])
})

test('posting defaults stick after a reload', async ({ page }) => {
  await page.goto('/settings')
  const from = page.getByLabel('Post from')
  await from.fill('13:00')
  await page.getByRole('button', { name: 'Save defaults' }).click()
  await expect(page.getByText('Posting defaults saved', { exact: true })).toBeVisible()
  await page.reload()
  await expect(from).toHaveValue('13:00')
})

test('upload → transcript → Claude proposes with a score → approve trimmed → export', async ({ page, request }) => {
  test.setTimeout(420_000)
  test.skip(!(await (await request.get('/api/system')).json()).models.some((m: { installed: boolean }) => m.installed), 'needs a speech model in data/models')
  const errors = watchErrors(page)

  // 1. Upload, confirmed in the import dialog.
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(join(MEDIA_DIR, 'talk.mp4'))
  await page.getByRole('button', { name: /^Import video/ }).click()

  // 2. Wait for import, preparation and transcription (the worker does all three).
  let projectId = ''
  await expect
    .poll(
      async () => {
        const projects = (await (await request.get('/api/projects')).json()) as { id: string; status: string; transcript: { status: string } | null }[]
        const p = projects[0]
        projectId = p?.id ?? ''
        return p ? `${p.status}/${p.transcript?.status ?? 'none'}` : 'none'
      },
      { timeout: 180_000, intervals: [1_000] },
    )
    .toBe('ready/ready')

  // 3. Claude (through MCP) proposes the whole talk, with an evaluation that suggests ending after "…how you got there."
  const transcript = (await (await request.get(`/api/projects/${projectId}/transcript`)).json()) as { words: { text: string; end: number }[] }
  const there = transcript.words.find((w) => /^there[.,]?$/i.test(w.text))
  expect(there, 'the transcript should contain "there"').toBeTruthy()
  const sent = await mcp(request, 'propose_clips', {
    projectId,
    clips: [
      {
        startSec: 0,
        endSec: 60,
        title: 'Show the ending first',
        hook: 'You lose half your viewers here',
        reason: 'A clear tip with a payoff',
        evaluation: {
          hook: 8, pacing: 7, payoff: 9, standalone: 9,
          hookNotes: 'Opens on a hard number.', retentionRisk: 'None.', payoffNotes: 'Doubled watch time closes it.',
          muteTest: 'weak', muteNotes: 'Talk over a pattern.', suggestedStartSec: null, suggestedEndSec: there!.end / 1000 + 0.1, trimNotes: 'End on the result.',
        },
      },
    ],
  })
  expect(sent).toMatch(/Sent 1 clip to the Inbox/)

  // The greeting ("Hey guys, welcome back to the channel. So, um,") was cut from the start.
  const clips = (await (await request.get(`/api/projects/${projectId}/clips?status=proposed`)).json()) as { id: string; startMs: number }[]
  expect(clips[0]!.startMs).toBeGreaterThan(3_000)

  // 4. The Inbox shows the score; approve with the suggested trim.
  await page.goto('/inbox')
  await expect(page.getByText('Show the ending first')).toBeVisible()
  await expect(page.getByText('8.0', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Approve trimmed' }).click()
  await expect(page.getByText('Nothing to review')).toBeVisible()

  // 5. The editor's Score tab knows the trim was applied; export it (confirmed in a dialog).
  await page.goto(`/clips/${clips[0]!.id}`)
  await page.getByRole('tab', { name: 'Score' }).click()
  await expect(page.getByText('Suggested trim applied')).toBeVisible()
  await page.getByRole('tab', { name: 'Export' }).click()
  await page.getByRole('button', { name: 'Export video' }).click()
  await page.getByRole('button', { name: 'Export MP4' }).click()
  await expect(page.getByText('Your latest export matches these edits')).toBeVisible({ timeout: 180_000 })

  const clip = (await (await request.get(`/api/clips/${clips[0]!.id}`)).json()) as { clip: { render: { id: string } } }
  const file = await request.get(`/api/renders/${clip.clip.render.id}/download`)
  expect(file.headers()['content-type']).toContain('video/mp4')
  expect((await file.body()).length).toBeGreaterThan(50_000)
  expect(errors).toEqual([])
})
