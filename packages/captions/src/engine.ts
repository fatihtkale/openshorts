/// <reference lib="dom" />
import { closestWeight, fontString } from './fonts'
import type { CaptionStyle, CaptionWord, HookSettings } from './types'
import { OUT_H, OUT_W } from './types'

/**
 * The caption engine. It draws in 1080×1920 units on any 2D canvas context: the browser preview scales the
 * context down, the exporter draws full size. Same code, same pixels.
 */
export type Ctx = CanvasRenderingContext2D

/** A screenful of caption: up to maxLines lines of up to maxWordsPerLine words. */
export interface Page {
  words: CaptionWord[]
  /** Indices into `words` for each line. */
  lines: number[][]
  start: number
  end: number
  /** Stays on screen until here: the next page's start, or a short hold after the last word. */
  showUntil: number
}

const MAX_TEXT_WIDTH = OUT_W * 0.86
const PAGE_BREAK_PAUSE = 600
const HOLD_AFTER = 350

const SENTENCE_END = /[.!?…]["')\]]?$/

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3
const easeOutBack = (t: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  const x = clamp01(t)
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2
}
const easeOutBounce = (t: number) => {
  let x = clamp01(t)
  const n1 = 7.5625
  const d1 = 2.75
  if (x < 1 / d1) return n1 * x * x
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375
  return n1 * (x -= 2.625 / d1) * x + 0.984375
}

export function displayText(text: string, style: CaptionStyle): string {
  return style.uppercase ? text.toLocaleUpperCase() : text
}

/** Space between words: a normal space plus room for animated words to grow without touching. */
function wordGap(ctx: Ctx, style: CaptionStyle): number {
  const grows = style.animation !== 'classic' && style.animation !== 'typewriter'
  return ctx.measureText(' ').width + (grows ? style.fontSize * 0.14 : 0)
}

function setFont(ctx: Ctx, style: CaptionStyle, size = style.fontSize) {
  ctx.font = fontString(closestWeight(style.fontFamily, style.fontWeight), size, style.fontFamily)
}

/** Splits words into pages and lines that fit the screen. */
export function paginate(ctx: Ctx, words: CaptionWord[], style: CaptionStyle): Page[] {
  setFont(ctx, style)
  const space = wordGap(ctx, style)
  const width = (w: CaptionWord) => ctx.measureText(displayText(w.text, style)).width
  const oneWord = style.animation === 'one-word'
  const pages: Page[] = []
  let current: { words: CaptionWord[]; lines: number[][]; lineWidth: number } | null = null

  const close = () => {
    if (current?.words.length) {
      pages.push({
        words: current.words,
        lines: current.lines,
        start: current.words[0]!.start,
        end: current.words.at(-1)!.end,
        showUntil: 0,
      })
    }
    current = null
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    const prev = words[i - 1]
    if (current && (oneWord || (prev && (word.start - prev.end > PAGE_BREAK_PAUSE || SENTENCE_END.test(prev.text))))) close()
    if (!current) current = { words: [], lines: [[]], lineWidth: 0 }

    const w = width(word)
    const line = current.lines.at(-1)!
    const fitsLine = line.length < style.maxWordsPerLine && (line.length === 0 || current.lineWidth + space + w <= MAX_TEXT_WIDTH)
    if (!fitsLine) {
      if (current.lines.length >= style.maxLines) {
        close()
        current = { words: [], lines: [[]], lineWidth: 0 }
      } else {
        current.lines.push([])
        current.lineWidth = 0
      }
    }
    const target = current.lines.at(-1)!
    current.lineWidth += (target.length ? space : 0) + w
    target.push(current.words.length)
    current.words.push(word)
  }
  close()

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!
    const next = pages[i + 1]
    const hold = page.end + HOLD_AFTER
    page.showUntil = next ? Math.max(page.end, Math.min(next.start, hold)) : hold
  }
  return pages
}

/** The page on screen at `t`, if any. */
export function pageAt(pages: Page[], t: number): Page | null {
  let lo = 0
  let hi = pages.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const p = pages[mid]!
    if (t < p.start - 40) hi = mid - 1
    else if (t >= p.showUntil) lo = mid + 1
    else return p
  }
  return null
}

interface Placed {
  word: CaptionWord
  index: number
  text: string
  /** Centre x, centre y, width. */
  cx: number
  cy: number
  w: number
  lineTop: number
}

function place(ctx: Ctx, page: Page, style: CaptionStyle): Placed[] {
  setFont(ctx, style)
  const space = wordGap(ctx, style)
  const lineHeight = style.fontSize * 1.18
  const blockTop = style.y * OUT_H - (page.lines.length * lineHeight) / 2
  const out: Placed[] = []
  page.lines.forEach((line, li) => {
    const texts = line.map((i) => displayText(page.words[i]!.text, style))
    const widths = texts.map((t) => ctx.measureText(t).width)
    const total = widths.reduce((a, b) => a + b, 0) + space * Math.max(0, line.length - 1)
    let x = OUT_W / 2 - total / 2
    const cy = blockTop + lineHeight * (li + 0.5)
    line.forEach((wi, k) => {
      out.push({ word: page.words[wi]!, index: wi, text: texts[k]!, cx: x + widths[k]! / 2, cy, w: widths[k]!, lineTop: blockTop + lineHeight * li })
      x += widths[k]! + space
    })
  })
  return out
}

/** Index of the word being spoken: from its start until the next word starts. -1 before the first. */
function activeIndex(page: Page, t: number): number {
  let active = -1
  for (let i = 0; i < page.words.length; i++) if (page.words[i]!.start <= t) active = i
  return active
}

interface WordPaint {
  fill: string
  scale?: number
  alpha?: number
  dy?: number
  glow?: string | null
}

function paintWord(ctx: Ctx, style: CaptionStyle, text: string, cx: number, cy: number, paint: WordPaint) {
  ctx.save()
  ctx.translate(cx, cy + (paint.dy ?? 0))
  const s = paint.scale ?? 1
  if (s !== 1) ctx.scale(s, s)
  ctx.globalAlpha = paint.alpha ?? 1
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  if (style.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = 16
    ctx.shadowOffsetY = 6
  }
  if (style.strokeWidth > 0) {
    ctx.lineWidth = style.strokeWidth * 2
    ctx.strokeStyle = style.strokeColor
    ctx.strokeText(text, 0, 0)
    ctx.shadowColor = 'transparent'
  }
  if (paint.glow) {
    ctx.shadowColor = paint.glow
    ctx.shadowBlur = 32
    ctx.shadowOffsetY = 0
    ctx.fillStyle = paint.fill
    ctx.fillText(text, 0, 0)
  }
  ctx.fillStyle = paint.fill
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** Pop: 0.85 → 1.15 → 1 over 200 ms. */
function popScale(age: number) {
  if (age < 0) return 1
  if (age < 90) return 0.85 + 0.3 * easeOutCubic(age / 90)
  if (age < 220) return 1.15 - 0.15 * easeOutCubic((age - 90) / 130)
  return 1
}

/** Draws the captions for output time `t` (ms). */
export function drawCaptions(ctx: Ctx, pages: Page[], style: CaptionStyle, t: number) {
  const page = pageAt(pages, t)
  if (!page) return
  const placed = place(ctx, page, style)
  const active = activeIndex(page, t)
  const anim = style.animation
  setFont(ctx, style)

  // Fade a page in and out softly, so cuts between pages don't flash.
  const pageAlpha = Math.min(clamp01((t - page.start + 60) / 80), clamp01((page.showUntil - t) / 80))

  if (anim === 'classic') {
    const lineHeight = style.fontSize * 1.18
    const byLine = new Map<number, Placed[]>()
    for (const p of placed) byLine.set(p.cy, [...(byLine.get(p.cy) ?? []), p])
    ctx.save()
    ctx.globalAlpha = pageAlpha
    for (const [cy, line] of byLine) {
      const left = line[0]!.cx - line[0]!.w / 2 - 22
      const right = line.at(-1)!.cx + line.at(-1)!.w / 2 + 22
      ctx.fillStyle = style.boxColor
      roundRect(ctx, left, cy - lineHeight / 2 + 4, right - left, lineHeight - 8, 14)
      ctx.fill()
    }
    ctx.restore()
    for (const p of placed) paintWord(ctx, style, p.text, p.cx, p.cy, { fill: style.textColor, alpha: pageAlpha })
    return
  }

  if (anim === 'box' && active >= 0) {
    const cur = placed[active]!
    const prev = placed[active - 1]
    const k = prev && prev.cy === cur.cy ? easeOutCubic((t - cur.word.start) / 120) : 1
    const cx = prev && k < 1 ? prev.cx + (cur.cx - prev.cx) * k : cur.cx
    const w = prev && k < 1 ? prev.w + (cur.w - prev.w) * k : cur.w
    const h = style.fontSize * 1.16
    ctx.save()
    ctx.globalAlpha = pageAlpha
    ctx.fillStyle = style.boxColor
    roundRect(ctx, cx - w / 2 - 22, cur.cy - h / 2, w + 44, h, 20)
    ctx.fill()
    ctx.restore()
  }

  // Work out each word's look first, so a word that grows can push its neighbours aside.
  const paints: (WordPaint | 'typed' | null)[] = placed.map((p) => {
    const isActive = p.index === active
    const spoken = p.word.start <= t
    const age = t - p.word.start
    const paint: WordPaint = { fill: style.textColor, alpha: pageAlpha }
    switch (anim) {
      case 'karaoke':
        return { ...paint, fill: isActive ? style.activeColor : style.textColor, scale: isActive ? 1 + 0.06 * easeOutCubic(age / 80) : 1 }
      case 'pop':
      case 'emoji':
        return { ...paint, fill: isActive ? style.activeColor : style.textColor, scale: isActive ? popScale(age) : 1 }
      case 'box':
        return paint
      case 'one-word':
        return { ...paint, fill: p.word.keyword ? style.activeColor : style.textColor, scale: 0.6 + 0.4 * easeOutBack(Math.max(0, age + 40) / 180) }
      case 'bounce':
        if (!spoken) return null
        return {
          ...paint,
          fill: isActive ? style.activeColor : style.textColor,
          dy: -style.fontSize * 0.55 * (1 - easeOutBounce(age / 380)),
          alpha: pageAlpha * clamp01(age / 90),
        }
      case 'glow':
        return {
          ...paint,
          fill: p.word.keyword ? style.keywordColor : style.textColor,
          glow: p.word.keyword ? style.keywordColor : null,
          scale: isActive ? (p.word.keyword ? 1.1 : 1.04) : 1,
        }
      case 'typewriter':
        return spoken ? 'typed' : null
      default:
        return paint
    }
  })

  const shift = new Array<number>(placed.length).fill(0)
  placed.forEach((p, i) => {
    const paint = paints[i]
    const s = paint && paint !== 'typed' ? (paint.scale ?? 1) : 1
    if (s <= 1) return
    const extra = (p.w * (s - 1)) / 2
    placed.forEach((q, j) => {
      if (q.cy !== p.cy || j === i) return
      shift[j]! += j < i ? -extra : extra
    })
  })

  placed.forEach((p, i) => {
    const paint = paints[i]
    if (!paint) return
    if (paint === 'typed') drawTypedWord(ctx, style, p, t, p.index === active, pageAlpha)
    else paintWord(ctx, style, p.text, p.cx + shift[i]!, p.cy, paint)
  })

  if (anim === 'emoji') {
    for (const p of placed) {
      if (!p.word.emoji || p.word.start > t) continue
      const age = t - p.word.start
      const size = style.fontSize * 1.15
      ctx.save()
      ctx.globalAlpha = pageAlpha
      ctx.translate(p.cx, p.lineTop - size * 0.35)
      const s = 0.3 + 0.7 * easeOutBack(age / 260)
      ctx.rotate(Math.sin(age / 140) * 0.08)
      ctx.scale(s, s)
      ctx.font = `${size}px "Apple Color Emoji", "Noto Color Emoji", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(p.word.emoji, 0, 0)
      ctx.restore()
    }
  }
}

function drawTypedWord(ctx: Ctx, style: CaptionStyle, p: Placed, t: number, isActive: boolean, alpha: number) {
  const age = t - p.word.start
  const chars = Array.from(p.text)
  const shown = isActive ? Math.min(chars.length, Math.max(1, Math.ceil(age / 28))) : chars.length
  const text = chars.slice(0, shown).join('')
  const left = p.cx - p.w / 2
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  if (style.strokeWidth > 0) {
    ctx.lineWidth = style.strokeWidth * 2
    ctx.strokeStyle = style.strokeColor
    ctx.strokeText(text, left, p.cy)
  }
  ctx.fillStyle = style.textColor
  ctx.fillText(text, left, p.cy)
  if (isActive && Math.floor(t / 400) % 2 === 0) {
    const x = left + ctx.measureText(text).width + 6
    ctx.fillStyle = style.activeColor
    ctx.fillRect(x, p.cy - style.fontSize * 0.42, style.fontSize * 0.12, style.fontSize * 0.84)
  }
  ctx.restore()
}

// ── Hook ───────────────────────────────────────────────────────────────

function wrap(ctx: Ctx, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      line = w
      if (lines.length === maxLines) break
    } else {
      line = next
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  return lines
}

/** The hook: on-screen text for the first seconds of the clip. */
export function drawHook(ctx: Ctx, hook: HookSettings, t: number) {
  if (!hook.enabled || !hook.text.trim() || t < 0 || t > hook.durationMs) return
  const appear = easeOutCubic(t / 220)
  const alpha = Math.min(clamp01(t / 160), clamp01((hook.durationMs - t) / 220))
  const cy = hook.y * OUT_H - (1 - appear) * 40

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (hook.style === 'bold') {
    const size = 96
    ctx.font = fontString(400, size, 'Anton')
    const lines = wrap(ctx, hook.text.toLocaleUpperCase(), 940, 3)
    const lh = size * 1.12
    lines.forEach((line, i) => {
      const y = cy - ((lines.length - 1) * lh) / 2 + i * lh
      ctx.lineJoin = 'round'
      ctx.lineWidth = 24
      ctx.strokeStyle = '#000000'
      ctx.strokeText(line, OUT_W / 2, y)
      ctx.fillStyle = '#FFFFFF'
      ctx.fillText(line, OUT_W / 2, y)
    })
  } else {
    const tag = hook.style === 'tag'
    const size = tag ? 62 : 58
    ctx.font = tag ? fontString(900, size, 'Poppins') : fontString(800, size, 'Montserrat')
    const lines = wrap(ctx, hook.text, 860, 3)
    const lh = size * 1.25
    const textW = Math.max(...lines.map((l) => ctx.measureText(l).width))
    const boxW = textW + 64
    const boxH = lines.length * lh + 40
    ctx.translate(OUT_W / 2, cy)
    if (tag) ctx.rotate(-0.04)
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = 24
    ctx.shadowOffsetY = 8
    ctx.fillStyle = tag ? '#FACC15' : '#FFFFFF'
    roundRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, tag ? 14 : 26)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = '#111111'
    lines.forEach((line, i) => ctx.fillText(line, 0, -((lines.length - 1) * lh) / 2 + i * lh + 2))
  }
  ctx.restore()
}

// ── Preview helpers ────────────────────────────────────────────────────

/** Where TikTok/Shorts/Reels put their buttons and text. Preview only, never exported. */
export const SAFE_ZONES = [
  { label: 'Buttons', x: 0.86, y: 0.36, w: 0.14, h: 0.46 },
  { label: 'Caption & music', x: 0, y: 0.84, w: 1, h: 0.16 },
  { label: 'Top bar', x: 0, y: 0, w: 1, h: 0.07 },
]

export function drawSafeZones(ctx: Ctx) {
  ctx.save()
  for (const z of SAFE_ZONES) {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.18)'
    ctx.fillRect(z.x * OUT_W, z.y * OUT_H, z.w * OUT_W, z.h * OUT_H)
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)'
    ctx.lineWidth = 3
    ctx.setLineDash([14, 10])
    ctx.strokeRect(z.x * OUT_W, z.y * OUT_H, z.w * OUT_W, z.h * OUT_H)
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.font = fontString(800, 28, 'Inter')
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(z.label, (z.x + z.w / 2) * OUT_W, (z.y + z.h / 2) * OUT_H)
  }
  ctx.restore()
}

/** Sample words for preset thumbnails: four words, the third a keyword with an emoji. */
export function sampleWords(loopMs = 2400): CaptionWord[] {
  const texts = ['This', 'is', 'huge', 'news']
  const step = loopMs / 5
  return texts.map((text, i) => ({
    text,
    start: i * step,
    end: i * step + step * 0.9,
    keyword: i === 2,
    emoji: i === 2 ? '🔥' : null,
  }))
}
