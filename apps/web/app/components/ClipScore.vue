<script setup lang="ts">
import {
  MUTE_TEST_LABELS,
  PILLARS,
  evaluationState,
  formatTimecode,
  lengthAdvice,
  verdict,
  type ClipEvaluation,
} from '@clipstudio/core/shared'

/**
 * A clip's 4-pillar evaluation: the weighted total, one meter per pillar, the notes, and the suggested trim.
 * Compact shows the total and meters with the notes folded away (Inbox); full shows everything (editor).
 */
const props = withDefaults(
  defineProps<{
    evaluation: ClipEvaluation
    range: { startMs: number; endMs: number }
    compact?: boolean
    /** Show the "Apply trim" button (the parent applies it). */
    canApply?: boolean
    applying?: boolean
  }>(),
  { compact: false, canApply: false, applying: false },
)
const emit = defineEmits<{ applyTrim: [] }>()

const e = computed(() => props.evaluation)
const v = computed(() => verdict(e.value.total))
const state = computed(() => evaluationState(e.value, props.range))
const open = ref(!props.compact)
const sec = (ms: number) => (ms / 1000).toFixed(1)
const tc = (ms: number) => formatTimecode(ms / 1000)

const trim = computed(() => {
  const s = e.value.suggestedStartMs
  const end = e.value.suggestedEndMs
  if (s === null || end === null || state.value === 'trimmed') return null
  const ds = s - e.value.evaluatedStartMs
  const de = end - e.value.evaluatedEndMs
  const parts = [
    Math.abs(ds) >= 300 ? `${ds > 0 ? 'cut' : 'add'} ${sec(Math.abs(ds))} s at the start` : '',
    Math.abs(de) >= 300 ? `${de < 0 ? 'cut' : 'add'} ${sec(Math.abs(de))} s at the end` : '',
  ].filter(Boolean)
  return { range: `${tc(s)}–${tc(end)}`, length: end - s, change: parts.join(', ') }
})
/** "claude-code" → "Claude Code"; in-app labels are already readable. */
const byLabel = computed(() => {
  const by = e.value.by ?? 'Claude'
  return /^[a-z0-9_-]+$/.test(by) ? by.replace(/[-_]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()) : by
})
const muteIcon = computed(() => ({ pass: 'i-lucide-volume-x', weak: 'i-lucide-volume-1', fail: 'i-lucide-volume-2' })[e.value.muteTest])
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p class="text-2xl font-semibold text-highlighted">
        {{ e.total.toFixed(1) }}<span class="text-sm font-normal text-muted">/10</span>
      </p>
      <UBadge :label="v.label" :icon="v.icon" :color="v.tone" variant="subtle" size="sm" />
      <UBadge :label="MUTE_TEST_LABELS[e.muteTest]" :icon="muteIcon" color="neutral" variant="outline" size="sm" />
      <UBadge v-if="state === 'stale'" label="Clip changed since" icon="i-lucide-history" color="neutral" variant="subtle" size="sm" />
      <UBadge v-else-if="state === 'trimmed'" label="Suggested trim applied" icon="i-lucide-check" color="success" variant="subtle" size="sm" />
    </div>

    <!-- One meter per pillar: same-hue track, value in text beside it -->
    <div class="grid grid-cols-2 gap-x-4 gap-y-2" :class="compact ? 'sm:grid-cols-4' : ''">
      <div v-for="p in PILLARS" :key="p.key" :title="p.question">
        <div class="flex items-baseline justify-between text-xs">
          <span class="text-muted">{{ p.label }} <span class="text-dimmed">{{ Math.round(p.weight * 100) }}%</span></span>
          <span class="font-medium text-default tabular-nums">{{ e[p.key] }}</span>
        </div>
        <div class="mt-1 h-1.5 rounded-full bg-primary/15">
          <div class="h-full rounded-full bg-primary" :style="{ width: `${e[p.key] * 10}%` }" />
        </div>
      </div>
    </div>

    <div v-if="trim" class="flex flex-wrap items-center gap-2 rounded-md border border-default p-2.5 text-sm">
      <UIcon name="i-lucide-scissors" class="size-4 shrink-0 text-primary" />
      <div class="min-w-0 flex-1">
        <p>
          <span class="font-medium">Suggested trim:</span> <span class="tabular-nums">{{ trim.range }}</span>
          <span class="text-muted"> ({{ trim.change }}; {{ sec(trim.length) }} s, {{ lengthAdvice(trim.length).text.toLowerCase() }})</span>
        </p>
        <p v-if="e.trimNotes" class="text-xs text-muted">{{ e.trimNotes }}</p>
      </div>
      <UButton v-if="canApply" label="Apply trim" size="xs" color="neutral" variant="outline" :loading="applying" @click.stop="emit('applyTrim')" />
    </div>

    <UButton
      v-if="compact"
      :label="open ? 'Hide notes' : 'Why this score'"
      :trailing-icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
      color="neutral"
      variant="link"
      size="xs"
      class="p-0"
      @click.stop="open = !open"
    />
    <dl v-if="open" class="space-y-2 text-sm">
      <div>
        <dt class="text-xs font-medium text-muted">Hook (first 3 s)</dt>
        <dd>{{ e.hookNotes }}</dd>
      </div>
      <div v-if="e.retentionRisk">
        <dt class="text-xs font-medium text-muted">Retention risk</dt>
        <dd>{{ e.retentionRisk }}</dd>
      </div>
      <div v-if="e.payoffNotes">
        <dt class="text-xs font-medium text-muted">Payoff</dt>
        <dd>{{ e.payoffNotes }}</dd>
      </div>
      <div v-if="e.muteNotes">
        <dt class="text-xs font-medium text-muted">Mute test</dt>
        <dd>{{ e.muteNotes }}</dd>
      </div>
      <p class="text-xs text-dimmed">Evaluated by {{ byLabel }} · {{ new Date(e.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) }}</p>
    </dl>
  </div>
</template>
