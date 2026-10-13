import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests against a production build on port 3100 with its own empty data folder (e2e/.data),
 * so the real app and its data are never touched. Speech models are borrowed read-only from data/models.
 * Uses the Chrome installed on this Mac (no Playwright browser download).
 */
const root = resolve(import.meta.dirname, '..')
export const PORT = 3100
export const DATA_DIR = join(root, 'e2e/.data')
export const MEDIA_DIR = join(root, 'e2e/.media')

// A fresh data folder each run, before the server starts. Playwright loads this file again in its test workers
// (which inherit the environment), so the marker makes sure the reset happens only once.
if (!process.env.CLIPSTUDIO_E2E_RESET) {
  process.env.CLIPSTUDIO_E2E_RESET = '1'
  rmSync(DATA_DIR, { recursive: true, force: true })
  mkdirSync(DATA_DIR, { recursive: true })
  if (existsSync(join(root, 'data/models'))) symlinkSync(join(root, 'data/models'), join(DATA_DIR, 'models'))
}

// A short talking clip with a greeting up front (macOS `say` + an ffmpeg test pattern).
const video = join(MEDIA_DIR, 'talk.mp4')
if (!existsSync(video)) {
  mkdirSync(MEDIA_DIR, { recursive: true })
  const speech = join(MEDIA_DIR, 'talk.aiff')
  execFileSync('say', [
    '-o',
    speech,
    'Hey guys, welcome back to the channel. So, um, here is the thing. Most videos lose half their viewers in the first three seconds. ' +
      'The fix is simple. Start with the result, not the setup. Show the ending first, then explain how you got there. ' +
      'We tried it on forty videos. That one change doubled our watch time, and it costs nothing.',
  ])
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-i', speech, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video])
}

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  outputDir: join(root, 'e2e/.results'),
  webServer: {
    // `pnpm test:e2e` builds first; this only starts the built app and the worker.
    command: 'pnpm start',
    cwd: root,
    url: `http://127.0.0.1:${PORT}/api/system`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { DATA_DIR, PORT: String(PORT), HOST: '127.0.0.1', APP_URL: `http://127.0.0.1:${PORT}`, NUXT_PORT: String(PORT), NITRO_PORT: String(PORT) },
  },
})
