<script setup lang="ts">
import { languageName, TRANSCRIPT_LANGUAGES, type ProjectDto, type TranscriptSummary } from '@clipstudio/core/shared'

const props = defineProps<{ project: ProjectDto; modelLabel: string | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ started: [summary: TranscriptSummary] }>()
const toast = useToast()

const language = ref<string>('auto')
const busy = ref(false)
const again = computed(() => props.project.transcript?.status === 'ready' || props.project.transcript?.status === 'failed')

watch(open, (isOpen) => {
  if (isOpen) language.value = props.project.transcript?.requestedLanguage ?? 'auto'
})

const items = TRANSCRIPT_LANGUAGES.map((code) => ({ label: languageName(code), value: code as string }))

async function start() {
  busy.value = true
  try {
    const summary = await $fetch<TranscriptSummary>(`/api/projects/${props.project.id}/transcript`, {
      method: 'POST',
      body: { language: language.value },
    })
    emit('started', summary)
    open.value = false
  } catch (e) {
    toast.add({ title: 'Could not start transcribing', description: (e as Error).message, color: 'error' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="again ? 'Transcribe again?' : 'Transcribe this video'"
    :description="modelLabel ? `Runs on this Mac with ${modelLabel}.` : undefined"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Spoken language" help="Pick the language if detection gets it wrong.">
          <USelect v-model="language" :items="items" value-key="value" class="w-64" />
        </UFormField>
        <UAlert
          v-if="again && project.transcript?.edited"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Your corrections will be replaced"
          description="You fixed words in the current transcript. A new transcription starts from scratch."
        />
        <p v-else-if="again" class="text-sm text-muted">The current transcript stays until the new one is finished.</p>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
        <UButton :label="again ? 'Transcribe again' : 'Transcribe'" icon="i-lucide-audio-lines" :loading="busy" @click="start" />
      </div>
    </template>
  </UModal>
</template>
