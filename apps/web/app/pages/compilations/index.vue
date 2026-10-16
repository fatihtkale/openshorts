<script setup lang="ts">
import { formatTimecode, type CompilationDto } from '@clipstudio/core/shared'

/**
 * Compilations: long "funny moments" videos made from approved clips, each credited to its streamer.
 */
const toast = useToast()
const { data: list, refresh } = await useFetch<CompilationDto[]>('/api/compilations', { default: () => [], server: false })
onJobStatusChange((job) => {
  if (job.type === 'compilation.render') void refresh()
})

const newOpen = ref(false)
const newTitle = ref('Funniest NoPixel moments')
const creating = ref(false)
async function create() {
  creating.value = true
  try {
    const c = await $fetch<CompilationDto>('/api/compilations', { method: 'POST', body: { title: newTitle.value } })
    newOpen.value = false
    await navigateTo(`/compilations/${c.id}`)
  } catch (e) {
    toast.add({ title: 'Could not create it', description: (e as { statusMessage?: string }).statusMessage ?? (e as Error).message, color: 'error' })
  } finally {
    creating.value = false
  }
}

function status(c: CompilationDto): { label: string; color: 'neutral' | 'success' | 'warning' | 'error' | 'primary' } {
  if (c.status === 'queued') return { label: 'Waiting to export', color: 'neutral' }
  if (c.status === 'running') return { label: 'Exporting', color: 'primary' }
  if (c.status === 'failed') return { label: 'Export failed', color: 'error' }
  if (c.status === 'done') return c.renderedVersion === c.version ? { label: 'Exported', color: 'success' } : { label: 'Edited since export', color: 'warning' }
  return { label: 'Draft', color: 'neutral' }
}
</script>

<template>
  <PageShell title="Compilations">
    <template #actions>
      <UButton label="New compilation" icon="i-lucide-plus" @click="newOpen = true" />
    </template>

    <UEmpty
      v-if="!list.length"
      icon="i-lucide-film"
      title="No compilations yet"
      description="Put your best clips together into one long video, with a shoutout banner for every streamer."
      :actions="[{ label: 'New compilation', icon: 'i-lucide-plus', onClick: () => (newOpen = true) }]"
      variant="naked"
    />
    <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="c in list"
        :key="c.id"
        :to="`/compilations/${c.id}`"
        class="space-y-2 rounded-lg border border-default p-4 transition hover:border-accented"
      >
        <p class="truncate font-medium">{{ c.title }}</p>
        <p class="text-sm text-muted">
          {{ c.items.length }} {{ c.items.length === 1 ? 'clip' : 'clips' }}<template v-if="c.durationMs"> · {{ formatTimecode(c.durationMs / 1000) }}</template>
        </p>
        <UBadge :label="status(c).label" :color="status(c).color" variant="subtle" size="sm" />
      </NuxtLink>
    </div>

    <UModal v-model:open="newOpen" title="New compilation" description="You'll pick the clips next.">
      <template #body>
        <UFormField label="Title">
          <UInput v-model="newTitle" class="w-full" maxlength="100" autofocus @keydown.enter="create" />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="newOpen = false" />
          <UButton label="Create" :loading="creating" :disabled="!newTitle.trim()" @click="create" />
        </div>
      </template>
    </UModal>
  </PageShell>
</template>
