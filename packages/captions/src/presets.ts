import type { CaptionStyle, ClipEdit, HookSettings } from './types'

export interface CaptionPreset {
  id: string
  label: string
  description: string
  style: CaptionStyle
}

const base: CaptionStyle = {
  animation: 'karaoke',
  fontFamily: 'Montserrat',
  fontWeight: 900,
  fontSize: 84,
  uppercase: true,
  textColor: '#FFFFFF',
  activeColor: '#FACC15',
  keywordColor: '#22D3EE',
  strokeColor: '#000000',
  strokeWidth: 14,
  shadow: true,
  boxColor: '#7C3AED',
  y: 0.68,
  maxWordsPerLine: 3,
  maxLines: 2,
}

export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: 'karaoke',
    label: 'Karaoke',
    description: 'The spoken word lights up.',
    style: { ...base },
  },
  {
    id: 'pop',
    label: 'Pop',
    description: 'Each word pops as it is said.',
    style: { ...base, animation: 'pop', activeColor: '#4ADE80', fontFamily: 'Poppins', fontWeight: 900, fontSize: 88 },
  },
  {
    id: 'box',
    label: 'Box',
    description: 'A coloured box slides behind the spoken word.',
    style: { ...base, animation: 'box', strokeWidth: 0, boxColor: '#7C3AED', fontFamily: 'Montserrat', fontSize: 80 },
  },
  {
    id: 'one-word',
    label: 'One word',
    description: 'One big word at a time.',
    style: { ...base, animation: 'one-word', fontFamily: 'Anton', fontWeight: 400, fontSize: 168, maxWordsPerLine: 1, maxLines: 1, y: 0.62 },
  },
  {
    id: 'bounce',
    label: 'Bounce',
    description: 'Words drop in as they are spoken.',
    style: { ...base, animation: 'bounce', activeColor: '#FB923C', fontFamily: 'Poppins', fontWeight: 800, fontSize: 86 },
  },
  {
    id: 'typewriter',
    label: 'Typewriter',
    description: 'Letters type out with a cursor.',
    style: {
      ...base,
      animation: 'typewriter',
      fontFamily: 'JetBrains Mono',
      fontWeight: 800,
      fontSize: 66,
      uppercase: false,
      activeColor: '#FFFFFF',
      strokeWidth: 10,
      maxWordsPerLine: 4,
    },
  },
  {
    id: 'glow',
    label: 'Keyword glow',
    description: 'Key words glow in colour.',
    style: { ...base, animation: 'glow', activeColor: '#FFFFFF', keywordColor: '#22D3EE', fontFamily: 'Inter', fontWeight: 900, fontSize: 82 },
  },
  {
    id: 'emoji',
    label: 'Emoji',
    description: 'Emoji pop up above key words.',
    style: { ...base, animation: 'emoji', activeColor: '#F472B6', fontFamily: 'Poppins', fontWeight: 900, fontSize: 84 },
  },
  {
    id: 'classic',
    label: 'Classic',
    description: 'Calm two-line subtitles.',
    style: {
      ...base,
      animation: 'classic',
      fontFamily: 'Inter',
      fontWeight: 800,
      fontSize: 60,
      uppercase: false,
      strokeWidth: 0,
      shadow: false,
      boxColor: '#000000B3',
      maxWordsPerLine: 7,
      maxLines: 2,
      y: 0.74,
    },
  },
]

export function presetById(id: string): CaptionPreset {
  return CAPTION_PRESETS.find((p) => p.id === id) ?? CAPTION_PRESETS[0]!
}

export const DEFAULT_HOOK: Omit<HookSettings, 'text' | 'enabled'> = { style: 'banner', durationMs: 3000, y: 0.2 }

/** A fresh edit for a new clip: centred fill, the chosen caption preset, and the hook if Claude wrote one. */
export function defaultEdit(opts: { hook?: string | null; presetId?: string; emojis?: Record<string, string> } = {}): ClipEdit {
  const preset = presetById(opts.presetId ?? 'karaoke')
  return {
    layout: {
      mode: 'fill',
      auto: true,
      zoom: 1,
      keyframes: [{ t: 0, x: 0.5, y: 0.5 }],
      split: { top: { x: 0.25, y: 0.5, zoom: 1 }, bottom: { x: 0.75, y: 0.5, zoom: 1 } },
    },
    captions: { enabled: true, preset: preset.id, style: { ...preset.style } },
    hook: { enabled: !!opts.hook?.trim(), text: opts.hook?.trim() ?? '', ...DEFAULT_HOOK },
    trim: { cuts: [], removePauses: false, pauseMs: 700, removeFillers: false },
    emojis: { ...(opts.emojis ?? {}) },
  }
}
