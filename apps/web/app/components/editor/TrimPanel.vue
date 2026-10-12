<script setup lang="ts">
import { formatTimecode } from '@clipstudio/core/shared'
import type { ClipEditor } from '~/composables/useClipEditor'

/**
 * Trimming by text: words inside the clip can be cut (click), words around it extend the clip (click),
 * and pauses or filler words can be removed automatically.
 */
const props = defineProps<{ editor: ClipEditor }>()

const draft = computed(() => props.editor.draft.value!)
const trim = computed(() => draft.value.edit.trim)
const words = computed(() => props.editor.words.value)
const original = computed(() => draft.value.endMs - draft.value.startMs)

const removePauses = computed({
  get: () => trim.value.removePauses,
  set: (v: boolean) => props.editor.update((d) => (d.edit.trim.removePauses = v)),
})
const pauseMs = computed({
  get: () => trim.value.pauseMs,
  set: (v: number) => props.editor.update((d) => (d.edit.trim.pauseMs = v), 'trim-pause'),
})
const removeFillers = computed({
  get: () => trim.value.removeFillers,
  set: (v: boolean) => props.editor.update((d) => (d.edit.trim.removeFillers = v)),
})

type Place = 'before' | 'inside' | 'after'
function place(i: number): Place {
  const w = words.value[i]!
  if (w.end <= draft.value.startMs) return 'before'
  if (w.start >= draft.value.endMs) return 'after'
  return 'inside'
}

/** A word counts as cut when most of it falls in a cut range. */
function isCut(i: number) {
  const w = words.value[i]!
  return props.editor.cuts.value.some((c) => Math.min(c.end, w.end) - Math.max(c.start, w.start) > (w.end - w.start) / 2)
}
function isManualCut(i: number) {
  const w = words.value[i]!
  return trim.value.cuts.some((c) => c.start <= w.start + 5 && c.end >= w.end - 5)
}

function click(i: number) {
  const w = words.value[i]!
  const where = place(i)
  if (where === 'before') {
    props.editor.update((d) => (d.startMs = Math.max(0, w.start - 100)))
    return
  }
  if (where === 'after') {
    props.editor.update((d) => (d.endMs = w.end + 250))
    return
  }
  const next = words.value[i + 1]
  const range = { start: w.start, end: next && next.start < draft.value.endMs ? next.start : w.end }
  props.editor.update((d) => {
    const cuts = d.edit.trim.cuts
    const existing = cuts.findIndex((c) => c.start <= w.start + 5 && c.end >= w.end - 5)
    if (existing >= 0) cuts.splice(existing, 1)
    else cuts.push(range)
  })
}

function nudge(edge: 'startMs' | 'endMs', ms: number) {
  props.editor.update((d) => (d[edge] = Math.max(0, d[edge] + ms)), `nudge-${edge}`)
}

function clearCuts() {
  props.editor.update((d) => {
    d.edit.trim.cuts = []
    d.edit.trim.removePauses = false
    d.edit.trim.removeFillers = false
  })
}

const scroller = ref<HTMLElement>()
onMounted(() => nextTick(() => scroller.value?.querySelector('[data-inside]')?.scrollIntoView({ block: 'center' })))
</script>

<template>
  <div class="space-y-5">
    <div class="rounded-lg bg-elevated p-3 text-sm">
      <p>
        <span class="font-medium">{{ formatTimecode(editor.duration.value / 1000) }}</span>
        <span class="text-muted"> long</span>
        <template v-if="editor.duration.value < original - 50">
          <span class="text-muted"> · {{ ((original - editor.duration.value) / 1000).toFixed(1) }} s cut from {{ formatTimecode(original / 1000) }}</span>
        </template>
      </p>
      <div class="mt-2 grid grid-cols-2 gap-2">
        <div class="flex items-center gap-1">
          <span class="w-10 text-xs text-muted">Start</span>
          <UButton icon="i-lucide-chevron-left" color="neutral" variant="outline" size="xs" aria-label="Start earlier" @click="nudge('startMs', -200)" />
          <span class="w-12 text-center text-xs tabular-nums">{{ formatTimecodeMs(draft.startMs) }}</span>
          <UButton icon="i-lucide-chevron-right" color="neutral" variant="outline" size="xs" aria-label="Start later" @click="nudge('startMs', 200)" />
        </div>
        <div class="flex items-center gap-1">
          <span class="w-10 text-xs text-muted">End</span>
          <UButton icon="i-lucide-chevron-left" color="neutral" variant="outline" size="xs" aria-label="End earlier" @click="nudge('endMs', -200)" />
          <span class="w-12 text-center text-xs tabular-nums">{{ formatTimecodeMs(draft.endMs) }}</span>
          <UButton icon="i-lucide-chevron-right" color="neutral" variant="outline" size="xs" aria-label="End later" @click="nudge('endMs', 200)" />
        </div>
      </div>
    </div>

    <div class="space-y-3">
      <USwitch v-model="removePauses" label="Shorten pauses" description="Tightens silences between sentences." />
      <UFormField v-if="removePauses" :label="`Pauses longer than ${(pauseMs / 1000).toFixed(1)} s`" class="pl-11">
        <USlider v-model="pauseMs" :min="400" :max="2000" :step="50" />
      </UFormField>
      <USwitch v-model="removeFillers" label="Remove filler words" description="Cuts “um”, “uh”, “erm” and the like." />
    </div>

    <div>
      <div class="mb-2 flex items-center justify-between">
        <p class="text-sm font-medium">Words</p>
        <UButton v-if="trim.cuts.length || removePauses || removeFillers" label="Undo all cuts" color="neutral" variant="ghost" size="xs" @click="clearCuts" />
      </div>
      <p class="mb-2 text-xs text-muted">Click a word to cut it (or bring it back). Click a grey word to extend the clip to it.</p>
      <div ref="scroller" class="max-h-80 overflow-y-auto rounded-lg border border-default p-3 text-[15px] leading-8">
        <p v-if="!words.length" class="text-sm text-muted">No transcript for this video, so trimming by words isn't available.</p>
        <template v-for="(w, i) in words" :key="i">
          <button
            type="button"
            :data-inside="place(i) === 'inside' ? '' : undefined"
            class="rounded px-0.5 transition"
            :class="{
              'text-dimmed hover:bg-elevated hover:text-muted': place(i) !== 'inside',
              'hover:bg-elevated': place(i) === 'inside' && !isCut(i),
              'text-error line-through decoration-2 hover:bg-error/10': place(i) === 'inside' && isCut(i),
              'opacity-70': place(i) === 'inside' && isCut(i) && !isManualCut(i),
            }"
            :title="place(i) === 'before' ? 'Start the clip here' : place(i) === 'after' ? 'End the clip here' : isCut(i) ? (isManualCut(i) ? 'Bring back' : 'Removed automatically') : 'Cut this word'"
            @click="click(i)"
          >{{ w.text }}</button>{{ ' ' }}
        </template>
      </div>
    </div>
  </div>
</template>
