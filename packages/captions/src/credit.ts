import { closestWeight, fontString } from './fonts'

type Ctx = CanvasRenderingContext2D

/** What the credit banner shows: the platform (icon and colour), the streamer's name and their link line. */
export interface CreditBanner {
  platform: string
  name: string
  /** "twitch.tv/omie"; may be empty. */
  line: string
}

/** Banner timing within a clip: slides in, stays, slides out. */
export const CREDIT_IN_MS = 350
export const CREDIT_OUT_MS = 350

export const PLATFORM_COLOURS: Record<string, string> = {
  twitch: '#9146FF',
  youtube: '#FF0033',
  kick: '#53FC18',
  tiktok: '#111111',
  other: '#3F3F46',
}

const easeOut = (x: number) => 1 - (1 - x) ** 3

/** How far the banner is shown at `t` (0 hidden … 1 fully in), for a banner lasting `durationMs`. */
export function creditProgress(t: number, durationMs: number): number {
  if (t < 0 || t >= durationMs) return 0
  if (t < CREDIT_IN_MS) return easeOut(t / CREDIT_IN_MS)
  if (t > durationMs - CREDIT_OUT_MS) return easeOut((durationMs - t) / CREDIT_OUT_MS)
  return 1
}

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** The platform's mark, white on its colour, in a `s`×`s` square at (x, y). Drawn with paths: no image files needed. */
function drawMark(ctx: Ctx, platform: string, x: number, y: number, s: number) {
  const colour = PLATFORM_COLOURS[platform] ?? PLATFORM_COLOURS.other!
  ctx.fillStyle = colour
  roundedRect(ctx, x, y, s, s, s * 0.22)
  ctx.fill()
  const u = s / 24
  const p = (px: number, py: number) => [x + px * u, y + py * u] as const
  const poly = (pts: [number, number][], fill: string) => {
    ctx.fillStyle = fill
    ctx.beginPath()
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(...p(px, py)) : ctx.moveTo(...p(px, py))))
    ctx.closePath()
    ctx.fill()
  }
  if (platform === 'twitch') {
    poly([[6, 3.5], [4, 7], [4, 19], [8, 19], [8, 21.5], [10.5, 21.5], [13, 19], [16.5, 19], [20.5, 15], [20.5, 3.5]], '#fff')
    poly([[6, 5.2], [18.8, 5.2], [18.8, 14.2], [15.8, 17.2], [12.3, 17.2], [9.8, 19.7], [9.8, 17.2], [6, 17.2]], colour)
    ctx.fillStyle = '#fff'
    ctx.fillRect(...p(11.2, 8), 1.7 * u, 5 * u)
    ctx.fillRect(...p(15, 8), 1.7 * u, 5 * u)
  } else if (platform === 'youtube') {
    poly([[9.5, 7.5], [17.5, 12], [9.5, 16.5]], '#fff')
  } else if (platform === 'kick') {
    poly([[6, 5], [10, 5], [10, 10], [12, 10], [12, 8], [14, 8], [14, 6], [16, 6], [16, 5], [19, 5], [19, 9], [17, 9], [17, 11], [15, 11], [15, 13], [17, 13], [17, 15], [19, 15], [19, 19], [16, 19], [16, 18], [14, 18], [14, 16], [12, 16], [12, 14], [10, 14], [10, 19], [6, 19]], '#000')
  } else if (platform === 'tiktok') {
    // A music note in TikTok's two colours, offset like the logo.
    const note = (dx: number, dy: number, fill: string) => {
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.arc(...p(9.5 + dx, 16 + dy), 3.2 * u, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillRect(...p(11.2 + dx, 4 + dy), 2.4 * u, 12 * u)
      ctx.fillRect(...p(11.2 + dx, 4 + dy), 6 * u, 2.6 * u)
    }
    note(-0.6, -0.6, '#25F4EE')
    note(0.6, 0.6, '#FE2C55')
    note(0, 0, '#fff')
  } else {
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(...p(12, 9), 3.6 * u, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(...p(12, 18.5), 6.5 * u, 4 * u, 0, Math.PI, 0)
    ctx.fill()
  }
}

/**
 * Draws the credit banner (lower left) for time `t` into a canvas of `w`×`h`: a dark card with the platform's mark,
 * the streamer's name and their link. It slides in from the left, stays, and slides out after `durationMs`.
 */
export function drawCredit(ctx: Ctx, banner: CreditBanner, t: number, durationMs: number, w: number, h: number) {
  const shown = creditProgress(t, durationMs)
  if (shown <= 0) return
  const scale = h / 1080
  const name = banner.name.trim() || banner.line.trim()
  const line = banner.name.trim() ? banner.line.trim() : ''
  if (!name) return

  const pad = 22 * scale
  const mark = (line ? 92 : 64) * scale
  const nameSize = (line ? 46 : 40) * scale
  const lineSize = 30 * scale
  const nameFont = fontString(closestWeight('Montserrat', 900), nameSize, 'Montserrat')
  const lineFont = fontString(closestWeight('Inter', 700), lineSize, 'Inter')
  ctx.save()
  ctx.font = nameFont
  const nameW = ctx.measureText(name).width
  ctx.font = lineFont
  const lineW = line ? ctx.measureText(line).width : 0
  const cardW = pad + mark + pad * 0.9 + Math.max(nameW, lineW) + pad * 1.4
  const cardH = mark + pad * 2
  const margin = 56 * scale
  // Higher than the side margin, clear of game HUDs along the bottom edge (GTA's health bar sits there).
  const bottom = 120 * scale
  const x = margin - (1 - shown) * (cardW + margin)
  const y = h - bottom - cardH

  ctx.globalAlpha = Math.min(1, shown * 1.4)
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 24 * scale
  ctx.shadowOffsetY = 6 * scale
  ctx.fillStyle = 'rgba(12, 12, 16, 0.86)'
  roundedRect(ctx, x, y, cardW, cardH, 18 * scale)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  // A strip in the platform's colour along the left edge.
  ctx.fillStyle = PLATFORM_COLOURS[banner.platform] ?? PLATFORM_COLOURS.other!
  roundedRect(ctx, x, y, 7 * scale, cardH, 3 * scale)
  ctx.fill()

  drawMark(ctx, banner.platform, x + pad, y + pad, mark)
  const textX = x + pad + mark + pad * 0.9
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
  ctx.font = nameFont
  if (line) {
    ctx.fillText(name, textX, y + pad + nameSize * 0.95)
    ctx.fillStyle = 'rgba(255,255,255,0.72)'
    ctx.font = lineFont
    ctx.fillText(line, textX, y + pad + mark - lineSize * 0.28)
  } else {
    ctx.fillText(name, textX, y + cardH / 2 + nameSize * 0.36)
  }
  ctx.restore()
}
