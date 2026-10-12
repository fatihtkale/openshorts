<script setup lang="ts">
import type { ProjectDto } from '@clipstudio/core/shared'

const { data: projects, refresh } = await useFetch<ProjectDto[]>('/api/projects', {
  query: { deleted: 'true' },
  default: () => [],
})
const toast = useToast()
const now = useNow()

const busyId = ref<string | null>(null)
const purging = ref<ProjectDto | null>(null)
const purgeOpen = computed({
  get: () => !!purging.value,
  set: (v) => {
    if (!v) purging.value = null
  },
})

async function restore(p: ProjectDto) {
  busyId.value = p.id
  try {
    await $fetch(`/api/projects/${p.id}/restore`, { method: 'POST' })
    toast.add({ title: 'Restored', description: p.name, icon: 'i-lucide-undo-2', actions: [{ label: 'Open', to: `/projects/${p.id}` }] })
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not restore', description: (e as Error).message, color: 'error' })
  } finally {
    busyId.value = null
  }
}

async function purge() {
  const p = purging.value
  if (!p) return
  busyId.value = p.id
  try {
    await $fetch(`/api/projects/${p.id}/purge`, { method: 'POST' })
    toast.add({ title: 'Deleted for good', description: `${p.name} · ${formatBytes(p.storageBytes)} freed`, icon: 'i-lucide-trash' })
    purging.value = null
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not delete', description: (e as Error).message, color: 'error' })
  } finally {
    busyId.value = null
  }
}

const totalBytes = computed(() => projects.value.reduce((sum, p) => sum + p.storageBytes, 0))
</script>

<template>
  <PageShell title="Trash">
    <div class="mx-auto w-full max-w-4xl space-y-4">
      <p v-if="projects.length" class="text-sm text-muted">
        {{ projects.length }} {{ projects.length === 1 ? 'project' : 'projects' }} · {{ formatBytes(totalBytes) }} on disk.
        Projects stay here until you delete them.
      </p>

      <UEmpty
        v-if="!projects.length"
        icon="i-lucide-trash-2"
        title="Trash is empty"
        description="Projects you move to the Trash show up here. You can restore them, or delete them for good to free disk space."
        variant="naked"
        class="py-16"
      />

      <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
        <ul class="divide-y divide-default">
          <li v-for="p in projects" :key="p.id" class="flex items-center gap-4 px-4 py-3 sm:px-6">
            <img v-if="thumbnailUrl(p)" :src="thumbnailUrl(p)!" alt="" class="aspect-video w-24 shrink-0 rounded object-cover opacity-70" />
            <div v-else class="grid aspect-video w-24 shrink-0 place-items-center rounded bg-elevated">
              <UIcon name="i-lucide-film" class="size-5 text-dimmed" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ p.name }}</p>
              <p class="text-xs text-muted">
                {{ formatBytes(p.storageBytes) }} · moved to Trash {{ timeAgo(p.deletedAt ?? p.updatedAt, now) }}
              </p>
            </div>
            <UButton label="Restore" icon="i-lucide-undo-2" color="neutral" variant="outline" size="sm" :loading="busyId === p.id && !purging" @click="restore(p)" />
            <UButton label="Delete forever" color="error" variant="ghost" size="sm" @click="purging = p" />
          </li>
        </ul>
      </UCard>
    </div>

    <UModal
      v-model:open="purgeOpen"
      :title="`Delete “${purging?.name}” forever?`"
      :description="`This removes ${formatBytes(purging?.storageBytes ?? 0)} of video files from this Mac. It can't be undone.`"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="purging = null" />
          <UButton label="Delete forever" icon="i-lucide-trash" color="error" :loading="!!busyId" @click="purge" />
        </div>
      </template>
    </UModal>
  </PageShell>
</template>
