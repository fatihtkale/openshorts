<script setup lang="ts">
import { CLAUDE_MODELS, estimateEvaluateCost, type AiSettingsDto } from '@clipstudio/core/shared'
import type { ButtonProps } from '@nuxt/ui'

/**
 * Starts an in-app AI evaluation of some clips after a confirm that names the model and the cost.
 * Renders nothing when in-app AI isn't set up (`usable` tells the parent, so it can offer Claude instead).
 */
const props = withDefaults(
  defineProps<{ projectId: string; clipIds: string[]; label?: string; size?: ButtonProps['size']; variant?: ButtonProps['variant']; disabled?: boolean }>(),
  { label: 'Evaluate with AI', size: 'sm', variant: 'outline', disabled: false },
)
const emit = defineEmits<{ done: [] }>()
const toast = useToast()

const { data: ai } = await useFetch<AiSettingsDto>('/api/settings/ai', { server: false })
const usable = computed(() => !!ai.value && ai.value.provider !== 'off' && (ai.value.provider !== 'anthropic' || ai.value.hasAnthropicKey || ai.value.envKey))
defineExpose({ usable })

const { active } = useJobs()
const running = computed(() => active.value.find((j) => j.type === 'clips.evaluate' && j.projectId === props.projectId))
const open = ref(false)
const starting = ref(false)
const n = computed(() => props.clipIds.length)
const modelLabel = computed(() =>
  ai.value?.provider === 'ollama' ? ai.value.ollamaModel || 'Ollama' : (CLAUDE_MODELS.find((m) => m.id === ai.value?.anthropicModel)?.label ?? 'Claude'),
)
const cost = computed(() => (ai.value?.provider === 'anthropic' ? estimateEvaluateCost(n.value, ai.value.anthropicModel) : 0))

async function start() {
  starting.value = true
  try {
    await $fetch(`/api/projects/${props.projectId}/evaluate-clips`, { method: 'POST', body: { clipIds: props.clipIds } })
    open.value = false
  } catch (e) {
    toast.add({ title: 'Could not start', description: (e as { statusMessage?: string }).statusMessage ?? (e as Error).message, color: 'error' })
  } finally {
    starting.value = false
  }
}

onJobStatusChange((job) => {
  if (job.type !== 'clips.evaluate' || job.projectId !== props.projectId) return
  if (job.status === 'succeeded') emit('done')
  else if (job.status === 'failed') toast.add({ title: 'Evaluation failed', description: job.error ?? undefined, color: 'error' })
})
</script>

<template>
  <template v-if="usable">
    <UButton
      :label="running ? 'Evaluating…' : label"
      icon="i-lucide-gauge"
      color="neutral"
      :size="size"
      :variant="variant"
      :loading="!!running"
      :disabled="!!running || disabled || !n"
      @click.stop="open = true"
    />
    <UModal
      v-model:open="open"
      :title="n === 1 ? 'Evaluate this clip?' : `Evaluate ${n} clips?`"
      :description="`${modelLabel} scores ${n === 1 ? 'it' : 'them'} on hook, pacing, payoff and standalone context, and may suggest a tighter trim. Nothing changes unless you apply it.`"
    >
      <template #body>
        <div class="flex items-start gap-2 rounded-md bg-elevated p-3 text-xs text-muted">
          <UIcon :name="ai?.provider === 'ollama' ? 'i-lucide-laptop' : 'i-lucide-cloud'" class="mt-0.5 size-4 shrink-0" />
          <p v-if="ai?.provider === 'ollama'">Runs on this Mac with Ollama, from the transcript only (no frames for the mute test).</p>
          <p v-else>
            The transcript around {{ n === 1 ? 'the clip' : 'each clip' }} and four frames per clip go to Anthropic. This costs
            {{ cost < 0.01 ? 'under $0.01' : `about $${cost.toFixed(2)}` }} on your API key.
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
          <UButton label="Evaluate" icon="i-lucide-gauge" :loading="starting" @click="start" />
        </div>
      </template>
    </UModal>
  </template>
</template>
