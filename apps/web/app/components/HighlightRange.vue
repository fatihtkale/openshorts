<script setup lang="ts">
import { CLIP_MAX_MS, CLIP_MIN_MS, formatTimecode, lengthAdvice, parseTimecode, type HighlightClip } from '@clipstudio/core/shared'

/**
 * A zoomed-in view of one stretch of the video, one bar per second, for picking a clip's exact start and end:
 * drag either handle, drag the middle to move the whole range, drag on empty space for a new range, or type times.
 * With the scissors on, the view zooms in on the clip and dragging marks parts to leave out; nothing is cut automatically.
 * Times are seconds on the project's timeline.
 */
const props = defineProps<{
  curve: number[]
  duration: number
  viewerClips: HighlightClip[]
}>()
const range = defineModel<{ start: number; end: number }>({ required: true })
/** Parts the user marked to leave out (seconds), e.g. a pause in the middle. */
const cuts = defineModel<{ start: number; end: number }[]>('cuts', { default: () => [] })
const emit = defineEmits<{ play: [startMs: number, endMs: number, cuts: { start: number; end: number }[]] }>()

const MIN = CLIP_MIN_MS / 1000
const MAX = CLIP_MAX_MS / 1000

// The visible window: the range plus some room either side. Held still while dragging, so the handles don't run away.
const view = ref({ start: 0, end: 1 })
/** Scissors on: dragging inside the clip marks a part to leave out instead of moving the clip. */
const cutting = ref(false)
function frame() {
  const len = range.value.end - range.value.start
  // Cutting needs precision, so the view hugs the clip; otherwise there's room to move it around.
  const pad = cutting.value ? 1 : Math.max(15, len * 0.6)
  view.value = { start: Math.max(0, range.value.start - pad), end: Math.min(props.duration, range.value.end + pad) }
}
let dragging = false
watch(
  () => [range.value.start, range.value.end],
  ([s, e]) => {
    if (dragging) return
    if (s! < view.value.start || e! > view.value.end || e! - s! < (view.value.end - view.value.start) * 0.15) frame()
  },
  { immediate: true },
)
watch(cutting, frame)

const viewLen = computed(() => Math.max(1, view.value.end - view.value.start))
const bars = computed(() => {
  const out: { t: number; v: number }[] = []
  for (let t = Math.floor(view.value.start); t < Math.ceil(view.value.end); t++) out.push({ t, v: props.curve[t] ?? 0 })
  return out
})
const pct = (sec: number) => ((sec - view.value.start) / viewLen.value) * 100
const clipsInView = computed(() =>
  props.viewerClips.filter((c) => c.startSec < view.value.end && c.startSec + c.durationSec > view.value.start).slice(0, 12),
)

// ── Dragging ─────────────────────────────────────────────────────────
const box = ref<HTMLElement | null>(null)
let mode: 'start' | 'end' | 'move' | 'new' | 'cut' | 'cutEdge' | null = null
let edge: { index: number; side: 'start' | 'end' } | null = null
const pendingCut = ref<{ start: number; end: number } | null>(null)
let anchor = 0
let grabOffset = 0
const round = (s: number) => Math.round(s * 10) / 10
function secAt(e: PointerEvent): number {
  const r = box.value!.getBoundingClientRect()
  return view.value.start + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * viewLen.value
}
function set(start: number, end: number) {
  start = Math.max(0, start)
  end = Math.min(props.duration, end)
  if (end - start < MIN) return
  if (end - start > MAX) end = start + MAX
  range.value = { start: round(start), end: round(end) }
}
function down(e: PointerEvent, which: 'start' | 'end' | 'move' | 'new') {
  dragging = true
  mode = cutting.value && (which === 'move' || which === 'new') ? 'cut' : which
  const t = secAt(e)
  anchor = t
  grabOffset = t - range.value.start
  box.value!.setPointerCapture(e.pointerId)
}
function downEdge(e: PointerEvent, index: number, side: 'start' | 'end') {
  dragging = true
  mode = 'cutEdge'
  edge = { index, side }
  box.value!.setPointerCapture(e.pointerId)
}
function move(e: PointerEvent) {
  if (!mode) return
  const t = secAt(e)
  const { start, end } = range.value
  if (mode === 'start') set(Math.min(t, end - MIN), end)
  else if (mode === 'end') set(start, Math.max(t, start + MIN))
  else if (mode === 'move') {
    const len = end - start
    const s = Math.min(Math.max(0, t - grabOffset), props.duration - len)
    range.value = { start: round(s), end: round(s + len) }
  } else if (mode === 'cut') {
    const a = Math.max(range.value.start, Math.min(t, anchor))
    const z = Math.min(range.value.end, Math.max(t, anchor))
    pendingCut.value = z - a >= 0.3 ? { start: round(a), end: round(z) } : null
  } else if (mode === 'cutEdge' && edge) {
    // Between the clip's edges and the neighbouring cuts, and never shorter than 0.3 s.
    const list = cuts.value.map((c) => ({ ...c }))
    const c = list[edge.index]!
    if (edge.side === 'start') c.start = round(Math.min(c.end - 0.3, Math.max(t, list[edge.index - 1]?.end ?? range.value.start)))
    else c.end = round(Math.max(c.start + 0.3, Math.min(t, list[edge.index + 1]?.start ?? range.value.end)))
    if (range.value.end - range.value.start - list.reduce((n, x) => n + x.end - x.start, 0) >= MIN) cuts.value = list
  } else if (Math.abs(t - anchor) >= MIN) set(Math.min(t, anchor), Math.max(t, anchor))
}
function up() {
  if (mode === 'cut' && pendingCut.value) addCuts([pendingCut.value])
  pendingCut.value = null
  edge = null
  mode = null
  dragging = false
}

// ── Cuts ─────────────────────────────────────────────────────────────
/** Adds cuts, merging overlaps; refuses if less than the minimum clip length would be left. */
function addCuts(extra: { start: number; end: number }[]) {
  const all = [...cuts.value, ...extra].sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const c of all) {
    const last = merged.at(-1)
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end)
    else merged.push({ ...c })
  }
  if (range.value.end - range.value.start - merged.reduce((n, c) => n + c.end - c.start, 0) < MIN) return
  cuts.value = merged
}
function removeCut(i: number) {
  cuts.value = cuts.value.filter((_, k) => k !== i)
}
// Cuts follow the clip: when its edges move, cuts outside it are dropped and the rest trimmed to fit.
watch(
  () => [range.value.start, range.value.end],
  () => {
    const next = cuts.value
      .map((c) => ({ start: Math.max(c.start, range.value.start), end: Math.min(c.end, range.value.end) }))
      .filter((c) => c.end - c.start >= 0.3)
    if (next.length !== cuts.value.length || next.some((c, i) => c.start !== cuts.value[i]!.start || c.end !== cuts.value[i]!.end)) cuts.value = next
  },
)
const cutTotal = computed(() => cuts.value.reduce((n, c) => n + c.end - c.start, 0))

// ── Typing and nudging ───────────────────────────────────────────────
const fmt = (s: number) => {
  const tenth = Math.round((s % 1) * 10)
  return formatTimecode(Math.floor(s)) + (tenth && tenth < 10 ? `.${tenth}` : '')
}
const startText = ref('')
const endText = ref('')
watch(
  range,
  (r) => {
    startText.value = fmt(r.start)
    endText.value = fmt(r.end)
  },
  { immediate: true, deep: true },
)
function typed(which: 'start' | 'end') {
  const v = parseTimecode(which === 'start' ? startText.value : endText.value)
  if (v === null) {
    startText.value = fmt(range.value.start)
    endText.value = fmt(range.value.end)
    return
  }
  if (which === 'start') set(v, Math.max(range.value.end, v + MIN))
  else set(Math.min(range.value.start, v - MIN), v)
  frame()
}
function nudge(which: 'start' | 'end', d: number) {
  if (which === 'start') set(range.value.start + d, range.value.end)
  else set(range.value.start, range.value.end + d)
}
const length = computed(() => range.value.end - range.value.start - cutTotal.value)
const advice = computed(() => lengthAdvice(length.value * 1000))
const ms = (list: { start: number; end: number }[]) => list.map((c) => ({ start: c.start * 1000, end: c.end * 1000 }))
/** Plays a few seconds either side of a cut, skipping it, to hear whether the jump sounds right. */
function playJump(c: { start: number; end: number }) {
  emit('play', Math.max(range.value.start, c.start - 3) * 1000, Math.min(range.value.end, c.end + 3) * 1000, ms(cuts.value))
}
</script>

<template>
  <div class="space-y-3">
    <!-- Zoomed bars with the selection and its handles -->
    <div
      ref="box"
      class="relative h-24 cursor-crosshair touch-none rounded-md bg-elevated/40 select-none"
      @pointerdown.self="down($event, 'new')"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
    >
      <div class="pointer-events-none absolute inset-x-0 top-1 bottom-5 flex items-end gap-px px-px">
        <span
          v-for="b in bars"
          :key="b.t"
          class="flex-1 rounded-t-[2px]"
          :class="b.t >= range.start - 0.5 && b.t < range.end ? 'bg-primary' : 'bg-primary/30'"
          :style="{ height: `${Math.max(3, b.v * 100)}%` }"
        />
      </div>
      <!-- What viewers clipped, as thin lanes under the bars -->
      <div class="pointer-events-none absolute inset-x-0 bottom-1 h-3">
        <span
          v-for="(c, i) in clipsInView"
          :key="i"
          class="absolute h-1 rounded-full bg-success"
          :style="{ left: `${Math.max(0, pct(c.startSec))}%`, width: `${Math.min(100, pct(c.startSec + c.durationSec)) - Math.max(0, pct(c.startSec))}%`, bottom: `${(i % 3) * 4}px` }"
          :title="`${c.title} · ${c.views.toLocaleString()} views`"
        />
      </div>
      <!-- Selection: drag the middle to move, the edges to resize -->
      <div
        class="absolute inset-y-0 border-y-2 border-primary/60 bg-primary/10"
        :class="cutting ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'"
        :style="{ left: `${pct(range.start)}%`, width: `${pct(range.end) - pct(range.start)}%` }"
        @pointerdown.stop="down($event, 'move')"
      />
      <!-- Cut-out parts: striped. With the scissors on, drag an edge to adjust; × keeps the part after all. -->
      <div
        v-for="(c, i) in cuts"
        :key="`cut-${i}`"
        class="cut pointer-events-none absolute inset-y-0 z-[5] border-x border-error/70"
        :style="{ left: `${pct(c.start)}%`, width: `${pct(c.end) - pct(c.start)}%` }"
      >
        <template v-if="cutting">
          <span
            v-for="side in (['start', 'end'] as const)"
            :key="side"
            class="pointer-events-auto absolute inset-y-0 w-3 cursor-ew-resize"
            :class="side === 'start' ? '-left-1.5' : '-right-1.5'"
            :title="`Drag to move where the cut ${side === 'start' ? 'starts' : 'ends'}`"
            @pointerdown.stop="downEdge($event, i, side)"
          />
        </template>
        <button
          type="button"
          class="pointer-events-auto absolute top-0.5 left-1/2 flex size-4 -translate-x-1/2 items-center justify-center rounded-full bg-error text-[10px] leading-none text-inverted"
          :title="`Keep ${fmt(c.start)}–${fmt(c.end)}`"
          :aria-label="`Keep ${fmt(c.start)} to ${fmt(c.end)}`"
          @pointerdown.stop
          @click.stop="removeCut(i)"
        >
          ×
        </button>
      </div>
      <span
        v-if="pendingCut"
        class="cut pointer-events-none absolute inset-y-0 z-[5] opacity-70"
        :style="{ left: `${pct(pendingCut.start)}%`, width: `${pct(pendingCut.end) - pct(pendingCut.start)}%` }"
      />
      <button
        v-for="which in (['start', 'end'] as const)"
        :key="which"
        type="button"
        class="absolute inset-y-0 z-10 flex w-4 -translate-x-1/2 cursor-ew-resize items-center justify-center"
        :style="{ left: `${pct(which === 'start' ? range.start : range.end)}%` }"
        :aria-label="which === 'start' ? 'Drag the start' : 'Drag the end'"
        @pointerdown.stop="down($event, which)"
      >
        <span class="h-full w-1 rounded-full bg-primary" />
        <span class="absolute h-6 w-2.5 rounded-sm border border-default bg-primary" />
      </button>
    </div>
    <div class="flex justify-between text-xs text-dimmed tabular-nums">
      <span>{{ fmt(view.start) }}</span>
      <span>{{ fmt((view.start + view.end) / 2) }}</span>
      <span>{{ fmt(view.end) }}</span>
    </div>

    <!-- Cutting out parts by hand -->
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        :label="cutting ? 'Done cutting' : 'Cut out a part'"
        :icon="cutting ? 'i-lucide-check' : 'i-lucide-scissors'"
        :color="cutting ? 'primary' : 'neutral'"
        :variant="cutting ? 'solid' : 'outline'"
        size="xs"
        @click="cutting = !cutting"
      />
      <span v-if="cutting" class="text-xs text-muted">Drag over the part to leave out. Drag a cut's edge to adjust it, × to keep it.</span>
      <template v-if="cuts.length">
        <UButton :label="`Keep everything`" color="neutral" variant="ghost" size="xs" @click="cuts = []" />
        <span v-if="!cutting" class="text-xs text-muted">{{ cutTotal.toFixed(1) }} s cut out</span>
      </template>
    </div>
    <ul v-if="cuts.length" class="flex flex-wrap gap-2">
      <li v-for="(c, i) in cuts" :key="`${c.start}-${c.end}`" class="flex items-center gap-1 rounded-md border border-error/40 py-0.5 pr-0.5 pl-2 text-xs tabular-nums">
        <UIcon name="i-lucide-scissors" class="size-3 text-error" />
        <span>{{ fmt(c.start) }}–{{ fmt(c.end) }}</span>
        <span class="text-muted">({{ (c.end - c.start).toFixed(1) }} s)</span>
        <UButton icon="i-lucide-play" color="neutral" variant="ghost" size="xs" :aria-label="`Hear the jump at ${fmt(c.start)}`" title="Hear the jump" @click="playJump(c)" />
        <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" :aria-label="`Keep ${fmt(c.start)} to ${fmt(c.end)}`" title="Keep this part" @click="removeCut(i)" />
      </li>
    </ul>

    <!-- Exact times -->
    <div class="flex flex-wrap items-end gap-3">
      <UFormField v-for="which in (['start', 'end'] as const)" :key="which" :label="which === 'start' ? 'Start' : 'End'" size="sm">
        <div class="flex items-center gap-1">
          <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="xs" :aria-label="`${which} 0.5 s earlier`" @click="nudge(which, -0.5)" />
          <UInput
            v-if="which === 'start'"
            v-model="startText"
            class="w-24 tabular-nums"
            @blur="typed('start')"
            @keydown.enter="typed('start')"
          />
          <UInput v-else v-model="endText" class="w-24 tabular-nums" @blur="typed('end')" @keydown.enter="typed('end')" />
          <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" size="xs" :aria-label="`${which} 0.5 s later`" @click="nudge(which, 0.5)" />
        </div>
      </UFormField>
      <p class="pb-1.5 text-sm">
        <span class="font-medium tabular-nums">{{ length.toFixed(1) }} s</span>
        <span v-if="cuts.length" class="text-muted"> after cuts</span>
        <span :class="advice.tone === 'warn' ? 'text-warning' : 'text-muted'"> · {{ advice.text }}</span>
      </p>
      <UButton
        label="Play selection"
        icon="i-lucide-play"
        color="neutral"
        variant="outline"
        size="sm"
        class="ml-auto"
        @click="emit('play', range.start * 1000, range.end * 1000, ms(cuts))"
      />
    </div>
  </div>
</template>

<style scoped>
/* Parts left out: diagonal stripes in the error colour, over the bars. */
.cut {
  background: repeating-linear-gradient(135deg, color-mix(in oklab, var(--ui-error) 45%, transparent) 0 4px, transparent 4px 8px);
}
</style>
