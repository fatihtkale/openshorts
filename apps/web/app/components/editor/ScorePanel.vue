<script setup lang="ts">
import { lengthAdvice, PILLARS } from '@clipstudio/core/shared'
import type { ClipEditor } from '~/composables/useClipEditor'

/** The clip's 4-pillar evaluation, its length against the 22–45 s sweet spot, and ways to (re-)evaluate it. */
const props = defineProps<{ editor: ClipEditor }>()
const toast = useToast()

const draft = computed(() => props.editor.draft.value!)
const clip = computed(() => props.editor.data.value?.clip)
const project = computed(() => props.editor.data.value?.project)
const evaluation = computed(() => clip.value?.evaluation ?? null)
const length = computed(() => draft.value.endMs - draft.value.startMs)
const advice = computed(() => lengthAdvice(length.value))
const evaluator = ref<{ usable: boolean } | null>(null)

function applyTrim() {
  const e = evaluation.value
  if (!e || e.suggestedStartMs === null || e.suggestedEndMs === null) return
  props.editor.update((d) => {
    d.startMs = e.suggestedStartMs!
    d.endMs = e.suggestedEndMs!
  })
  toast.add({ title: 'Trim applied', description: 'Undo with ⌘Z.', icon: 'i-lucide-scissors' })
}

const prompt = computed(() => `Evaluate the clip “${clip.value?.title}” in my Clip Studio project “${project.value?.name}” and save the evaluation`)
async function copyPrompt() {
  await navigator.clipboard.writeText(prompt.value)
  toast.add({ title: 'Copied', description: 'Paste it into Claude.', icon: 'i-lucide-clipboard-check' })
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center gap-2 text-sm">
      <UIcon
        :name="advice.tone === 'good' ? 'i-lucide-circle-check' : advice.tone === 'warn' ? 'i-lucide-triangle-alert' : 'i-lucide-info'"
        class="size-4 shrink-0"
        :class="advice.tone === 'good' ? 'text-success' : advice.tone === 'warn' ? 'text-warning' : 'text-muted'"
      />
      <span><span class="font-medium tabular-nums">{{ (length / 1000).toFixed(1)  }} s</span> · {{ advice.text }}</span>
    </div>

    <ClipScore v-if="evaluation" :evaluation="evaluation" :range="draft" can-apply @apply-trim="applyTrim" />
    <div v-else class="space-y-2 rounded-lg border border-dashed border-default p-4 text-sm">
      <p class="font-medium">Not evaluated yet</p>
      <ul class="space-y-1 text-muted">
        <li v-for="p in PILLARS" :key="p.key">
          <span class="text-default">{{ p.label }}</span> ({{ Math.round(p.weight * 100) }}%): {{ p.question }}
        </li>
      </ul>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <EvaluateButton
        v-if="clip && project"
        ref="evaluator"
        :project-id="project.id"
        :clip-ids="[clip.id]"
        :label="evaluation ? 'Evaluate again' : 'Evaluate with AI'"
        :disabled="editor.saveState.value !== 'saved'"
        @done="editor.refresh()"
      />
      <span v-if="evaluator?.usable && editor.saveState.value !== 'saved'" class="text-xs text-muted">Waiting for your changes to save…</span>
    </div>
    <div v-if="!evaluator?.usable" class="space-y-2 text-sm">
      <p class="text-muted">Ask Claude to evaluate it (or turn on in-app AI in <ULink to="/settings" class="text-primary">Settings</ULink>):</p>
      <div class="flex items-center gap-2 rounded-md border border-default p-2">
        <UIcon name="i-lucide-sparkles" class="size-4 shrink-0 text-primary" />
        <span class="flex-1">“{{ prompt }}”</span>
        <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs" aria-label="Copy prompt" @click="copyPrompt" />
      </div>
    </div>
  </div>
</template>
