/**
 * Caption fonts, bundled from Fontsource (all SIL Open Font License). The browser loads them through
 * Fontsource's CSS; the exporter registers the same files with the Node canvas, so text measures alike.
 */
export interface CaptionFont {
  family: string
  label: string
  /** Weights shipped (and offered) for this family. */
  weights: number[]
  /** Fontsource package, e.g. "montserrat". */
  pkg: string
}

export const CAPTION_FONTS: CaptionFont[] = [
  { family: 'Montserrat', label: 'Montserrat', weights: [800, 900], pkg: 'montserrat' },
  { family: 'Poppins', label: 'Poppins', weights: [700, 800, 900], pkg: 'poppins' },
  { family: 'Bebas Neue', label: 'Bebas Neue', weights: [400], pkg: 'bebas-neue' },
  { family: 'Anton', label: 'Anton', weights: [400], pkg: 'anton' },
  { family: 'Inter', label: 'Inter', weights: [700, 800, 900], pkg: 'inter' },
  { family: 'JetBrains Mono', label: 'JetBrains Mono', weights: [700, 800], pkg: 'jetbrains-mono' },
]

/** Font files as paths inside the Fontsource packages (latin and latin-ext subsets). */
export function fontFiles(): { family: string; weight: number; path: string }[] {
  return CAPTION_FONTS.flatMap((f) =>
    f.weights.flatMap((weight) =>
      ['latin', 'latin-ext'].map((subset) => ({
        family: f.family,
        weight,
        path: `@fontsource/${f.pkg}/files/${f.pkg}-${subset}-${weight}-normal.woff2`,
      })),
    ),
  )
}

/** A CSS font shorthand. Family names are quoted so ones with spaces work. */
export function fontString(weight: number, sizePx: number, family: string): string {
  return `${weight} ${Math.round(sizePx * 100) / 100}px "${family}", "Apple Color Emoji", sans-serif`
}

/** The nearest weight this family ships, so the browser and the exporter never synthesise one. */
export function closestWeight(family: string, weight: number): number {
  const font = CAPTION_FONTS.find((f) => f.family === family)
  if (!font) return weight
  return font.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), font.weights[0]!)
}
