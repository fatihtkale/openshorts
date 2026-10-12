<script setup lang="ts">
import type { ModelListItem } from '@clipstudio/core/shared'

const { data: models, refresh } = await useFetch<ModelListItem[]>('/api/models', { default: () => [], server: false })
const { byId, cancel } = useJobs()
const toast = useToast()

onJobStatusChange((job) => {
  if (job.type === 'models.download') void refresh()
})

const confirming = ref<ModelListItem | null>(null)
const removing = ref<ModelListItem | null>(null)
const busy = ref(false)
const confirmOpen = computed({ get: () => !!confirming.value, set: (v) => !v && (confirming.value = null) })
const removeOpen = computed({ get: () => !!removing.value, set: (v) => !v && (removing.value = null) })

const anyInstalled = computed(() => models.value.some((m) => m.installed))

async function call(url: string, method: 'POST' | 'DELETE', failure: string) {
  busy.value = true
  try {
    models.value = await $fetch<ModelListItem[]>(url, { method })
    return true
  } catch (e) {
    toast.add({ title: failure, description: (e as Error).message, color: 'error' })
    return false
  } finally {
    busy.value = false
  }
}

async function download() {
  const model = confirming.value
  if (model && (await call(`/api/models/${model.id}/download`, 'POST', 'Could not start the download'))) confirming.value = null
}
async function remove() {
  const model = removing.value
  if (model && (await call(`/api/models/${model.id}`, 'DELETE', 'Could not remove the model'))) removing.value = null
}
</script>

<template>
  <UCard :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <h2 class="font-semibold">Speech model</h2>
      <p class="text-sm text-muted">
        Transcription runs on this Mac with one of these Whisper models.
        <template v-if="!anyInstalled">Download one to start transcribing; new videos are then transcribed automatically.</template>
      </p>
    </template>
    <ul class="divide-y divide-default">
      <li v-for="model in models" :key="model.id" class="flex flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
        <UIcon
          :name="model.installed ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'"
          class="size-5 shrink-0"
          :class="model.installed ? 'text-success' : 'text-muted'"
        />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-highlighted">
            {{ model.label }}
            <span class="ml-1 font-normal text-muted">{{ formatBytes(model.bytes) }}</span>
            <UBadge v-if="model.recommended" label="Recommended" color="primary" variant="subtle" size="sm" class="ml-2" />
            <UBadge v-if="model.selected" label="In use" color="success" variant="subtle" size="sm" class="ml-2" />
          </p>
          <p class="text-xs text-muted">{{ model.description }}</p>
          <div v-if="model.downloadJobId && byId[model.downloadJobId]" class="mt-2 space-y-1">
            <UProgress :model-value="Math.round(byId[model.downloadJobId]!.progress * 100)" size="xs" />
            <p class="text-xs text-muted">{{ byId[model.downloadJobId]!.message ?? 'Waiting to start' }}</p>
          </div>
        </div>
        <div class="flex gap-2">
          <template v-if="model.downloadJobId">
            <ConfirmButton label="Stop" confirm-label="Stop download?" @confirm="cancel(model.downloadJobId)" />
          </template>
          <template v-else-if="model.installed">
            <UButton
              v-if="!model.selected"
              label="Use this one"
              color="neutral"
              variant="outline"
              size="xs"
              :disabled="busy"
              @click="call(`/api/models/${model.id}/select`, 'POST', 'Could not switch model')"
            />
            <UButton label="Remove" color="neutral" variant="ghost" size="xs" @click="removing = model" />
          </template>
          <UButton v-else label="Download" icon="i-lucide-download" size="xs" :color="model.recommended ? 'primary' : 'neutral'" :variant="model.recommended ? 'solid' : 'outline'" @click="confirming = model" />
        </div>
      </li>
    </ul>
  </UCard>

  <UModal
    v-model:open="confirmOpen"
    :title="`Download ${confirming?.label}?`"
    :description="`${formatBytes(confirming?.bytes ?? 0)} from Hugging Face (ggerganov/whisper.cpp). It's saved in this app's data folder and checked against the published checksum.`"
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="confirming = null" />
        <UButton :label="`Download ${formatBytes(confirming?.bytes ?? 0)}`" icon="i-lucide-download" :loading="busy" @click="download" />
      </div>
    </template>
  </UModal>

  <UModal
    v-model:open="removeOpen"
    :title="`Remove ${removing?.label}?`"
    :description="`Frees ${formatBytes(removing?.bytes ?? 0)}. Existing transcripts stay; you can download the model again any time.`"
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="removing = null" />
        <UButton label="Remove" color="error" :loading="busy" @click="remove" />
      </div>
    </template>
  </UModal>
</template>
