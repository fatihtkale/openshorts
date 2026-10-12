// Re-exports from the caption engine used across the editor, plus small formatting helpers.
export {
  centreAt,
  fillRect,
  outputToSource,
  panelRect,
  type LayoutMode,
  type Rect,
} from '@clipstudio/captions'

/** 12_345 → "0:12.3" */
export function formatTimecodeMs(ms: number): string {
  const s = Math.max(0, ms) / 1000
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`
}
