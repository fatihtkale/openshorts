/**
 * Runs face detection on a project's preview copy and prints what it found.
 *   pnpm --filter @clipstudio/worker exec tsx src/dev/faces.ts <projectId>
 */
import { autoFrame, faceCoverage } from '@clipstudio/captions'
import { getConfig } from '@clipstudio/core'
import { detectFaces, ensureFaceModel } from '@clipstudio/media'
import { join } from 'node:path'

const projectId = process.argv[2]
if (!projectId) throw new Error('Pass a project id')
const config = getConfig()
const t0 = performance.now()
const track = await detectFaces({
  src: join(config.storageDir, 'projects', projectId, 'proxy.mp4'),
  durationMs: Number(process.argv[3] ?? 60_000),
  width: Number(process.argv[4] ?? 1920),
  height: Number(process.argv[5] ?? 1080),
  modelPath: await ensureFaceModel(config.modelsDir),
})
const ms = performance.now() - t0
const withFaces = track.frames.filter((f) => f.length).length
console.log(`${track.frames.length} samples in ${Math.round(ms)} ms (${(ms / track.frames.length).toFixed(1)} ms each)`)
console.log(`faces in ${withFaces} samples (${Math.round((withFaces / track.frames.length) * 100)}%), cuts at`, track.cuts.map((c) => (c / 1000).toFixed(1)))
const clip = { start: 0, end: track.frames.length * track.sampleMs }
const kf = autoFrame(track, clip)
console.log(`coverage ${faceCoverage(track, clip).toFixed(2)}, ${kf.length} keyframes:`, kf.slice(0, 12).map((k) => `${(k.t / 1000).toFixed(1)}s→${k.x.toFixed(2)}`).join(' '))

// Contact sheet: every 2 s, the frame with its detected faces boxed. Writes data/dev/faces-sheet.jpg.
if (process.argv.includes('--sheet')) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  const { execFileSync } = await import('node:child_process')
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const dir = join(config.dataDir, 'dev')
  mkdirSync(dir, { recursive: true })
  const src = join(config.storageDir, 'projects', projectId, 'proxy.mp4')
  const every = 2000
  const n = Math.floor((track.frames.length * track.sampleMs) / every)
  const cellW = 320
  const sheet = createCanvas(cellW * 6, Math.ceil(n / 6) * 140)
  const ctx = sheet.getContext('2d')
  for (let i = 0; i < n; i++) {
    const t = i * every
    const jpg = execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', String(t / 1000), '-i', src, '-frames:v', '1', '-vf', `scale=${cellW}:-2`, '-f', 'image2pipe', '-c:v', 'mjpeg', '-'])
    const img = await loadImage(jpg)
    const x = (i % 6) * cellW
    const y = Math.floor(i / 6) * 140
    ctx.drawImage(img, x, y, cellW, img.height)
    ctx.strokeStyle = '#22c55e'
    ctx.lineWidth = 2
    for (const f of track.frames[Math.round(t / track.sampleMs)] ?? []) ctx.strokeRect(x + f.x * cellW, y + f.y * img.height, f.w * cellW, f.h * img.height)
    ctx.fillStyle = '#fff'
    ctx.font = '700 14px Inter'
    ctx.fillText(`${(t / 1000).toFixed(0)}s`, x + 4, y + 16)
  }
  writeFileSync(join(dir, 'faces-sheet.jpg'), await sheet.encode('jpeg', 80))
  console.log(join(dir, 'faces-sheet.jpg'))
}
