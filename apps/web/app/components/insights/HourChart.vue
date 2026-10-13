<script setup lang="ts">
import type { HourBucket } from '@clipstudio/core/shared'

/**
 * Columns: how each hour of the day did, as a share of the account's usual views.
 * Hours inside the posting window are in the accent; the rest recede to gray (emphasis form, one series).
 */
const props = defineProps<{
  hours: HourBucket[]
  /** Minutes since midnight in the audience zone. */
  windowStart: number
  windowEnd: number
  zone: string
}>()

const root = ref<HTMLElement | null>(null)
const width = ref(720)
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(([entry]) => (width.value = Math.max(320, entry!.contentRect.width)))
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())

const height = 240
const m = { top: 14, right: 44, bottom: 26, left: 44 }
const plotW = computed(() => width.value - m.left - m.right)
const plotH = height - m.top - m.bottom
const band = computed(() => plotW.value / 24)
// Capped at 24 px and always leaving a 2 px surface gap between neighbours.
const barW = computed(() => Math.max(2, Math.min(24, band.value - 2)))

const maxScore = computed(() => Math.max(1.5, ...props.hours.map((h) => h.score ?? 0)) * 1.08)
const step = computed(() => (maxScore.value > 4 ? 1 : 0.5))
const ticks = computed(() => {
  const out: number[] = []
  for (let v = 0; v <= maxScore.value; v += step.value) out.push(Number(v.toFixed(2)))
  return out
})
const y = (v: number) => m.top + plotH - (v / maxScore.value) * plotH
const x = (hour: number) => m.left + hour * band.value + (band.value - barW.value) / 2

/** Rounded 4 px top, square at the baseline. */
function barPath(hour: number, score: number) {
  const x0 = x(hour)
  const w = barW.value
  const top = y(score)
  const base = y(0)
  const r = Math.min(4, w / 2, base - top)
  return `M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + w - r} Q${x0 + w},${top} ${x0 + w},${top + r} V${base} Z`
}

const inWindow = (hour: number) => hour * 60 + 59 >= props.windowStart && hour * 60 <= props.windowEnd
const pct = (v: number) => `${Math.round(v * 100)}%`
const clock = (h: number) => `${String(h).padStart(2, '0')}:00`

const hovered = ref<number | null>(null)
const tip = computed(() => {
  if (hovered.value === null) return null
  const h = props.hours[hovered.value]!
  const left = Math.min(Math.max(x(h.hour) + barW.value / 2, 90), width.value - 90)
  return { h, left, top: h.score === null ? y(0) - 8 : y(h.score) - 8 }
})
</script>

<template>
  <div ref="root" class="viz-root relative select-none">
    <svg :width="width" :height="height" role="img" :aria-label="`Views compared with usual, by hour of posting (${zone})`" class="block">
      <!-- Grid: hairlines at round percentages, the 100% line is "usual" -->
      <g>
        <template v-for="t in ticks" :key="t">
          <line :x1="m.left" :x2="width - m.right" :y1="y(t)" :y2="y(t)" :stroke="t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'" stroke-width="1" shape-rendering="crispEdges" />
          <text :x="m.left - 6" :y="y(t)" dy="0.32em" text-anchor="end" class="viz-tick">{{ pct(t) }}</text>
        </template>
        <line :x1="m.left" :x2="width - m.right" :y1="y(1)" :y2="y(1)" stroke="var(--viz-axis)" stroke-width="1" shape-rendering="crispEdges" />
        <text :x="width - m.right + 6" :y="y(1)" dy="0.32em" class="viz-tick">usual</text>
      </g>

      <!-- Bars -->
      <g>
        <template v-for="h in hours" :key="h.hour">
          <path
            v-if="h.score !== null"
            :d="barPath(h.hour, h.score)"
            :fill="inWindow(h.hour) ? 'var(--viz-accent)' : 'var(--viz-muted)'"
            :opacity="hovered === null || hovered === h.hour ? 1 : 0.55"
          />
        </template>
      </g>

      <!-- Hour labels every 3 hours -->
      <g>
        <text v-for="hr in [0, 3, 6, 9, 12, 15, 18, 21]" :key="hr" :x="m.left + hr * band + band / 2" :y="height - 8" text-anchor="middle" class="viz-tick">
          {{ clock(hr) }}
        </text>
      </g>

      <!-- Hit targets: the whole column, bigger than the bar -->
      <g>
        <rect
          v-for="h in hours"
          :key="h.hour"
          :x="m.left + h.hour * band"
          :y="m.top"
          :width="band"
          :height="plotH"
          fill="transparent"
          tabindex="0"
          class="outline-none"
          :aria-label="`${clock(h.hour)}: ${h.score === null ? 'no posts' : `${pct(h.score)} of usual from ${h.posts} posts`}`"
          @pointerenter="hovered = h.hour"
          @pointerleave="hovered = null"
          @focus="hovered = h.hour"
          @blur="hovered = null"
        />
      </g>
    </svg>

    <div
      v-if="tip"
      class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-default bg-default px-2.5 py-1.5 text-xs shadow-md"
      :style="{ left: `${tip.left}px`, top: `${tip.top}px` }"
    >
      <template v-if="tip.h.score !== null">
        <p class="text-sm font-semibold text-highlighted">{{ pct(tip.h.score) }} of usual</p>
        <p class="text-muted">{{ clock(tip.h.hour) }}–{{ clock((tip.h.hour + 1) % 24) }} {{ zone }}</p>
        <p class="text-muted">
          {{ tip.h.posts }} {{ tip.h.posts === 1 ? 'post' : 'posts' }} · median {{ Math.round(tip.h.medianViews ?? 0).toLocaleString() }} views
        </p>
      </template>
      <template v-else>
        <p class="font-medium text-highlighted">No posts yet</p>
        <p class="text-muted">{{ clock(tip.h.hour) }}–{{ clock((tip.h.hour + 1) % 24) }} {{ zone }}</p>
      </template>
    </div>

    <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span class="flex items-center gap-1.5"><span class="inline-block size-2.5 rounded-sm" style="background: var(--viz-accent)" />Inside your posting window</span>
      <span class="flex items-center gap-1.5"><span class="inline-block size-2.5 rounded-sm" style="background: var(--viz-muted)" />Other hours</span>
    </div>
  </div>
</template>

<style>
/* Chart tokens (unscoped so the dark class on <html> can reach them). */
.viz-root {
  --viz-accent: #2a78d6;
  --viz-muted: #a8a7a0;
  --viz-grid: #e9e8e3;
  --viz-axis: #c3c2b7;
  --viz-tick: #898781;
}
html.dark .viz-root {
  --viz-accent: #3987e5;
  --viz-muted: #6b6a66;
  --viz-grid: #2c2c2a;
  --viz-axis: #45453f;
  --viz-tick: #898781;
}
.viz-root .viz-tick {
  fill: var(--viz-tick);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
</style>
