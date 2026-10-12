/**
 * Draws every caption preset (and the hook styles) on one image with the exporter's fonts and engine,
 * so look changes can be checked without exporting videos. Writes data/dev/caption-sheet.png.
 *   pnpm --filter @clipstudio/worker caption-sheet
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CAPTION_PRESETS, drawCaptions, drawHook, OUT_H, OUT_W, paginate, sampleWords, type HookSettings } from '@clipstudio/captions'
import { getConfig } from '@clipstudio/core'
import { registerCaptionFonts } from '@clipstudio/media'
import { createCanvas } from '@napi-rs/canvas'

registerCaptionFonts()
const scale = 0.25
const cellW = OUT_W * scale
const cellH = OUT_H * scale
const hooks: HookSettings[] = (['banner', 'bold', 'tag'] as const).map((style) => ({
  enabled: true,
  text: 'This one trick doubled our views',
  style,
  durationMs: 3000,
  y: 0.2,
}))
const cols = CAPTION_PRESETS.length
const sheet = createCanvas(cellW * cols, cellH * 2 + 40)
const sctx = sheet.getContext('2d')
sctx.fillStyle = '#18181b'
sctx.fillRect(0, 0, sheet.width, sheet.height)

const words = sampleWords(2400)
CAPTION_PRESETS.forEach((preset, i) => {
  for (const [row, t] of [[0, 1050], [1, 1500]] as const) {
    const cell = createCanvas(OUT_W, OUT_H)
    const ctx = cell.getContext('2d') as unknown as CanvasRenderingContext2D
    const grad = ctx.createLinearGradient(0, 0, 0, OUT_H)
    grad.addColorStop(0, '#3f6212')
    grad.addColorStop(1, '#1e3a8a')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, OUT_W, OUT_H)
    drawCaptions(ctx, paginate(ctx, words, preset.style), preset.style, t)
    if (row === 0 && i < hooks.length) drawHook(ctx, hooks[i]!, 1200)
    sctx.drawImage(cell, i * cellW, row * cellH + 40, cellW, cellH)
  }
  sctx.fillStyle = '#fff'
  sctx.font = '700 22px Inter'
  sctx.fillText(preset.label, i * cellW + 10, 28)
})

const out = join(getConfig().dataDir, 'dev', 'caption-sheet.png')
await mkdir(join(getConfig().dataDir, 'dev'), { recursive: true })
await writeFile(out, await sheet.encode('png'))
console.log(out)
