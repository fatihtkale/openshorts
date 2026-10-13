<script setup lang="ts">
import { CLAUDE_MODELS, estimateFindCost, type AiSettingsDto, type ProjectDto } from '@clipstudio/core/shared'
import type { ButtonProps } from '@nuxt/ui'

/**
 * "Find clips with AI": the in-app alternative to asking Claude through MCP. The run is confirmed first
 * (it sends the transcript to Anthropic or a local Ollama, and Claude costs money); the picks land in the Inbox.
 */
const props = withDefaults(defineProps<{ project: ProjectDto; size?: ButtonProps['size']; variant?: ButtonProps['variant'] }>(), {
  size: 'xs',
  variant: 'outline',
})
const toast = useToast()

const { data: ai } = await useFetch<AiSettingsDto>('/api/settings/ai', { server: false })
const { active } = useJobs()
const running = computed(() => active.value.find((j) => j.type === 'clips.find' && j.projectId === props.project.id))
const ready = computed(() => props.project.transcript?.status === 'ready')
const usable = computed(() => !!ai.value && ai.value.provider !== 'off' && (ai.value.provider !== 'anthropic' || ai.value.hasAnthropicKey || ai.value.envKey))

const open = ref(false)
const count = ref(8)
const focus = ref('')
const starting = ref(false)

const modelLabel = computed(() =>
  ai.value?.provider === 'ollama' ? ai.value.ollamaModel || 'Ollama' : (CLAUDE_MODELS.find((m) => m.id === ai.value?.anthropicModel)?.label ?? 'Claude'),
)
/** Words × ~6 characters (word plus space and timing marks). */
const cost = computed(() =>
  ai.value?.provider === 'anthropic' ? estimateFindCost((props.project.transcript?.wordCount ?? 0) * 6, ai.value.anthropicModel) : 0,
)
const costLabel = computed(() => (cost.value < 0.01 ? 'under $0.01' : `about $${cost.value.toFixed(2)}`))

async function start() {
  starting.value = true
  try {
    await $fetch(`/api/projects/${props.project.id}/find-clips`, { method: 'POST', body: { count: count.value, focus: focus.value || undefined } })
    open.value = false
    toast.add({ title: 'Looking for clips', description: 'Suggestions will wait in the Inbox for you.', icon: 'i-lucide-sparkles' })
  } catch (e) {
    toast.add({ title: 'Could not start', description: (e as { statusMessage?: string }).statusMessage ?? (e as Error).message, color: 'error' })
  } finally {
    starting.value = false
  }
}

onJobStatusChange((job) => {
  if (job.type !== 'clips.find' || job.projectId !== props.project.id) return
  if (job.status === 'succeeded') {
    toast.add({ title: 'New clip suggestions', description: 'They are waiting in the Inbox.', icon: 'i-lucide-inbox', actions: [{ label: 'Open Inbox', to: '/inbox' }] })
  } else if (job.status === 'failed') {
    toast.add({ title: 'Finding clips failed', description: job.error ?? undefined, color: 'error' })
  }
})
</script>

<template>
  <template v-if="usable && ready">
    <UButton
      :label="running ? 'Finding clips…' : 'Find clips with AI'"
      icon="i-lucide-sparkles"
      :size="size"
      :variant="variant"
      color="primary"
      :loading="!!running"
      :disabled="!!running"
      @click="open = true"
    />
    <UModal v-model:open="open" title="Find clips with AI?" :description="`${modelLabel} reads this video's transcript and suggests clips. Nothing is cut until you approve them in the Inbox.`">
      <template #body>
        <div class="space-y-4 text-sm">
          <UFormField :label="`Up to ${count} clips`">
            <USlider v-model="count" :min="1" :max="20" />
          </UFormField>
          <UFormField label="Anything to focus on?" hint="Optional">
            <UInput v-model="focus" placeholder="e.g. the funny moments, or the part about pricing" maxlength="300" class="w-full" />
          </UFormField>
          <div class="flex items-start gap-2 rounded-md bg-elevated p-3 text-xs text-muted">
            <UIcon :name="ai?.provider === 'ollama' ? 'i-lucide-laptop' : 'i-lucide-cloud'" class="mt-0.5 size-4 shrink-0" />
            <p v-if="ai?.provider === 'ollama'">Runs on this Mac with Ollama; nothing leaves it. Large transcripts can take a few minutes.</p>
            <p v-else>
              The transcript ({{ project.transcript?.wordCount.toLocaleString() }} words) is sent to Anthropic. This run costs {{ costLabel }} on
              your API key.
            </p>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
          <UButton label="Find clips" icon="i-lucide-sparkles" :loading="starting" @click="start" />
        </div>
      </template>
    </UModal>
  </template>
</template>
