/** Output size of every clip: vertical 1080×1920. Everything is drawn in these units. */
export const OUT_W = 1080
export const OUT_H = 1920
export const OUT_FPS = 30

/** A time range in milliseconds. */
export interface Range {
  start: number
  end: number
}

/** A word on the clip's output timeline (after cuts), ready to draw. */
export interface CaptionWord {
  text: string
  start: number
  end: number
  /** Gets the keyword treatment (colour, glow) in presets that use it. */
  keyword?: boolean
  /** Shown above the word by the emoji preset. */
  emoji?: string | null
}

export const CAPTION_ANIMATIONS = ['karaoke', 'pop', 'box', 'one-word', 'bounce', 'typewriter', 'glow', 'emoji', 'classic'] as const
export type CaptionAnimation = (typeof CAPTION_ANIMATIONS)[number]

export interface CaptionStyle {
  animation: CaptionAnimation
  fontFamily: string
  fontWeight: number
  /** Pixels at 1080 wide. */
  fontSize: number
  uppercase: boolean
  textColor: string
  /** The word being spoken. */
  activeColor: string
  /** Keywords (glow preset). */
  keywordColor: string
  strokeColor: string
  strokeWidth: number
  shadow: boolean
  /** Box behind the active word (box preset) or each line (classic). */
  boxColor: string
  /** Vertical centre of the caption block, 0 = top, 1 = bottom. */
  y: number
  maxWordsPerLine: number
  maxLines: number
}

export interface CaptionSettings {
  enabled: boolean
  preset: string
  style: CaptionStyle
}

export const HOOK_STYLES = ['banner', 'bold', 'tag'] as const
export type HookStyleId = (typeof HOOK_STYLES)[number]

export interface HookSettings {
  enabled: boolean
  text: string
  style: HookStyleId
  durationMs: number
  /** Vertical centre, 0 = top, 1 = bottom. */
  y: number
}

export const LAYOUT_MODES = ['fill', 'fit', 'split'] as const
export type LayoutMode = (typeof LAYOUT_MODES)[number]

/** Where the 9:16 window sits at a moment. x/y are the window centre in the source, 0..1. */
export interface CropKeyframe {
  /** Milliseconds from the clip start, on the source timeline. */
  t: number
  x: number
  y: number
  /** How to move from here to the next keyframe: eased (default, for hand-made moves) or linear (smoothed paths). */
  ease?: 'smooth' | 'linear'
}

/** A fixed window for split layouts: centre 0..1 and zoom (1 = as large as fits). */
export interface PanelWindow {
  x: number
  y: number
  zoom: number
}

export interface ClipLayout {
  mode: LayoutMode
  /** Fill: follow faces automatically (keyframes come from the project's face track). */
  auto?: boolean
  /** Fill: 1 = the 9:16 window is as tall as the source; 2 = twice as close. */
  zoom: number
  /** Fill: one keyframe = a still window; more = the window moves (eased) between them. */
  keyframes: CropKeyframe[]
  /** Split: top and bottom halves, each 1080×960. */
  split: { top: PanelWindow; bottom: PanelWindow }
}

export interface TrimSettings {
  /** Ranges removed by hand (source milliseconds). */
  cuts: Range[]
  removePauses: boolean
  /** Pauses longer than this are shortened. */
  pauseMs: number
  removeFillers: boolean
}

/** Everything about how a clip looks. Stored on the clip; the preview and the export both read it. */
export interface ClipEdit {
  layout: ClipLayout
  captions: CaptionSettings
  hook: HookSettings
  trim: TrimSettings
  /** Lower-cased word → emoji, for the emoji preset. */
  emojis: Record<string, string>
}
